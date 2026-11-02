import { Capacitor } from "@capacitor/core";
import { BATTERY_SERVICE, DEVICE_INFORMATION_SERVICE, DIS_SERIAL_NUMBER, FAMILY_GATT, HEART_RATE_SERVICE, WHOOP4_SERVICE, WHOOP5_SERVICE, StrapSession, type Effect, type StrapFamily, type StrapModel } from "./protocol";
import { aggregateMinutes, type StrapMinute, type StrapRecord } from "./derive";

/**
 * Bluetooth link for the strap's own service: Web Bluetooth in Chrome, or the Capacitor plugin inside
 * the iOS / Android app. The protocol itself lives in ./protocol (pure); this file only moves bytes,
 * executes the session's write effects in order, and turns offloaded records into stored minutes.
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

export interface OffloadCallbacks {
  onLog: (line: string, level: "debug" | "info" | "warn" | "error") => void;
  onState: (state: string) => void;
  onDevice: (info: { serial?: string | null; name?: string | null; firmware?: string | null; battery?: number | null }) => void;
  onProgress: (p: OffloadProgress) => void;
  /** Called with each batch of complete minutes. Must resolve once they are stored; the chunk is acknowledged to the strap only after that. */
  onMinutes: (minutes: StrapMinute[]) => Promise<void>;
}

export interface RunOffloadOptions {
  model: StrapModel;
  signal: AbortSignal;
  callbacks: OffloadCallbacks;
}

interface Link {
  family: StrapFamily;
  name: string | null;
  subscribe(characteristic: string, onValue: (bytes: Uint8Array) => void): Promise<void>;
  write(characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void>;
  /** Device Information serial (2A25), which a WHOOP 5.0 exposes; null when absent. */
  readSerial(): Promise<string | null>;
  onDisconnect(cb: () => void): void;
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
  const server = await step("connect", () => device.gatt!.connect());
  let family: StrapFamily | null = null;
  let service: BluetoothRemoteGATTService | null = null;
  for (const [fam, uuid] of [["whoop4", WHOOP4_SERVICE], ["whoop5", WHOOP5_SERVICE]] as const) {
    try {
      service = await server.getPrimaryService(uuid);
      family = fam;
      break;
    } catch {
      log(`Service ${uuid.slice(0, 8)} not present`, "debug");
    }
  }
  if (!family || !service) throw new Error("No WHOOP service found on this device (neither 61080001 nor fd4b0001).");
  log(`Connected to ${device.name ?? "strap"} (${family})`, "info");
  const chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  const char = async (uuid: string) => {
    let c = chars.get(uuid);
    if (!c) {
      c = await service!.getCharacteristic(uuid);
      chars.set(uuid, c);
    }
    return c;
  };
  let disconnectCb: (() => void) | null = null;
  device.addEventListener("gattserverdisconnected", () => disconnectCb?.(), { once: true });
  return {
    family,
    name: device.name ?? null,
    async subscribe(uuid, onValue) {
      const c = await step(`get characteristic ${uuid.slice(0, 8)}`, () => char(uuid));
      c.addEventListener("characteristicvaluechanged", (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) onValue(toBytes(v));
      });
      await step(`subscribe ${uuid.slice(0, 8)} (props: ${describeProps(c)})`, () => c.startNotifications());
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
    async disconnect() {
      device.gatt?.disconnect();
    },
  };
}

async function connectNative(log: OffloadCallbacks["onLog"]): Promise<Link> {
  const { BleClient } = await import("@capacitor-community/bluetooth-le");
  await BleClient.initialize({ androidNeverForLocation: true });
  const device = await BleClient.requestDevice({ services: [WHOOP4_SERVICE, WHOOP5_SERVICE], optionalServices: [BATTERY_SERVICE, HEART_RATE_SERVICE, DEVICE_INFORMATION_SERVICE], namePrefix: "WHOOP" });
  let disconnectCb: (() => void) | null = null;
  await BleClient.connect(device.deviceId, () => disconnectCb?.());
  const services = await BleClient.getServices(device.deviceId);
  const uuids = services.map((s) => s.uuid.toLowerCase());
  const family: StrapFamily | null = uuids.includes(WHOOP4_SERVICE) ? "whoop4" : uuids.includes(WHOOP5_SERVICE) ? "whoop5" : null;
  if (!family) throw new Error("No WHOOP service found on this device.");
  const service = FAMILY_GATT[family].service;
  log(`Connected to ${device.name ?? "strap"} (${family})`, "info");
  // Android can create the just-works bond explicitly; iOS bonds on the first encrypted access.
  if (Capacitor.getPlatform() === "android") {
    try {
      const bonded = await BleClient.isBonded(device.deviceId);
      if (!bonded) {
        log("Requesting the system bond", "info");
        await step("bond", () => BleClient.createBond(device.deviceId));
      }
    } catch (e) {
      log(`Bond request failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
    }
  }
  return {
    family,
    name: device.name ?? null,
    async subscribe(uuid, onValue) {
      await step(`subscribe ${uuid.slice(0, 8)}`, () => BleClient.startNotifications(device.deviceId, service, uuid, (value) => onValue(toBytes(value))));
    },
    async write(uuid, bytes, withResponse) {
      const view = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      await step(`write ${bytes.length} bytes ${withResponse ? "with" : "without"} response to ${uuid.slice(0, 8)}`, async () => {
        if (withResponse) await BleClient.write(device.deviceId, service, uuid, view);
        else await BleClient.writeWithoutResponse(device.deviceId, service, uuid, view);
      });
    },
    async readSerial() {
      try {
        const v = await BleClient.read(device.deviceId, DEVICE_INFORMATION_SERVICE, DIS_SERIAL_NUMBER);
        return new TextDecoder().decode(toBytes(v)).replace(/\0+$/, "").trim() || null;
      } catch {
        return null;
      }
    },
    onDisconnect(cb) {
      disconnectCb = cb;
    },
    async disconnect() {
      await BleClient.disconnect(device.deviceId).catch(() => undefined);
    },
  };
}

/** Minutes whose records may still grow are held back until the next chunk closes them. */
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

/**
 * Connects, bonds, runs the handshake and offloads the strap's history, storing minutes through
 * `callbacks.onMinutes` before each chunk is acknowledged. Resolves when the strap reports the
 * history complete, rejects on a fatal error or when the signal aborts.
 */
export async function runOffload({ model, signal, callbacks }: RunOffloadOptions): Promise<{ records: number; chunks: number; minutes: number }> {
  const support = strapSupport();
  if (support === "none") throw new Error("Bluetooth is not available in this browser.");
  if (signal.aborted) throw new Error("Cancelled before start.");
  const link = support === "native" ? await connectNative(callbacks.onLog) : await connectWeb(callbacks.onLog);
  callbacks.onDevice({ name: link.name, serial: link.family === "whoop5" ? await link.readSerial() : null });

  const gatt = FAMILY_GATT[link.family];
  const batcher = new MinuteBatcher();
  const progress: OffloadProgress = { records: 0, chunks: 0, minutes: 0 };
  let writeQueue: Promise<void> = Promise.resolve();
  let storeQueue: Promise<void> = Promise.resolve();
  let finished = false;
  let session!: StrapSession;

  const result = new Promise<{ records: number; chunks: number; minutes: number }>((resolve, reject) => {
    const handle = (effect: Effect) => {
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
            if (effect.summary.complete) resolve({ ...progress });
            else reject(new Error(effect.summary.reason === "aborted" ? "Cancelled." : `Offload ${effect.summary.reason} after ${effect.summary.records} records (${effect.summary.unacked} chunks not acknowledged).`));
          });
          break;
        case "error":
          callbacks.onLog(effect.message, "error");
          if (effect.fatal && !finished) {
            finished = true;
            reject(new Error(effect.message));
          }
          break;
        default:
          break;
      }
    };
    session = new StrapSession({ onEffect: handle });
    link.onDisconnect(() => {
      callbacks.onLog("Strap disconnected.", "warn");
      if (!finished) {
        finished = true;
        reject(new Error("The strap disconnected before the offload finished. Keep it close and try again; already stored minutes are kept."));
      }
    });
  });

  const tick = window.setInterval(() => session.tick(performance.now()), 200);
  const onAbort = () => {
    callbacks.onLog("Stopping at your request.", "info");
    session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    // The command-response and data channels are required; the event and auxiliary channels are not.
    const required = new Set([gatt.notify[0], gatt.notify[2]]);
    for (const uuid of gatt.notify) {
      try {
        await link.subscribe(uuid, (bytes) => session.onNotification(uuid, bytes));
        callbacks.onLog(`Subscribed to ${uuid.slice(0, 8)}`, "debug");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (required.has(uuid)) {
          const hint =
            link.family === "whoop5"
              ? "A WHOOP 5.0 only talks over an encrypted, bonded link and drops the connection when it will not accept one. Turn Bluetooth off on your phone, tap the strap firmly until its LEDs flash blue, pair it once in this computer's Bluetooth settings, then try again. The FRADY app on a phone bonds on its own."
              : "The strap refused the encrypted channel. Quit the WHOOP app or turn that phone's Bluetooth off, then try again.";
          throw new Error(`${msg}. ${hint}`);
        }
        callbacks.onLog(`Optional channel ${uuid.slice(0, 8)} not available (${msg}); continuing`, "warn");
      }
    }
    callbacks.onLog(`Starting ${model} session on ${gatt.service.slice(0, 8)}`, "info");
    session.start({ model, nowUnix: Math.floor(Date.now() / 1000), nowMs: performance.now(), serviceUuid: gatt.service });
    return await result;
  } finally {
    window.clearInterval(tick);
    signal.removeEventListener("abort", onAbort);
    await link.disconnect().catch(() => undefined);
  }
}
