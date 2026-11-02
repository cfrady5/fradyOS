/**
 * StrapSession — a pure, event-driven state machine for one BLE connection to a
 * WHOOP strap. It never touches Bluetooth: the host transport feeds it
 * notifications, write acknowledgements and clock ticks, and executes the
 * effects it emits (writes, logs, records, chunks to persist, …).
 *
 * Lifecycle (PROTOCOL_WHOOP4.md § "Bond handshake & connect lifecycle",
 * PROTOCOL_WHOOP5.md § "Connection and frame format", PROTOCOL_TRANSPORT.md
 * § "WHOOP 4 history lifecycle" / § "History sequencing and storage ownership",
 * PROTOCOL_IMPLEMENTATION.md § "NOOP connection policy", § "Session state machine",
 * § "Safe-trim invariant", § "Watchdog & liveness"):
 *
 *   transport subscribes notify characteristics
 *     → bond write (4.0: confirmed GET_BATTERY_LEVEL; 5.0: confirmed CLIENT_HELLO)
 *     → write acknowledged = link usable (a refused / unauthenticated write = "bond refused")
 *     → connect handshake, exactly once per connection
 *     → ~1.5 s settle → SEND_HISTORICAL_DATA
 *     → HISTORY_START, type-47 records, HISTORY_END(token) → host persists → ack with the token
 *     → … repeat … → HISTORY_COMPLETE → done.
 *
 * The handshake is never re-run mid-offload (re-running it was the documented
 * cause of the strap refusing to stream type-47). Timeouts re-request history
 * instead. Destructive commands cannot be built at all (see FORBIDDEN_COMMANDS).
 */
import {
  Command,
  CommandResult,
  EventId,
  FAMILY_GATT,
  OFFLOAD_PACKET_TYPES,
  PacketType,
  commandName,
  familyForUuid,
  type StrapFamily,
} from "./constants";
import {
  SequenceCounter,
  abortHistoricalTransmits,
  clientHello,
  encodeCommand,
  getAdvertisingNameHarvard,
  getBatteryLevel,
  getClock5,
  getClockEmpty,
  getClockZero,
  getDataRange,
  getHelloHarvard,
  historicalDataResult,
  reportVersionInfo,
  sendHistoricalData,
  sendR10R11Realtime,
  setClock5,
  setClock8,
  setClock9,
  toggleRealtimeHr,
  type CommandSpec,
} from "./commands";
import { Reassembler, type ParsedFrame } from "./framing";
import {
  decodeCommandResponse,
  decodeEvent,
  decodeHistorical,
  decodeMetadata,
  decodeRealtime,
  decodeResponseBody,
  type CommandResponse,
  type DecodedResponseBody,
  type HistoricalRecord,
  type HistoryMetadata,
  type RealtimeRecord,
  type StrapEvent,
} from "./records";

export type StrapModel = StrapFamily | "auto";

export type SessionState =
  | "idle"
  | "bonding"
  | "handshake"
  | "settling"
  | "offloading"
  | "complete"
  | "aborted"
  | "failed";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Why a write was issued; lets the host and the session's own ack handler tell them apart. */
export type WritePurpose = "bond" | "handshake" | "history" | "ack" | "abort" | "realtime" | "battery";

export type StrapRecord =
  | ({ source: "historical"; chunkId: number } & HistoricalRecord)
  | ({ source: "realtime" } & RealtimeRecord);

export interface ChunkEffect {
  kind: "chunk";
  chunkId: number;
  /** Decoded records in arrival order. */
  records: HistoricalRecord[];
  /** Every type-47 frame of the chunk, including undecodable layouts, for durable raw retention. */
  rawFrames: Uint8Array[];
  /** The eight HISTORY_END bytes to echo in the acknowledgement. Persist verbatim. */
  token: Uint8Array;
  endUnix: number | null;
}

export interface DoneSummary {
  reason: "complete" | "aborted" | "stalled" | "failed";
  complete: boolean;
  records: number;
  unknownRecords: number;
  chunks: number;
  acked: number;
  /** Chunks emitted but never confirmed by the host (so never acknowledged to the strap). */
  unacked: number;
  durationMs: number;
}

export type Effect =
  | { kind: "write"; withResponse: boolean; bytes: Uint8Array; cmd: number; seq: number; name: string; purpose: WritePurpose }
  | { kind: "log"; level: LogLevel; message: string }
  | { kind: "state"; state: SessionState }
  | { kind: "record"; record: StrapRecord }
  | { kind: "event"; event: StrapEvent }
  | { kind: "response"; response: CommandResponse; decoded: DecodedResponseBody; matchedRequest: boolean }
  | ChunkEffect
  | { kind: "offloadProgress"; records: number; chunks: number }
  | { kind: "done"; summary: DoneSummary }
  | { kind: "error"; message: string; fatal: boolean };

export interface SessionOptions {
  /** How long the bond write may go unacknowledged before the session fails. */
  bondAckTimeoutMs?: number;
  /** How long any other write may go unacknowledged before it is treated as failed. */
  writeAckTimeoutMs?: number;
  /** How long a handshake step that awaits a response waits before moving on. */
  responseTimeoutMs?: number;
  /** Pause between the last handshake write and SEND_HISTORICAL_DATA. */
  settleMs?: number;
  /** Offload idle watchdog: silence on types 47/48/49/50 for this long triggers a re-request. */
  idleTimeoutMs?: number;
  /** Re-requests of SEND_HISTORICAL_DATA before the session gives up as stalled. */
  maxReRequests?: number;
  /** WHOOP 5 only: clock drift (seconds) above which SET_CLOCK (146) is written. */
  clockDriftThresholdS?: number;
  /** Warn when the host has not confirmed a chunk for this long. */
  storeConfirmWarnMs?: number;
  /** Receive effects as they are produced instead of via drain(). */
  onEffect?: (effect: Effect) => void;
}

export interface StartOptions {
  model: StrapModel;
  /** Wall clock at start, Unix seconds; used for SET_CLOCK and drift checks. */
  nowUnix: number;
  /** Current monotonic time in ms (same clock as tick()). */
  nowMs: number;
  /** The custom service the transport discovered; required for `model: "auto"`. */
  serviceUuid?: string;
}

interface HandshakeStep {
  build: () => CommandSpec;
  skipIf?: () => boolean;
  /** When true the step waits for the matching type-36 response (or responseTimeoutMs) before the next step. */
  awaitResponse?: boolean;
  onResponse?: (response: CommandResponse, decoded: DecodedResponseBody) => void;
}

interface QueuedWrite {
  spec: CommandSpec;
  purpose: WritePurpose;
  step?: HandshakeStep;
  chunkId?: number;
  /** Pre-built bytes (the fixed CLIENT_HELLO) and the seq they carry. */
  fixed?: { bytes: Uint8Array; seq: number };
}

interface PendingWrite extends QueuedWrite {
  cmd: number;
  seq: number;
  sentAtMs: number;
}

interface OpenChunk {
  records: HistoricalRecord[];
  rawFrames: Uint8Array[];
}

interface AwaitingChunk extends ChunkEffect {
  emittedAtMs: number;
  warned: boolean;
}

const AUTH_FAILURE_RE = /insufficient|authentic|authoriz|encrypt|bond|pairing|security/i;

const DEFAULTS: Required<Omit<SessionOptions, "onEffect">> = {
  bondAckTimeoutMs: 15_000,
  writeAckTimeoutMs: 5_000,
  responseTimeoutMs: 2_000,
  settleMs: 1_500,
  idleTimeoutMs: 60_000,
  maxReRequests: 3,
  clockDriftThresholdS: 30,
  storeConfirmWarnMs: 30_000,
};

export function bondRefusedMessage(family: StrapFamily): string {
  const how =
    family === "whoop5"
      ? "quit the WHOOP app (or turn that phone's Bluetooth off), forget the strap in this device's Bluetooth settings, then tap the band firmly until its LEDs flash blue"
      : "quit the WHOOP app (or turn that phone's Bluetooth off) and reconnect";
  return `bond refused: free the strap from the WHOOP app and put it in pairing mode — ${how}. A strap holds one encrypted bond at a time; live heart rate still works without it, history does not.`;
}

export class StrapSession {
  private readonly opts: Required<Omit<SessionOptions, "onEffect">>;
  private readonly onEffect?: (effect: Effect) => void;
  private readonly effects: Effect[] = [];

  private _state: SessionState = "idle";
  private family: StrapFamily = "whoop4";
  private readonly reassemblers = new Map<string, Reassembler>();
  private seq = new SequenceCounter(0);

  private startMs = 0;
  private startUnix = 0;
  private lastTickMs = 0;

  private readonly writeQueue: QueuedWrite[] = [];
  private pendingWrite: PendingWrite | null = null;
  /** seq → command for correlating type-36 responses to the request that caused them. */
  private readonly outstanding = new Map<number, { cmd: number; name: string }>();

  private steps: HandshakeStep[] = [];
  private stepIndex = 0;
  private awaitingStep: { step: HandshakeStep; cmd: number; startedAtMs: number } | null = null;
  private settleUntilMs = 0;
  private clockDriftS: number | null = null;
  private clockWritten = false;

  private chunkOpen = false;
  private startSeen = false;
  private current: OpenChunk = { records: [], rawFrames: [] };
  private chunkCounter = 0;
  private readonly awaitingStore = new Map<number, AwaitingChunk>();
  private lastAckedToken: Uint8Array | null = null;
  private completeSeen = false;
  private lastOffloadFrameMs = 0;
  private reRequests = 0;
  private warnedFamilyMismatch = false;

  private readonly stats = { records: 0, unknownRecords: 0, chunks: 0, acked: 0 };

  constructor(options: SessionOptions = {}) {
    const { onEffect, ...rest } = options;
    this.opts = { ...DEFAULTS, ...stripUndefined(rest) };
    this.onEffect = onEffect;
  }

  get state(): SessionState {
    return this._state;
  }

  get strapFamily(): StrapFamily {
    return this.family;
  }

  /** Returns and clears queued effects (unused when `onEffect` was supplied). */
  drain(): Effect[] {
    return this.effects.splice(0, this.effects.length);
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  start(options: StartOptions): void {
    if (this._state !== "idle") {
      this.fail("start() called twice; create a new StrapSession per connection", true);
      return;
    }
    this.startMs = options.nowMs;
    this.lastTickMs = options.nowMs;
    this.startUnix = options.nowUnix;

    const detected = options.serviceUuid ? familyForUuid(options.serviceUuid) : null;
    if (options.model === "auto") {
      if (!detected) {
        this.fail("cannot auto-detect the strap generation: pass the discovered custom service UUID (6108… or fd4b…)", true);
        return;
      }
      this.family = detected;
    } else {
      this.family = options.model;
      if (detected && detected !== options.model) {
        this.log("warn", `requested ${options.model} but the discovered service belongs to ${detected}; using ${options.model}`);
      }
    }
    this.log("info", `session start: family=${this.family}, write=${FAMILY_GATT[this.family].commandWrite}`);

    this.setState("bonding");
    if (this.family === "whoop4") {
      // PROTOCOL_WHOOP4.md: one confirmed GET_BATTERY_LEVEL write on 0002 bonds; its ack makes the link usable.
      this.seq = new SequenceCounter(0);
      this.enqueue({ spec: getBatteryLevel(), purpose: "bond" });
    } else {
      // PROTOCOL_WHOOP5.md: write the fixed CLIENT_HELLO with response immediately after discovery.
      const hello = clientHello();
      this.seq = new SequenceCounter(hello.seq + 1);
      this.enqueue({ spec: hello.spec, purpose: "bond", fixed: { bytes: hello.bytes, seq: hello.seq } });
    }
    this.dispatch();
  }

  /** Feed one notification. Characteristics outside the custom service (2A37, 2A19 …) are ignored. */
  onNotification(characteristicUuid: string, bytes: Uint8Array): void {
    if (this.isFinished() || this._state === "idle") return;
    const family = familyForUuid(characteristicUuid);
    if (!family) return;
    if (family !== this.family) {
      if (!this.warnedFamilyMismatch) {
        this.warnedFamilyMismatch = true;
        this.log("warn", `notification on a ${family} characteristic while the session is ${this.family}; ignoring`);
      }
      return;
    }
    const key = characteristicUuid.toLowerCase();
    let reassembler = this.reassemblers.get(key);
    if (!reassembler) {
      reassembler = new Reassembler(family);
      this.reassemblers.set(key, reassembler);
    }
    for (const frame of reassembler.feed(bytes)) {
      if (!frame.ok) {
        this.log("debug", `rejected frame on ${key.slice(0, 8)}: ${frame.error ?? "invalid"} (${frame.raw.length} bytes)`);
        continue;
      }
      this.route(frame);
    }
  }

  /** The transport must report every write effect, with response or not, exactly once. */
  onWriteAck(cmd: number, seq: number, ok: boolean, error?: string): void {
    if (this.isFinished()) return;
    const pending = this.pendingWrite;
    if (!pending || pending.cmd !== cmd || pending.seq !== seq) {
      this.log("debug", `ack for ${commandName(cmd)} seq ${seq} does not match the pending write; ignoring`);
      return;
    }
    this.pendingWrite = null;

    if (!ok) {
      const refused = pending.purpose === "bond" || (error !== undefined && AUTH_FAILURE_RE.test(error));
      if (refused) {
        this.fail(`${bondRefusedMessage(this.family)} (${pending.spec.name}: ${error ?? "write rejected"})`, true);
        return;
      }
      this.log("warn", `write ${pending.spec.name} failed: ${error ?? "unknown error"}`);
      if (pending.purpose === "handshake") this.runNextStep();
      if (pending.purpose === "history") this.requestHistoryFailed();
      this.dispatch();
      return;
    }

    this.log("debug", `ack ${pending.spec.name} seq ${seq}`);
    switch (pending.purpose) {
      case "bond":
        this.log("info", this.family === "whoop4" ? "bond write acknowledged — link usable for commands" : "CLIENT_HELLO acknowledged — link established");
        this.beginHandshake();
        break;
      case "handshake":
        if (pending.step?.awaitResponse) {
          this.awaitingStep = { step: pending.step, cmd: pending.cmd, startedAtMs: this.lastTickMs };
        } else {
          this.runNextStep();
        }
        break;
      case "history":
        this.log("info", "SEND_HISTORICAL_DATA acknowledged; waiting for HISTORY_START");
        break;
      case "ack":
        this.log("info", `chunk ${pending.chunkId ?? "?"} acknowledged to the strap`);
        this.maybeFinishAfterComplete();
        break;
      default:
        break;
    }
    this.dispatch();
  }

  /** Called by the host once chunk `chunkId` is durably stored. Only then is HISTORICAL_DATA_RESULT written. */
  confirmChunkStored(chunkId: number): void {
    if (this.isFinished()) {
      this.log("debug", `confirmChunkStored(${chunkId}) after the session ended; ignoring`);
      return;
    }
    const chunk = this.awaitingStore.get(chunkId);
    if (!chunk) {
      this.log("warn", `confirmChunkStored(${chunkId}): no such pending chunk`);
      return;
    }
    this.awaitingStore.delete(chunkId);
    this.lastAckedToken = chunk.token.slice();
    this.stats.acked++;
    this.enqueue({ spec: historicalDataResult(chunk.token), purpose: "ack", chunkId });
    this.dispatch();
  }

  /** Abort an open offload. Pending chunks are dropped without acknowledgement (no trim). */
  abort(): void {
    if (this.isFinished()) return;
    if (this._state === "offloading" || this._state === "settling") {
      this.enqueue({ spec: abortHistoricalTransmits(), purpose: "abort" });
    }
    this.awaitingStore.clear();
    this.setState("aborted");
    this.finish("aborted");
    this.dispatch();
  }

  /** TOGGLE_REALTIME_HR; allowed once the handshake is done. */
  requestRealtimeHr(on: boolean): void {
    if (this._state !== "settling" && this._state !== "offloading" && this._state !== "complete") {
      this.log("warn", "requestRealtimeHr ignored: handshake not finished");
      return;
    }
    this.enqueue({ spec: toggleRealtimeHr(on), purpose: "realtime" });
    this.dispatch();
  }

  /** GET_BATTERY_LEVEL poll; allowed once the handshake is done. */
  requestBattery(): void {
    if (this._state !== "settling" && this._state !== "offloading" && this._state !== "complete") return;
    this.enqueue({ spec: getBatteryLevel(), purpose: "battery" });
    this.dispatch();
  }

  /** Advance timers. Call every few hundred milliseconds. */
  tick(nowMs: number): void {
    this.lastTickMs = nowMs;
    if (this.isFinished() || this._state === "idle") return;

    const pending = this.pendingWrite;
    if (pending) {
      const limit = pending.purpose === "bond" ? this.opts.bondAckTimeoutMs : this.opts.writeAckTimeoutMs;
      if (nowMs - pending.sentAtMs > limit) {
        if (pending.purpose === "bond") {
          this.pendingWrite = null;
          this.fail(`bond write (${pending.spec.name}) not acknowledged within ${limit} ms — ${bondRefusedMessage(this.family)}`, true);
          return;
        }
        this.onWriteAck(pending.cmd, pending.seq, false, `no write acknowledgement within ${limit} ms`);
        if (this.isFinished()) return;
      }
    }

    if (this.awaitingStep && nowMs - this.awaitingStep.startedAtMs > this.opts.responseTimeoutMs) {
      this.log("warn", `no response to ${commandName(this.awaitingStep.cmd)} within ${this.opts.responseTimeoutMs} ms; continuing`);
      this.awaitingStep = null;
      this.runNextStep();
    }

    if (this._state === "settling" && nowMs >= this.settleUntilMs && !this.pendingWrite && this.writeQueue.length === 0) {
      this.requestHistory();
    }

    if (this._state === "offloading") {
      for (const chunk of this.awaitingStore.values()) {
        if (!chunk.warned && nowMs - chunk.emittedAtMs > this.opts.storeConfirmWarnMs) {
          chunk.warned = true;
          this.log("warn", `chunk ${chunk.chunkId} still not confirmed by the host after ${this.opts.storeConfirmWarnMs} ms; the strap is not acknowledged until it is`);
        }
      }
      if (this.awaitingStore.size === 0 && nowMs - this.lastOffloadFrameMs > this.opts.idleTimeoutMs) {
        if (this.reRequests < this.opts.maxReRequests) {
          this.reRequests++;
          this.log("warn", `offload idle for ${this.opts.idleTimeoutMs} ms; re-requesting history (${this.reRequests}/${this.opts.maxReRequests})`);
          this.lastOffloadFrameMs = nowMs;
          this.enqueue({ spec: sendHistoricalData(), purpose: "history" });
        } else {
          this.error("offload stalled: no history frames after repeated requests", false);
          this.finish("stalled");
        }
      }
    }
    this.dispatch();
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  private beginHandshake(): void {
    this.setState("handshake");
    this.stepIndex = 0;
    this.steps = this.family === "whoop4" ? this.whoop4Steps() : this.whoop5Steps();
    this.runNextStep();
  }

  /** PROTOCOL_WHOOP4.md § "Bond handshake & connect lifecycle": the ordered sequence, run once. */
  private whoop4Steps(): HandshakeStep[] {
    return [
      { build: () => getHelloHarvard() },
      { build: () => getAdvertisingNameHarvard() },
      { build: () => reportVersionInfo() },
      // Both SET_CLOCK forms: 41.17.6.0 was observed to latch only the 9-byte body; other firmware the 8-byte one.
      { build: () => setClock8(this.nowUnix()) },
      { build: () => setClock9(this.nowUnix()) },
      { build: () => getClockEmpty() },
      { build: () => getClockZero() },
      // Stops the ~2/s type-43 raw flood so it does not starve the offload (BLE_REVERSE_ENGINEERING.md § 4).
      { build: () => sendR10R11Realtime(false) },
      { build: () => getDataRange() },
    ];
  }

  /**
   * WHOOP 5/MG: the 4.0 handshake commands 76/7/63 return UNSUPPORTED (PROTOCOL_COMMANDS.md matrix),
   * so the post-hello sequence is the revision-1 clock readback (147), a conditional SET_CLOCK (146)
   * when the strap has drifted, then GET_DATA_RANGE which 5.0 expects before history.
   */
  private whoop5Steps(): HandshakeStep[] {
    return [
      {
        build: () => getClock5(),
        awaitResponse: true,
        onResponse: (_response, decoded) => {
          if (decoded.kind === "clock") {
            this.clockDriftS = decoded.clock.unix - this.nowUnix();
            this.log("info", `strap clock drift ${this.clockDriftS.toFixed(0)} s`);
          }
        },
      },
      {
        build: () => {
          this.clockWritten = true;
          return setClock5(this.nowUnix(), 0);
        },
        skipIf: () => this.clockDriftS === null || Math.abs(this.clockDriftS) <= this.opts.clockDriftThresholdS,
      },
      { build: () => getClock5(), awaitResponse: true, skipIf: () => !this.clockWritten },
      { build: () => getDataRange() },
    ];
  }

  private runNextStep(): void {
    if (this._state !== "handshake") return;
    while (this.stepIndex < this.steps.length) {
      const step = this.steps[this.stepIndex++];
      if (step.skipIf?.()) continue;
      this.enqueue({ spec: step.build(), purpose: "handshake", step });
      return;
    }
    this.log("info", `handshake complete; settling ${this.opts.settleMs} ms before the first offload`);
    this.setState("settling");
    this.settleUntilMs = this.lastTickMs + this.opts.settleMs;
  }

  private requestHistory(): void {
    this.setState("offloading");
    this.lastOffloadFrameMs = this.lastTickMs;
    this.chunkOpen = false;
    this.enqueue({ spec: sendHistoricalData(), purpose: "history" });
  }

  private requestHistoryFailed(): void {
    if (this.reRequests < this.opts.maxReRequests) {
      this.reRequests++;
      this.enqueue({ spec: sendHistoricalData(), purpose: "history" });
    } else {
      this.error("SEND_HISTORICAL_DATA could not be written", false);
      this.finish("stalled");
    }
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  private route(frame: ParsedFrame): void {
    if (OFFLOAD_PACKET_TYPES.has(frame.type)) this.lastOffloadFrameMs = this.lastTickMs;
    switch (frame.type) {
      case PacketType.COMMAND_RESPONSE:
      case PacketType.PUFFIN_COMMAND_RESPONSE:
        this.handleResponse(frame);
        break;
      case PacketType.EVENT:
        this.handleEvent(frame);
        break;
      case PacketType.METADATA:
      case PacketType.PUFFIN_METADATA:
        this.handleMetadata(frame);
        break;
      case PacketType.HISTORICAL_DATA:
        this.handleHistorical(frame);
        break;
      case PacketType.REALTIME_DATA: {
        const record = decodeRealtime(frame);
        if (record) this.emit({ kind: "record", record: { source: "realtime", ...record } });
        break;
      }
      case PacketType.REALTIME_RAW_DATA:
        break; // the type-43 flood; disabled on connect, ignored otherwise
      case PacketType.CONSOLE_LOGS:
        this.log("debug", `console log frame (${frame.payload.length} bytes)`);
        break;
      default:
        this.log("debug", `unhandled packet type ${frame.type} (${frame.raw.length} bytes)`);
    }
  }

  private handleResponse(frame: ParsedFrame): void {
    const response = decodeCommandResponse(frame);
    if (!response) return;
    const request = this.outstanding.get(response.originSeq);
    const matchedRequest = request !== undefined && request.cmd === response.cmd;
    if (matchedRequest && response.result !== CommandResult.PENDING) this.outstanding.delete(response.originSeq);
    const decoded = decodeResponseBody(response, this.family);
    this.log("debug", `response ${commandName(response.cmd)} origin ${response.originSeq} ${response.resultName} (${response.body.length} bytes)`);
    if (decoded.kind === "hello" && decoded.hello.serial) this.log("info", `strap serial ${decoded.hello.serial}`);
    if (response.cmd === Command.SEND_HISTORICAL_DATA && response.result === CommandResult.FAILURE) {
      this.log("warn", "strap refused SEND_HISTORICAL_DATA (result FAILURE)");
    }
    this.emit({ kind: "response", response, decoded, matchedRequest });

    const awaiting = this.awaitingStep;
    if (awaiting && awaiting.cmd === response.cmd) {
      awaiting.step.onResponse?.(response, decoded);
      if (response.result !== CommandResult.PENDING) {
        this.awaitingStep = null;
        this.runNextStep();
      }
    }
  }

  private handleEvent(frame: ParsedFrame): void {
    const event = decodeEvent(frame);
    if (!event) return;
    if (event.id === EventId.PAIRING_MODE) this.log("info", "strap reports PAIRING_MODE");
    if (event.id === EventId.BLE_BONDED) this.log("info", "strap reports BLE_BONDED");
    this.emit({ kind: "event", event });
  }

  private handleMetadata(frame: ParsedFrame): void {
    const meta = decodeMetadata(frame);
    if (!meta) return;
    if (this._state !== "offloading") {
      this.log("debug", `${meta.name} outside an offload; ignoring`);
      return;
    }
    switch (meta.name) {
      case "HISTORY_START":
        this.log("info", "HISTORY_START");
        this.startSeen = true;
        this.chunkOpen = true;
        break;
      case "HISTORY_END":
        this.handleHistoryEnd(meta);
        break;
      case "HISTORY_COMPLETE":
        this.log("info", `HISTORY_COMPLETE (${this.awaitingStore.size} chunk(s) still awaiting host confirmation)`);
        this.completeSeen = true;
        this.maybeFinishAfterComplete();
        break;
      default:
        this.log("debug", `unknown metadata type ${meta.type}`);
    }
  }

  private handleHistoryEnd(meta: HistoryMetadata): void {
    if (!meta.token) {
      this.error("HISTORY_END without an acknowledgement token; chunk kept, not acknowledged", false);
      return;
    }
    // The strap resends an unanswered END (up to four times) with the same token: do not open a second chunk.
    for (const chunk of this.awaitingStore.values()) {
      if (sameBytes(chunk.token, meta.token)) {
        this.log("debug", `repeated HISTORY_END for chunk ${chunk.chunkId} while the host is still storing it`);
        return;
      }
    }
    if (this.lastAckedToken && sameBytes(this.lastAckedToken, meta.token) && this.current.rawFrames.length === 0) {
      // Our ack may not have reached the strap; it is idempotent since the host already stored the chunk.
      this.log("info", "HISTORY_END repeats an already-stored token; re-acknowledging");
      this.enqueue({ spec: historicalDataResult(meta.token), purpose: "ack" });
      this.dispatch();
      return;
    }
    if (!this.startSeen) this.log("warn", "HISTORY_END before any HISTORY_START");
    const chunkId = ++this.chunkCounter;
    const effect: ChunkEffect = {
      kind: "chunk",
      chunkId,
      records: this.current.records,
      rawFrames: this.current.rawFrames,
      token: meta.token.slice(),
      endUnix: meta.unix ?? null,
    };
    this.current = { records: [], rawFrames: [] };
    this.stats.chunks++;
    this.awaitingStore.set(chunkId, { ...effect, emittedAtMs: this.lastTickMs, warned: false });
    this.log("info", `HISTORY_END: chunk ${chunkId} with ${effect.records.length} record(s), trim cursor ${meta.trimCursor ?? "?"}; waiting for the host to persist it`);
    this.emit(effect);
    this.emit({ kind: "offloadProgress", records: this.stats.records, chunks: this.stats.chunks });
  }

  private handleHistorical(frame: ParsedFrame): void {
    if (this._state !== "offloading") {
      this.log("debug", "type-47 record outside an offload; ignoring");
      return;
    }
    if (!this.chunkOpen && !this.startSeen) this.log("debug", "type-47 record before HISTORY_START; accumulating anyway");
    this.current.rawFrames.push(frame.raw.slice());
    const record = decodeHistorical(frame);
    if (!record) {
      this.stats.unknownRecords++;
      if (this.stats.unknownRecords <= 3) this.log("warn", `unknown type-47 layout version ${frame.seq} (${frame.raw.length} bytes); kept raw`);
      return;
    }
    this.stats.records++;
    this.current.records.push(record);
    this.emit({ kind: "record", record: { source: "historical", chunkId: this.chunkCounter + 1, ...record } });
    if (this.stats.records % 50 === 0) this.emit({ kind: "offloadProgress", records: this.stats.records, chunks: this.stats.chunks });
  }

  private maybeFinishAfterComplete(): void {
    if (!this.completeSeen || this._state !== "offloading") return;
    if (this.awaitingStore.size > 0) return;
    if (this.pendingWrite?.purpose === "ack" || this.writeQueue.some((w) => w.purpose === "ack")) return;
    if (this.current.rawFrames.length > 0) {
      this.log("warn", `${this.current.rawFrames.length} record(s) arrived after the last HISTORY_END and were not acknowledged; the strap will resend them`);
    }
    this.setState("complete");
    this.finish("complete");
  }

  // -------------------------------------------------------------------------
  // Write queue
  // -------------------------------------------------------------------------

  private enqueue(write: QueuedWrite): void {
    this.writeQueue.push(write);
  }

  /** Issues the next write when none is outstanding. One GATT operation at a time keeps Android happy. */
  private dispatch(): void {
    if (this.pendingWrite || this.writeQueue.length === 0) return;
    if (this.isFinished() && this.writeQueue[0].purpose !== "abort") {
      this.writeQueue.length = 0;
      return;
    }
    const next = this.writeQueue.shift()!;
    const seq = next.fixed ? next.fixed.seq : this.seq.next();
    const bytes = next.fixed ? next.fixed.bytes : encodeCommand(next.spec, seq, this.family);
    this.outstanding.set(seq, { cmd: next.spec.cmd, name: next.spec.name });
    this.pendingWrite = { ...next, cmd: next.spec.cmd, seq, sentAtMs: this.lastTickMs };
    this.emit({
      kind: "write",
      withResponse: next.spec.withResponse,
      bytes,
      cmd: next.spec.cmd,
      seq,
      name: next.spec.name,
      purpose: next.purpose,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private nowUnix(): number {
    return Math.floor(this.startUnix + (this.lastTickMs - this.startMs) / 1000);
  }

  private isFinished(): boolean {
    return this._state === "complete" || this._state === "aborted" || this._state === "failed";
  }

  private setState(state: SessionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit({ kind: "state", state });
  }

  private log(level: LogLevel, message: string): void {
    this.emit({ kind: "log", level, message });
  }

  private error(message: string, fatal: boolean): void {
    this.emit({ kind: "error", message, fatal });
  }

  private fail(message: string, fatal: boolean): void {
    this.error(message, fatal);
    this.writeQueue.length = 0;
    this.pendingWrite = null;
    this.awaitingStore.clear();
    this.setState("failed");
    this.finish("failed");
  }

  private finish(reason: DoneSummary["reason"]): void {
    this.emit({
      kind: "done",
      summary: {
        reason,
        complete: reason === "complete",
        records: this.stats.records,
        unknownRecords: this.stats.unknownRecords,
        chunks: this.stats.chunks,
        acked: this.stats.acked,
        unacked: this.stats.chunks - this.stats.acked,
        durationMs: Math.max(0, this.lastTickMs - this.startMs),
      },
    });
  }

  private emit(effect: Effect): void {
    if (this.onEffect) this.onEffect(effect);
    else this.effects.push(effect);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
