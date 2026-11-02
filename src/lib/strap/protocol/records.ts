/**
 * Decoders for strap → app frames. All offsets below are quoted as the
 * documented *absolute* WHOOP 4 frame offsets and read relative to the frame's
 * inner-record offset (4 on WHOOP 4, 8 on WHOOP 5), because PROTOCOL_IMPLEMENTATION.md
 * § "EventNumber" and PROTOCOL_TRANSPORT.md § "Responses and correlation" document the
 * 5.0 envelope as the same inner layout shifted by +4 for responses, events and
 * metadata. Record layouts (type 40 / 47) are family-specific and selected explicitly.
 *
 * Decoders never throw and return null when the frame is not the expected type
 * or is too short for the documented layout.
 */
import {
  CommandResult,
  Command,
  EventId,
  MAX_PLAUSIBLE_UNIX,
  MIN_PLAUSIBLE_UNIX,
  MetadataType,
  PacketType,
  commandResultName,
  eventName,
  type StrapFamily,
} from "./constants";
import type { ParsedFrame } from "./framing";

/** Bounds-checked little-endian reader over a frame's inner record. */
class FrameReader {
  private readonly view: DataView;
  constructor(
    private readonly raw: Uint8Array,
    /** Exclusive end of readable bytes (the CRC32 trailer starts here). */
    readonly end: number,
  ) {
    this.view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  has(offset: number, width: number): boolean {
    return offset >= 0 && offset + width <= this.end;
  }
  u8(o: number): number | null {
    return this.has(o, 1) ? this.raw[o] : null;
  }
  u16(o: number): number | null {
    return this.has(o, 2) ? this.view.getUint16(o, true) : null;
  }
  i16(o: number): number | null {
    return this.has(o, 2) ? this.view.getInt16(o, true) : null;
  }
  u32(o: number): number | null {
    return this.has(o, 4) ? this.view.getUint32(o, true) : null;
  }
  f32(o: number): number | null {
    return this.has(o, 4) ? this.view.getFloat32(o, true) : null;
  }
  bytes(o: number, width: number): Uint8Array | null {
    return this.has(o, width) ? this.raw.slice(o, o + width) : null;
  }
}

function reader(frame: ParsedFrame): FrameReader {
  return new FrameReader(frame.raw, frame.innerEnd);
}

export function isPlausibleUnix(value: number | null | undefined): value is number {
  return typeof value === "number" && value >= MIN_PLAUSIBLE_UNIX && value <= MAX_PLAUSIBLE_UNIX;
}

/** WHOOP 5 R-R ticks (1/1024 s) to integer milliseconds: `(ticks * 1000 + 512) // 1024` (PROTOCOL_SENSORS.md § Packet 40). */
export function ticksToMs(ticks: number): number {
  return Math.floor((ticks * 1000 + 512) / 1024);
}

// ---------------------------------------------------------------------------
// Type 36 — command response
// ---------------------------------------------------------------------------
export interface CommandResponse {
  cmd: number;
  /** Sequence of the request this answers (frame[7] on 4.0, frame[11] on 5.0); the frame's own seq is not it. */
  originSeq: number;
  result: number;
  resultName: string;
  /** Command body from frame[9] (4.0) / frame[13] (5.0) up to the CRC trailer (5.0 padding included). */
  body: Uint8Array;
}

/** Decodes a type-36 (or puffin type-38) response: command at 6, origin seq at 7, result at 8, body from 9 (4.0 absolute). */
export function decodeCommandResponse(frame: ParsedFrame): CommandResponse | null {
  if (!frame.ok) return null;
  if (frame.type !== PacketType.COMMAND_RESPONSE && frame.type !== PacketType.PUFFIN_COMMAND_RESPONSE) return null;
  const r = reader(frame);
  const base = frame.innerOffset;
  const cmd = r.u8(base + 2);
  const originSeq = r.u8(base + 3);
  const result = r.u8(base + 4);
  if (cmd === null || originSeq === null || result === null) return null;
  return { cmd, originSeq, result, resultName: commandResultName(result), body: frame.raw.slice(base + 5, frame.innerEnd) };
}

// ---------------------------------------------------------------------------
// Type 48 — events
// ---------------------------------------------------------------------------
export interface BatteryEvent {
  /** State of charge in percent (`u16le / 10` at frame 17 on 4.0 / 21 on 5.0). */
  percent: number;
  millivolts: number;
  charging: boolean;
}

export interface StrapEvent {
  id: number;
  name: string;
  /** u32 at frame 8 (4.0) / 12 (5.0); wall-time only if the strap clock is valid. */
  unix: number;
  /** Raw bytes after the timestamp, for events without a documented layout. */
  payload: Uint8Array;
  battery?: BatteryEvent;
}

/** Decodes a type-48 event: event id at 6, u32 time at 8 (4.0 absolute). Battery payload per PROTOCOL_TRANSPORT.md § "WHOOP 4 battery sources". */
export function decodeEvent(frame: ParsedFrame): StrapEvent | null {
  if (!frame.ok || frame.type !== PacketType.EVENT) return null;
  const r = reader(frame);
  const base = frame.innerOffset;
  const id = r.u8(base + 2);
  const unix = r.u32(base + 4);
  if (id === null || unix === null) return null;
  const event: StrapEvent = { id, name: eventName(id), unix, payload: frame.raw.slice(base + 8, frame.innerEnd) };
  if (id === EventId.BATTERY_LEVEL) {
    // 4.0 absolute: soc u16@17, mV u16@21, charging bit0 @26 → inner-relative 13 / 17 / 22.
    const soc = r.u16(base + 13);
    const mv = r.u16(base + 17);
    const flags = r.u8(base + 22);
    if (soc !== null && mv !== null && flags !== null && soc <= 1000) {
      event.battery = { percent: soc / 10, millivolts: mv, charging: (flags & 1) === 1 };
    }
  }
  return event;
}

// ---------------------------------------------------------------------------
// Type 49 — history metadata
// ---------------------------------------------------------------------------
export interface HistoryMetadata {
  type: number;
  name: "HISTORY_START" | "HISTORY_END" | "HISTORY_COMPLETE" | "UNKNOWN";
  /** HISTORY_END: u32 at frame 7 (4.0) / 11 (5.0). */
  unix?: number;
  /** HISTORY_END: u16 at frame 11 (4.0) / 15 (5.0). */
  subseconds?: number;
  /** HISTORY_END: the eight acknowledgement bytes at frame[17..25) (4.0) / [21..29) (5.0), copied verbatim. */
  token?: Uint8Array;
  /** First word of the token — informational only; the ack echoes the whole token. */
  trimCursor?: number;
}

/** Decodes a type-49 (or puffin type-56) metadata frame: metadata type at 6 (4.0 absolute). */
export function decodeMetadata(frame: ParsedFrame): HistoryMetadata | null {
  if (!frame.ok) return null;
  if (frame.type !== PacketType.METADATA && frame.type !== PacketType.PUFFIN_METADATA) return null;
  const r = reader(frame);
  const base = frame.innerOffset;
  const type = r.u8(base + 2);
  if (type === null) return null;
  const name =
    type === MetadataType.HISTORY_START
      ? "HISTORY_START"
      : type === MetadataType.HISTORY_END
        ? "HISTORY_END"
        : type === MetadataType.HISTORY_COMPLETE
          ? "HISTORY_COMPLETE"
          : "UNKNOWN";
  const meta: HistoryMetadata = { type, name };
  if (type === MetadataType.HISTORY_END) {
    const unix = r.u32(base + 3);
    const subseconds = r.u16(base + 7);
    const token = r.bytes(base + 13, 8);
    if (unix !== null) meta.unix = unix;
    if (subseconds !== null) meta.subseconds = subseconds;
    if (token) {
      meta.token = token;
      meta.trimCursor = new DataView(token.buffer, token.byteOffset, 8).getUint32(0, true);
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Type 40 — realtime HR + R-R
// ---------------------------------------------------------------------------
export interface RealtimeRecord {
  unix: number;
  subseconds: number;
  hr: number;
  /** R-R intervals in milliseconds, zeros omitted. */
  rr: number[];
}

/**
 * Decodes a type-40 realtime record. WHOOP 4 (PROTOCOL_SENSORS.md § type 40): unix at 6,
 * subseconds at 10, HR u8 at 12, R-R count at 13, R-R u16 ms from 14. WHOOP 5 (§ Packet 40):
 * the same slots at +4 but R-R in 1/1024-second ticks.
 */
export function decodeRealtime(frame: ParsedFrame): RealtimeRecord | null {
  if (!frame.ok || frame.type !== PacketType.REALTIME_DATA) return null;
  const r = reader(frame);
  const base = frame.innerOffset;
  const unix = r.u32(base + 2);
  const subseconds = r.u16(base + 6);
  const hr = r.u8(base + 8);
  const count = r.u8(base + 9);
  if (unix === null || subseconds === null || hr === null || count === null) return null;
  const rr = readRr(r, base + 10, count, frame.family, Infinity);
  return { unix, subseconds, hr, rr };
}

function readRr(r: FrameReader, start: number, count: number, family: StrapFamily, maxWords: number): number[] {
  const rr: number[] = [];
  const n = Math.min(count, maxWords);
  for (let i = 0; i < n; i++) {
    const word = r.u16(start + 2 * i);
    if (word === null) break; // never consume an incomplete word
    if (word === 0) continue; // zero is a placeholder, not a measured interval
    rr.push(family === "whoop5" ? ticksToMs(word) : word);
  }
  return rr;
}

// ---------------------------------------------------------------------------
// Type 47 — historical records
// ---------------------------------------------------------------------------
export interface HistoricalRecord {
  family: StrapFamily;
  /** Record layout version: frame[5] on 4.0, frame[9] on 5.0. */
  version: number;
  unix: number;
  /** Beats per minute, or null when the layout carries no HR field (v25). */
  hr: number | null;
  /** R-R intervals in milliseconds, zeros omitted. */
  rr: number[];
  /** Gravity vector in g. */
  gravity?: [number, number, number];
  /** v24: 0 = off-wrist (capacitive). */
  skinContact?: number;
  /** v24: raw skin-temperature ADC (not degrees). v18: the raw u16 at frame 73 (documented convention raw/100 °C, see skinTempC). */
  rawSkinTemp?: number;
  /** v24: raw red / IR optical scalars; not an SpO2 percentage. */
  rawSpo2?: { red: number; ir: number };
  /** v24: raw respiration-adjacent scalar; not breaths per minute. */
  rawResp?: number;
  /** v24: signal-quality word (scale unresolved). v18: raw quality-flags byte at frame 36. */
  quality?: number;
  /** v18 only: record index (u32 at 11); not a timestamp. */
  index?: number;
  /** v18 only: `rawSkinTemp / 100` when inside the documented 5–45 °C acceptance band. */
  skinTempC?: number;
  /** v18 only: selected cumulative step counter (u16 at 57); rollover/reset unresolved. */
  steps?: number;
  /** v18 only: 0 still, 1 walk, 2 run, 0xFF other. */
  activity?: number;
  /** v18 only: band motion/rest state from byte 81 bits 4–5: 0 WAKE, 1 STILL, 2 SLEEP, 3 UP. */
  bandState?: number;
  /** v24: raw green / red-IR PPG scalars at 33 / 35. */
  rawPpg?: { green: number; redIr: number };
}

/** Historical layouts this decoder maps. Others return null and must be preserved raw. */
export const KNOWN_HISTORICAL_VERSIONS: Record<StrapFamily, readonly number[]> = {
  whoop4: [5, 7, 9, 12, 24, 25],
  whoop5: [18],
};

/**
 * Decodes a type-47 record by its version byte (frame[5] on 4.0, frame[9] on 5.0).
 * Returns null for unknown layouts; the caller must keep the raw frame.
 */
export function decodeHistorical(frame: ParsedFrame): HistoricalRecord | null {
  if (!frame.ok || frame.type !== PacketType.HISTORICAL_DATA) return null;
  const version = frame.seq;
  if (frame.family === "whoop4") {
    switch (version) {
      case 12:
      case 24:
        return decodeV24(frame, version);
      case 25:
        return decodeV25(frame);
      case 5:
      case 7:
      case 9:
        return decodeGenericHr(frame, version);
      default:
        return null;
    }
  }
  if (version === 18) return decodeV18(frame);
  return null;
}

/** WHOOP 4 v24 / v12 (PROTOCOL_SENSORS.md § "WHOOP 4 historical v24"; absolute 4.0 frame offsets). */
function decodeV24(frame: ParsedFrame, version: number): HistoricalRecord | null {
  const r = reader(frame);
  const unix = r.u32(11);
  const hr = r.u8(21);
  const count = r.u8(22);
  if (unix === null || hr === null || count === null) return null;
  // R-R words sit at 23 + 2n and must not run into the optical scalars at 33: at most five words.
  const rr = readRr(r, 23, count, "whoop4", 5);
  const rec: HistoricalRecord = { family: "whoop4", version, unix, hr, rr };
  const green = r.u16(33);
  const redIr = r.u16(35);
  if (green !== null && redIr !== null) rec.rawPpg = { green, redIr };
  const gx = r.f32(40);
  const gy = r.f32(44);
  const gz = r.f32(48);
  if (gx !== null && gy !== null && gz !== null && Number.isFinite(gx + gy + gz)) rec.gravity = [gx, gy, gz];
  const contact = r.u8(55);
  if (contact !== null) rec.skinContact = contact;
  const red = r.u16(68);
  const ir = r.u16(70);
  if (red !== null && ir !== null) rec.rawSpo2 = { red, ir };
  const temp = r.u16(72);
  if (temp !== null) rec.rawSkinTemp = temp;
  const resp = r.u16(80);
  if (resp !== null) rec.rawResp = resp;
  const quality = r.u16(82);
  if (quality !== null) rec.quality = quality;
  return rec;
}

/** WHOOP 4 v25: 84-byte frame, unix at 11, i16 gravity /16384 at 73/75/77, no HR (PROTOCOL_SENSORS.md § v25). */
function decodeV25(frame: ParsedFrame): HistoricalRecord | null {
  if (frame.raw.length !== 84) return null;
  const r = reader(frame);
  const unix = r.u32(11);
  const gx = r.i16(73);
  const gy = r.i16(75);
  const gz = r.i16(77);
  if (unix === null || gx === null || gy === null || gz === null) return null;
  return { family: "whoop4", version: 25, unix, hr: null, rr: [], gravity: [gx / 16384, gy / 16384, gz / 16384] };
}

/** WHOOP 4 v5/7/9: generic HR/R-R-only record, unix at 11, HR at 21, count at 22, R-R from 23 (whoop_protocol.json). */
function decodeGenericHr(frame: ParsedFrame, version: number): HistoricalRecord | null {
  const r = reader(frame);
  const unix = r.u32(11);
  const hr = r.u8(21);
  const count = r.u8(22);
  if (unix === null || hr === null || count === null) return null;
  return { family: "whoop4", version, unix, hr, rr: readRr(r, 23, count, "whoop4", Infinity) };
}

/**
 * WHOOP 5/MG R18 biometric summary, 124-byte frame (PROTOCOL_SENSORS.md § "R18: biometric summary";
 * BLE_REVERSE_ENGINEERING.md § "The WHOOP 5.0 type-47 record (version 18)"). Absolute 5.0 offsets:
 * layout 18 at 9, index u32 at 11, unix u32 at 15, HR at 22, R-R count at 23, up to four R-R tick
 * words from 24, quality flags at 36, gravity f32 at 45/49/53, steps u16 at 57, activity at 63,
 * aux thermal i16 at 69/71, skin temperature u16 raw/100 °C at 73, state bits at 81.
 */
function decodeV18(frame: ParsedFrame): HistoricalRecord | null {
  const r = reader(frame);
  const index = r.u32(11);
  const unix = r.u32(15);
  const hr = r.u8(22);
  const count = r.u8(23);
  if (index === null || unix === null || hr === null || count === null) return null;
  const rec: HistoricalRecord = { family: "whoop5", version: 18, unix, hr, rr: readRr(r, 24, count, "whoop5", 4), index };
  const quality = r.u8(36);
  if (quality !== null) rec.quality = quality;
  const gx = r.f32(45);
  const gy = r.f32(49);
  const gz = r.f32(53);
  if (gx !== null && gy !== null && gz !== null && Number.isFinite(gx + gy + gz)) rec.gravity = [gx, gy, gz];
  const steps = r.u16(57);
  if (steps !== null) rec.steps = steps;
  const activity = r.u8(63);
  if (activity !== null) rec.activity = activity;
  const temp = r.u16(73);
  if (temp !== null) {
    rec.rawSkinTemp = temp;
    const c = temp / 100;
    if (c >= 5 && c <= 45) rec.skinTempC = c;
  }
  const state = r.u8(81);
  if (state !== null) rec.bandState = (state >> 4) & 3;
  return rec;
}

// ---------------------------------------------------------------------------
// Command-response bodies
// ---------------------------------------------------------------------------
export interface HelloInfo {
  family: StrapFamily;
  /** WHOOP 4: the nine-character serial from GET_HELLO_HARVARD body offset 14. Null when not plausible. */
  serial: string | null;
  /** WHOOP 5: firmware version from the GET_HELLO final body (bytes 91..98), e.g. "50.42.1.0". */
  firmware?: string;
  /** WHOOP 5: battery tenths-of-percent at body 1 → percent. */
  batteryPercent?: number;
  /** WHOOP 5: strap clock seconds at body 6. */
  unix?: number;
  /** WHOOP 5: preparation status bits at body 103; 0x10 / 0x20 mean identity blocks were not filled. */
  preparationBits?: number;
  bodyLength: number;
}

const SERIAL_RE = /^[A-Za-z0-9]{9}$/;

/**
 * Decodes a hello body. WHOOP 4 (PROTOCOL_WHOOP4.md § "GET_HELLO_HARVARD (35) response"): the
 * body is 131 bytes; the serial occupies the nine bytes at body offset 14 followed by NUL.
 * Bytes 24..78 are key/signature material and are never read, copied or exposed.
 * WHOOP 5 (PROTOCOL_TRANSPORT.md § "Hello — command 145"): only version, battery, clock and
 * preparation bits are extracted; identity text blocks and the opaque block at 25..49 are not copied.
 */
export function decodeHello(body: Uint8Array, family: StrapFamily): HelloInfo {
  const info: HelloInfo = { family, serial: null, bodyLength: body.length };
  if (family === "whoop4") {
    if (body.length >= 24) {
      const field = body.subarray(14, 24);
      let text = "";
      for (let i = 0; i < 9; i++) text += String.fromCharCode(field[i]);
      if (SERIAL_RE.test(text) && field[9] === 0) info.serial = text;
    }
    return info;
  }
  if (body.length >= 107) {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    info.batteryPercent = view.getUint32(1, true) / 10;
    info.unix = view.getUint32(6, true);
    info.firmware = `${body[91]}.${body[92]}.${body[93]}.${view.getUint32(94, true)}`;
    info.preparationBits = view.getUint32(103, true);
  }
  return info;
}

export interface VersionInfo {
  revision: number;
  /** Four u32le components at body 1..17, e.g. "41.17.6.0". */
  harvard: string;
  /** Four u32le components at body 17..33, e.g. "17.2.2.0". */
  boylston: string;
}

/** REPORT_VERSION_INFO (7), WHOOP 4: 68-byte body, revision at 0, Harvard u32×4 at 1, Boylston u32×4 at 17 (PROTOCOL_COMMANDS.md § WHOOP 4 row 7). */
export function decodeVersionInfo(body: Uint8Array): VersionInfo | null {
  if (body.length < 33) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const quad = (at: number) => [0, 4, 8, 12].map((o) => view.getUint32(at + o, true)).join(".");
  return { revision: body[0], harvard: quad(1), boylston: quad(17) };
}

export interface BatteryInfo {
  percent: number;
  /** WHOOP 4 bodies carry tenths; WHOOP 5 bodies carry whole percent. */
  unit: "tenths" | "percent";
}

/**
 * GET_BATTERY_LEVEL (26). WHOOP 4: body begins with `u16le` tenths of a percent (`/ 10`).
 * WHOOP 5: four-byte unsigned whole percent (PROTOCOL_TRANSPORT.md § "Battery level — command 26").
 */
export function decodeBattery(body: Uint8Array, family: StrapFamily): BatteryInfo | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (family === "whoop4") {
    if (body.length < 2) return null;
    const tenths = view.getUint16(0, true);
    if (tenths > 1000) return null;
    return { percent: tenths / 10, unit: "tenths" };
  }
  if (body.length < 4) return null;
  const percent = view.getUint32(0, true);
  if (percent > 100) return null;
  return { percent, unit: "percent" };
}

export interface DataRangeInfo {
  /** Oldest / newest plausible Unix seconds found in the body, or null when none. */
  oldestUnix: number | null;
  newestUnix: number | null;
  /** Every plausible u32 Unix value found at 4-byte-aligned body offsets. */
  candidates: number[];
  /** WHOOP 5 65-byte layout (PROTOCOL_TRANSPORT.md § "Data range — command 34") when present. */
  ring?: {
    boundaryA: number;
    readPage: number;
    writePage: number;
    trimBoundary: number;
    wrapState: number;
    capacityPages: number;
    recordEstimate: number;
  };
}

/**
 * GET_DATA_RANGE (34). The WHOOP 4 body layout is undocumented ("not the 65-byte layout"); both
 * families are scanned for plausible Unix seconds at 4-byte-aligned offsets after the first byte
 * (BLE_REVERSE_ENGINEERING.md: "real-unix timestamps as 4-byte-aligned u32s from pay[3]"), and the
 * WHOOP 5 65-byte structured fields are decoded when the body has that shape.
 */
export function decodeDataRange(body: Uint8Array, family: StrapFamily): DataRangeInfo {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const candidates: number[] = [];
  for (const start of [0, 1, 2, 3]) {
    for (let o = start; o + 4 <= body.length; o += 4) {
      const v = view.getUint32(o, true);
      if (isPlausibleUnix(v) && !candidates.includes(v)) candidates.push(v);
    }
  }
  const info: DataRangeInfo = {
    oldestUnix: candidates.length ? Math.min(...candidates) : null,
    newestUnix: candidates.length ? Math.max(...candidates) : null,
    candidates,
  };
  if (family === "whoop5" && body.length >= 65 && body[0] === 1) {
    const w = (o: number) => view.getUint32(o, true);
    info.ring = {
      boundaryA: w(1),
      readPage: w(5),
      writePage: w(9),
      trimBoundary: w(13),
      wrapState: w(17),
      capacityPages: w(21),
      recordEstimate: w(25),
    };
  }
  return info;
}

export interface ClockInfo {
  unix: number;
  /** WHOOP 5: fractional ticks (1/32768 s). */
  ticks?: number;
  /** False when the value had to be found heuristically (WHOOP 4 body layout is undocumented). */
  documented: boolean;
}

/**
 * GET_CLOCK readback. WHOOP 5 (147): seven bytes `revision, seconds u32, ticks u16`
 * (PROTOCOL_TRANSPORT.md § "Clock and identity contracts"). WHOOP 4 (11): the reply body is
 * not documented; the first plausible u32 at body offset 0 or 1 is used and flagged heuristic.
 */
export function decodeClock(body: Uint8Array, family: StrapFamily): ClockInfo | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (family === "whoop5") {
    if (body.length < 7 || body[0] !== 1) return null;
    return { unix: view.getUint32(1, true), ticks: view.getUint16(5, true), documented: true };
  }
  for (const o of [0, 1]) {
    if (o + 4 <= body.length) {
      const v = view.getUint32(o, true);
      if (isPlausibleUnix(v)) return { unix: v, documented: false };
    }
  }
  return null;
}

export interface ExtendedBatteryInfo {
  /** Pack voltage in millivolts: the third u16le at body offset 5 (PROTOCOL_TRANSPORT.md § WHOOP 4 battery sources). */
  packMillivolts: number;
  raw: Uint8Array;
}

/** GET_EXTENDED_BATTERY_INFO (98), WHOOP 4: 25-byte cached record with result 1; result 0 means an empty cache. */
export function decodeExtendedBattery(response: CommandResponse): ExtendedBatteryInfo | null {
  if (response.result !== CommandResult.SUCCESS || response.body.length < 25) return null;
  const view = new DataView(response.body.buffer, response.body.byteOffset, response.body.byteLength);
  return { packMillivolts: view.getUint16(5, true), raw: response.body.slice(0, 25) };
}

/** Everything a command response can decode to, keyed by command. */
export type DecodedResponseBody =
  | { kind: "battery"; battery: BatteryInfo }
  | { kind: "hello"; hello: HelloInfo }
  | { kind: "versionInfo"; versionInfo: VersionInfo }
  | { kind: "dataRange"; dataRange: DataRangeInfo }
  | { kind: "clock"; clock: ClockInfo }
  | { kind: "extendedBattery"; extendedBattery: ExtendedBatteryInfo }
  | { kind: "raw" };

/** Dispatches a successful response body to its decoder. Pending / failed results decode to `raw`. */
export function decodeResponseBody(response: CommandResponse, family: StrapFamily): DecodedResponseBody {
  if (response.result !== CommandResult.SUCCESS) return { kind: "raw" };
  switch (response.cmd) {
    case Command.GET_BATTERY_LEVEL: {
      const battery = decodeBattery(response.body, family);
      return battery ? { kind: "battery", battery } : { kind: "raw" };
    }
    case Command.GET_HELLO_HARVARD:
      return family === "whoop4" ? { kind: "hello", hello: decodeHello(response.body, family) } : { kind: "raw" };
    case Command.GET_HELLO:
      return family === "whoop5" ? { kind: "hello", hello: decodeHello(response.body, family) } : { kind: "raw" };
    case Command.REPORT_VERSION_INFO: {
      const versionInfo = decodeVersionInfo(response.body);
      return versionInfo ? { kind: "versionInfo", versionInfo } : { kind: "raw" };
    }
    case Command.GET_DATA_RANGE:
      return { kind: "dataRange", dataRange: decodeDataRange(response.body, family) };
    case Command.GET_CLOCK:
    case Command.GET_CLOCK_V5: {
      const clock = decodeClock(response.body, family);
      return clock ? { kind: "clock", clock } : { kind: "raw" };
    }
    case Command.GET_EXTENDED_BATTERY_INFO: {
      const extendedBattery = decodeExtendedBattery(response);
      return extendedBattery ? { kind: "extendedBattery", extendedBattery } : { kind: "raw" };
    }
    default:
      return { kind: "raw" };
  }
}
