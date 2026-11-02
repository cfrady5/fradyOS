import { Capacitor } from "@capacitor/core";
import { BATTERY_SERVICE, DEVICE_INFORMATION_SERVICE, DIS_SERIAL_NUMBER, FAMILY_GATT, HEART_RATE_SERVICE, WHOOP4_SERVICE, WHOOP5_SERVICE, StrapSession, type Effect, type StrapFamily, type StrapModel } from "./protocol";
import { HEART_RATE_MEASUREMENT, parseHeartRateMeasurement } from "@/lib/ble/heartRate";
import { aggregateMinutes, type StrapMinute, type StrapRecord } from "./derive";

/**
 * Bluetooth link for the strap's own service: Web Bluetooth in Chrome, or the Capacitor plugin inside
 * the iOS / Android app. The protocol itself lives in ./protocol (pure); this file only moves bytes,
 * executes the session's write effects in order, and turns records into stored minutes.
 *
 * Two ways to use it:
 * - runOffload: connect, pull the strap's recorder once, disconnect.
 * - runLiveLink: stay connected; stream heart rate continuously over the standard profile, pull the
 *   recorder every few minutes for motion and the other channels, and reconnect when the strap comes
 *   back into range. This is the "always on" mode.
 */
export type StrapSupport = "web" | "native" | "none";
export type { StrapModel };

export function strapSupport(): StrapSupport {
  if (typeof window === "undefined") return "none";
  if (Capacitor.isNativePlatform()) return "native";
  if ("bluetooth" in navigator && navigator.bluetooth) return "web";
  return "none";
}

export interface OffloadProgress {
  records: number;
  chunks: number;
  minutes: number;
}

export interface DeviceInfo {
  serial?: string | null;
  name?: string | null;
  firmware?: string | null;
  battery?: number | null;
  /** Platform device id the native app can reconnect to silently next time. */
  deviceId?: string | null;
}

export interface OffloadCallbacks {
  onLog: (line: string, level: "debug" | "info" | "warn" | "error") => void;
  onState: (state: string) => void;
  onDevice: (info: DeviceInfo) => void;
  onProgress: (p: OffloadProgress) => void;
  /** Called with each batch of complete minutes. Must resolve once they are stored; a recorder chunk is acknowledged to the strap only after that. */
  onMinutes: (minutes: StrapMinute[]) => Promise<void>;
}

export interface LiveCallbacks extends OffloadCallbacks {
  /** Live heart rate from the standard profile, about once a second. */
  onHeartRate: (bpm: number, rr: number[]) => void;
  /** A recorder pull finished; `since` is the earliest minute it could have touched. */
  onCycle: (info: { records: number; since: string }) => void;
}

export interface RunOffloadOptions {
  model: StrapModel;
  signal: AbortSignal;
  callbacks: OffloadCallbacks;
}

export interface RunLiveLinkOptions {
  model: StrapModel;
  signal: AbortSignal;
  callbacks: LiveCallbacks;
  /** Minutes between recorder pulls. */
  intervalMin?: number;
  /** Native only: reconnect to this device without showing the picker. */
  knownDeviceId?: string | null;
}

interface Link {
  family: StrapFamily;
  name: string | null;
  deviceId: string | null;
  subscribe(characteristic: string, onValue: (bytes: Uint8Array) => void): Promise<void>;
  /** Subscribe on another primary service (the standard heart-rate profile). */
  subscribeIn(service: string, characteristic: string, onValue: (bytes: Uint8Array) => void): Promise<void>;
  write(characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void>;
  readSerial(): Promise<string | null>;
  onDisconnect(cb: () => void): void;
  /** Re-open the GATT connection to the same device without the picker. */
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
}

/** Runs one GATT step and rethrows with the step named, so a generic browser error still says where it happened. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${name}: ${msg}`);
  }
}

function describeProps(c: BluetoothRemoteGATTCharacteristic): string {
  const p = c.properties;
  return [p.read && "read", p.write && "write", p.writeWithoutResponse && "writeNoResp", p.notify && "notify", p.indicate && "indicate"].filter(Boolean).join(",");
}

const toBytes = (view: DataView) => new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectWeb(log: OffloadCallbacks["onLog"]): Promise<Link> {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "unknown OS";
  log(`Web Bluetooth on ${os}, ${/Chrome\/(\d+)/.exec(ua)?.[0] ?? "unknown browser"}`, "debug");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [WHOOP4_SERVICE] }, { services: [WHOOP5_SERVICE] }, { namePrefix: "WHOOP" }],
    optionalServices: [WHOOP4_SERVICE, WHOOP5_SERVICE, BATTERY_SERVICE, HEART_RATE_SERVICE, DEVICE_INFORMATION_SERVICE],
  });
  if (!device.gatt) throw new Error("This device does not expose a GATT server.");
  log(`Picked ${device.name ?? device.id}; connecting`, "debug");
  let server = await step("connect", () => device.gatt!.connect());
  let family: StrapFamily | null = null;
  let service: BluetoothRemoteGATTService | null = null;
  const findService = async () => {
    for (const [fam, uuid] of [["whoop4", WHOOP4_SERVICE], ["whoop5", WHOOP5_SERVICE]] as const) {
      try {
        service = await server.getPrimaryService(uuid);
        family = fam;
        return;
      } catch {
        log(`Service ${uuid.slice(0, 8)} not present`, "debug");
      }
    }
  };
  await findService();
  if (!family || !service) throw new Error("No WHOOP service found on this device (neither 61080001 nor fd4b0001).");
  log(`Connected to ${device.name ?? "strap"} (${family})`, "info");
  let chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  const char = async (uuid: string, svc: BluetoothRemoteGATTService = service!) => {
    const key = `${svc.uuid}/${uuid}`;
    let c = chars.get(key);
    if (!c) {
      c = await svc.getCharacteristic(uuid);
      chars.set(key, c);
    }
    return c;
  };
  let disconnectCb: (() => void) | null = null;
  device.addEventListener("gattserverdisconnected", () => disconnectCb?.());
  const subscribeChar = async (c: BluetoothRemoteGATTCharacteristic, uuid: string, onValue: (bytes: Uint8Array) => void) => {
    c.addEventListener("characteristicvaluechanged", (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (v) onValue(toBytes(v));
    });
    await step(`subscribe ${uuid.slice(0, 8)} (props: ${describeProps(c)})`, () => c.startNotifications());
  };
  return {
    family,
    name: device.name ?? null,
    deviceId: null,
    async subscribe(uuid, onValue) {
      const c = await step(`get characteristic ${uuid.slice(0, 8)}`, () => char(uuid));
      await subscribeChar(c, uuid, onValue);
    },
    async subscribeIn(svcUuid, uuid, onValue) {
      const svc = await step(`get service ${svcUuid.slice(0, 8)}`, () => server.getPrimaryService(svcUuid));
      const c = await step(`get characteristic ${uuid.slice(0, 8)}`, () => char(uuid, svc));
      await subscribeChar(c, uuid, onValue);
    },
    async write(uuid, bytes, withResponse) {
      const c = await step(`get characteristic ${uuid.slice(0, 8)}`, () => char(uuid));
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const withResp = (c as BluetoothRemoteGATTCharacteristic & { writeValueWithResponse?: (v: BufferSource) => Promise<void> }).writeValueWithResponse;
      const withoutResp = (c as BluetoothRemoteGATTCharacteristic & { writeValueWithoutResponse?: (v: BufferSource) => Promise<void> }).writeValueWithoutResponse;
      await step(`write ${bytes.length} bytes ${withResponse ? "with" : "without"} response to ${uuid.slice(0, 8)}`, async () => {
        if (withResponse && withResp) await withResp.call(c, buf);
        else if (!withResponse && withoutResp) await withoutResp.call(c, buf);
        else await c.writeValue(buf);
      });
    },
    async readSerial() {
      try {
        const dis = await server.getPrimaryService(DEVICE_INFORMATION_SERVICE);
        const v = await (await dis.getCharacteristic(DIS_SERIAL_NUMBER)).readValue();
        return new TextDecoder().decode(toBytes(v)).replace(/\0+$/, "").trim() || null;
      } catch {
        return null;
      }
    },
    onDisconnect(cb) {
      disconnectCb = cb;
    },
    async reconnect() {
      chars = new Map();
      server = await step("reconnect", () => device.gatt!.connect());
      await findService();
    },
    async disconnect() {
      device.gatt?.disconnect();
    },
  };
}

async function connectNative(log: OffloadCallbacks["onLog"], knownDeviceId?: string | null): Promise<Link> {
  const { BleClient } = await import("@capacitor-community/bluetooth-le");
  await BleClient.initialize({ androidNeverForLocation: true });
  let device: { deviceId: string; name?: string } | null = null;
  if (knownDeviceId) {
    try {
      const known = await BleClient.getDevices([knownDeviceId]);
      if (known[0]) {
        device = known[0];
        log(`Reconnecting to ${device.name ?? knownDeviceId} without the picker`, "debug");
      }
    } catch {
      device = null;
    }
  }
  if (!device) device = await BleClient.requestDevice({ services: [WHOOP4_SERVICE, WHOOP5_SERVICE], optionalServices: [BATTERY_SERVICE, HEART_RATE_SERVICE, DEVICE_INFORMATION_SERVICE], namePrefix: "WHOOP" });
  const dev = device;
  let disconnectCb: (() => void) | null = null;
  const connect = () => step("connect", () => BleClient.connect(dev.deviceId, () => disconnectCb?.()));
  await connect();
  const services = await BleClient.getServices(dev.deviceId);
  const uuids = services.map((s) => s.uuid.toLowerCase());
  const family: StrapFamily | null = uuids.includes(WHOOP4_SERVICE) ? "whoop4" : uuids.includes(WHOOP5_SERVICE) ? "whoop5" : null;
  if (!family) throw new Error("No WHOOP service found on this device.");
  const service = FAMILY_GATT[family].service;
  log(`Connected to ${dev.name ?? "strap"} (${family})`, "info");
  // Android can create the just-works bond explicitly; iOS bonds on the first encrypted access.
  if (Capacitor.getPlatform() === "android") {
    try {
      const bonded = await BleClient.isBonded(dev.deviceId);
      if (!bonded) {
        log("Requesting the system bond", "info");
        await step("bond", () => BleClient.createBond(dev.deviceId));
      }
    } catch (e) {
      log(`Bond request failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
    }
  }
  return {
    family,
    name: dev.name ?? null,
    deviceId: dev.deviceId,
    async subscribe(uuid, onValue) {
      await step(`subscribe ${uuid.slice(0, 8)}`, () => BleClient.startNotifications(dev.deviceId, service, uuid, (value) => onValue(toBytes(value))));
    },
    async subscribeIn(svcUuid, uuid, onValue) {
      await step(`subscribe ${uuid.slice(0, 8)}`, () => BleClient.startNotifications(dev.deviceId, svcUuid, uuid, (value) => onValue(toBytes(value))));
    },
    async write(uuid, bytes, withResponse) {
      const view = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      await step(`write ${bytes.length} bytes ${withResponse ? "with" : "without"} response to ${uuid.slice(0, 8)}`, async () => {
        if (withResponse) await BleClient.write(dev.deviceId, service, uuid, view);
        else await BleClient.writeWithoutResponse(dev.deviceId, service, uuid, view);
      });
    },
    async readSerial() {
      try {
        const v = await BleClient.read(dev.deviceId, DEVICE_INFORMATION_SERVICE, DIS_SERIAL_NUMBER);
        return new TextDecoder().decode(toBytes(v)).replace(/\0+$/, "").trim() || null;
      } catch {
        return null;
      }
    },
    onDisconnect(cb) {
      disconnectCb = cb;
    },
    async reconnect() {
      await connect();
    },
    async disconnect() {
      await BleClient.disconnect(dev.deviceId).catch(() => undefined);
    },
  };
}

async function connectLink(log: OffloadCallbacks["onLog"], knownDeviceId?: string | null): Promise<Link> {
  const support = strapSupport();
  if (support === "none") throw new Error("Bluetooth is not available in this browser.");
  return support === "native" ? connectNative(log, knownDeviceId) : connectWeb(log);
}

/** Minutes whose records may still grow are held back until a later record closes them. */
class MinuteBatcher {
  private carry: StrapRecord[] = [];
  push(records: StrapRecord[]): StrapMinute[] {
    const all = [...this.carry, ...records].sort((a, b) => a.unix - b.unix);
    if (!all.length) return [];
    const lastMinute = Math.floor(all[all.length - 1].unix / 60);
    this.carry = all.filter((r) => Math.floor(r.unix / 60) === lastMinute);
    const closed = all.filter((r) => Math.floor(r.unix / 60) !== lastMinute);
    return aggregateMinutes(closed);
  }
  flush(): StrapMinute[] {
    const out = aggregateMinutes(this.carry);
    this.carry = [];
    return out;
  }
}

interface SessionRun {
  session: StrapSession;
  /** Resolves on "done"; rejects on a fatal error or disconnect. */
  finished: Promise<{ complete: boolean; reason: string }>;
  stop: () => void;
}

/** Wires a StrapSession to a link: subscriptions, ordered writes, chunk storage before acknowledgement, timers. */
async function startSession(link: Link, opts: { model: StrapModel; keepAlive: boolean; callbacks: OffloadCallbacks; progress: OffloadProgress; batcher: MinuteBatcher; onCycle?: (records: number) => void }): Promise<SessionRun> {
  const { callbacks, progress, batcher } = opts;
  const gatt = FAMILY_GATT[link.family];
  let writeQueue: Promise<void> = Promise.resolve();
  let storeQueue: Promise<void> = Promise.resolve();
  let finished = false;
  let resolveDone!: (v: { complete: boolean; reason: string }) => void;
  let rejectDone!: (e: Error) => void;
  const finishedPromise = new Promise<{ complete: boolean; reason: string }>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function handle(effect: Effect) {
    switch (effect.kind) {
      case "log":
        callbacks.onLog(effect.message, effect.level);
        break;
      case "state":
        callbacks.onState(effect.state);
        break;
      case "write":
        writeQueue = writeQueue
          .then(async () => {
            try {
              await link.write(gatt.commandWrite, effect.bytes, effect.withResponse);
              session.onWriteAck(effect.cmd, effect.seq, true);
            } catch (e) {
              session.onWriteAck(effect.cmd, effect.seq, false, e instanceof Error ? e.message : String(e));
            }
          })
          .catch(() => undefined);
        break;
      case "response":
        if (effect.decoded.kind === "hello") callbacks.onDevice({ serial: effect.decoded.hello.serial, firmware: effect.decoded.hello.firmware ?? null, battery: effect.decoded.hello.batteryPercent ?? null });
        else if (effect.decoded.kind === "versionInfo") callbacks.onDevice({ firmware: effect.decoded.versionInfo.harvard });
        else if (effect.decoded.kind === "battery") callbacks.onDevice({ battery: effect.decoded.battery.percent });
        break;
      case "event":
        if (effect.event.battery) callbacks.onDevice({ battery: effect.event.battery.percent });
        break;
      case "offloadProgress":
        progress.records = effect.records;
        progress.chunks = effect.chunks;
        callbacks.onProgress({ ...progress });
        break;
      case "chunk": {
        const minutes = batcher.push(effect.records.filter((r) => r.unix > 1_000_000_000) as StrapRecord[]);
        const chunkId = effect.chunkId;
        storeQueue = storeQueue
          .then(async () => {
            if (minutes.length) await callbacks.onMinutes(minutes);
            progress.minutes += minutes.length;
            progress.chunks = Math.max(progress.chunks, chunkId);
            callbacks.onProgress({ ...progress });
            session.confirmChunkStored(chunkId);
          })
          .catch((e) => {
            callbacks.onLog(`Storing chunk ${chunkId} failed: ${e instanceof Error ? e.message : String(e)}`, "error");
            session.abort();
          });
        break;
      }
      case "cycleDone":
        void storeQueue.then(() => opts.onCycle?.(effect.records));
        break;
      case "done":
        finished = true;
        void storeQueue.then(async () => {
          const tail = batcher.flush();
          if (tail.length) {
            try {
              await callbacks.onMinutes(tail);
              progress.minutes += tail.length;
            } catch (e) {
              callbacks.onLog(`Storing the final minute failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
            }
          }
          callbacks.onProgress({ ...progress });
          resolveDone({ complete: effect.summary.complete, reason: effect.summary.reason });
        });
        break;
      case "error":
        callbacks.onLog(effect.message, "error");
        if (effect.fatal && !finished) {
          finished = true;
          rejectDone(new Error(effect.message));
        }
        break;
      default:
        break;
    }
  }
  const session = new StrapSession({ onEffect: handle });
  link.onDisconnect(() => {
    callbacks.onLog("Strap disconnected.", "warn");
    if (!finished) {
      finished = true;
      rejectDone(new Error("disconnected"));
    }
  });

  const tick = window.setInterval(() => session.tick(performance.now()), 200);
  // The command-response and data channels are required; the event and auxiliary channels are not.
  const required = new Set([gatt.notify[0], gatt.notify[2]]);
  for (const uuid of gatt.notify) {
    try {
      await link.subscribe(uuid, (bytes) => session.onNotification(uuid, bytes));
      callbacks.onLog(`Subscribed to ${uuid.slice(0, 8)}`, "debug");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (required.has(uuid)) {
        window.clearInterval(tick);
        const hint =
          link.family === "whoop5"
            ? "A WHOOP 5.0 only talks over an encrypted, bonded link and drops the connection when it will not accept one. Turn Bluetooth off on your phone, tap the strap firmly until its LEDs flash blue, pair it once in this computer's Bluetooth settings, then try again. The FRADY app on a phone bonds on its own."
            : "The strap refused the encrypted channel. Quit the WHOOP app or turn that phone's Bluetooth off, then try again.";
        throw new Error(`${msg}. ${hint}`);
      }
      callbacks.onLog(`Optional channel ${uuid.slice(0, 8)} not available (${msg}); continuing`, "warn");
    }
  }
  callbacks.onLog(`Starting ${opts.model} session on ${gatt.service.slice(0, 8)}${opts.keepAlive ? " (keep alive)" : ""}`, "info");
  session.start({ model: opts.model, nowUnix: Math.floor(Date.now() / 1000), nowMs: performance.now(), serviceUuid: gatt.service, keepAlive: opts.keepAlive });
  const finishedWithCleanup = finishedPromise.finally(() => window.clearInterval(tick));
  return { session, finished: finishedWithCleanup, stop: () => window.clearInterval(tick) };
}

/**
 * Connects, bonds, runs the handshake and offloads the strap's history once, storing minutes through
 * `callbacks.onMinutes` before each chunk is acknowledged. Resolves when the strap reports the
 * history complete, rejects on a fatal error or when the signal aborts.
 */
export async function runOffload({ model, signal, callbacks }: RunOffloadOptions): Promise<{ records: number; chunks: number; minutes: number }> {
  if (signal.aborted) throw new Error("Cancelled before start.");
  const link = await connectLink(callbacks.onLog);
  callbacks.onDevice({ name: link.name, deviceId: link.deviceId, serial: link.family === "whoop5" ? await link.readSerial() : null });
  const progress: OffloadProgress = { records: 0, chunks: 0, minutes: 0 };
  const run = await startSession(link, { model, keepAlive: false, callbacks, progress, batcher: new MinuteBatcher() });
  const onAbort = () => {
    callbacks.onLog("Stopping at your request.", "info");
    run.session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const out = await run.finished;
    if (!out.complete) throw new Error(out.reason === "aborted" ? "Cancelled." : `Offload ${out.reason} after ${progress.records} records.`);
    return { ...progress };
  } finally {
    signal.removeEventListener("abort", onAbort);
    await link.disconnect().catch(() => undefined);
  }
}

/**
 * Always-on mode. Keeps the strap connected: live heart rate streams over the standard profile and is
 * stored minute by minute; every `intervalMin` the strap's recorder is pulled for motion and the other
 * channels; a dropped link is retried with backoff until the signal aborts. Resolves only on abort.
 */
export async function runLiveLink({ model, signal, callbacks, intervalMin = 15, knownDeviceId = null }: RunLiveLinkOptions): Promise<void> {
  if (signal.aborted) return;
  let attempt = 0;
  let link: Link | null = null;
  const hrBatcher = new MinuteBatcher();
  const progress: OffloadProgress = { records: 0, chunks: 0, minutes: 0 };
  let lastHrFlush = Date.now();

  while (!signal.aborted) {
    try {
      if (!link) {
        link = await connectLink(callbacks.onLog, knownDeviceId);
        callbacks.onDevice({ name: link.name, deviceId: link.deviceId, serial: link.family === "whoop5" ? await link.readSerial() : null });
      } else {
        callbacks.onState("reconnecting");
        await link.reconnect();
        callbacks.onLog("Reconnected.", "info");
      }
      attempt = 0;

      // Live heart rate over the standard profile: no bond needed, about one reading a second.
      try {
        await link.subscribeIn(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, (bytes) => {
          const m = parseHeartRateMeasurement(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
          if (m.bpm > 0) callbacks.onHeartRate(m.bpm, m.rr);
          const record: StrapRecord = { unix: Math.floor(Date.now() / 1000), hr: m.bpm > 0 ? m.bpm : null, rr: m.rr };
          const closed = hrBatcher.push([record]);
          if (closed.length && Date.now() - lastHrFlush > 55_000) {
            lastHrFlush = Date.now();
            void callbacks.onMinutes(closed).then(() => {
              progress.minutes += closed.length;
              callbacks.onProgress({ ...progress });
            }).catch((e) => callbacks.onLog(`Storing live minutes failed: ${e instanceof Error ? e.message : String(e)}`, "warn"));
          }
        });
        callbacks.onLog("Live heart rate streaming", "info");
      } catch (e) {
        callbacks.onLog(`Live heart rate not available: ${e instanceof Error ? e.message : String(e)}`, "warn");
      }

      const batcher = new MinuteBatcher();
      let cycleStart = new Date(Date.now() - 36 * 3_600_000).toISOString();
      const run = await startSession(link, {
        model,
        keepAlive: true,
        callbacks,
        progress,
        batcher,
        onCycle: (records) => {
          callbacks.onCycle({ records, since: cycleStart });
          cycleStart = new Date(Date.now() - 20 * 60_000).toISOString();
          callbacks.onLog(`Recorder pull done (${records} records so far); next in ${intervalMin} min`, "info");
        },
      });
      const timer = window.setInterval(() => {
        if (run.session.state === "linked") run.session.resumeOffload();
        else callbacks.onLog(`Skipping a recorder pull; session is ${run.session.state}`, "debug");
      }, intervalMin * 60_000);
      const battery = window.setInterval(() => run.session.requestBattery(), 10 * 60_000);
      const onAbort = () => {
        callbacks.onLog("Stopping the live link.", "info");
        run.session.end();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await run.finished;
      } finally {
        window.clearInterval(timer);
        window.clearInterval(battery);
        signal.removeEventListener("abort", onAbort);
      }
      if (signal.aborted) break;
      callbacks.onLog("Session ended; reconnecting", "warn");
    } catch (e) {
      if (signal.aborted) break;
      const msg = e instanceof Error ? e.message : String(e);
      if (!link) {
        // Never connected: surface the error instead of looping on a bad picker result or a refused bond.
        throw e;
      }
      if (/bond refused|encrypted/i.test(msg)) throw e;
      attempt++;
      const wait = Math.min(60_000, 5_000 * 2 ** Math.min(attempt, 4));
      callbacks.onState("reconnecting");
      callbacks.onLog(`${msg}. Retrying in ${Math.round(wait / 1000)} s`, "warn");
      await sleep(wait);
    }
  }
  const tail = hrBatcher.flush();
  if (tail.length) await callbacks.onMinutes(tail).catch(() => undefined);
  await link?.disconnect().catch(() => undefined);
  callbacks.onState("idle");
}
