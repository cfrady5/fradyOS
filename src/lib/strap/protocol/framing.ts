/**
 * Frame envelopes and reassembly for both WHOOP generations.
 *
 * WHOOP 4 (PROTOCOL_WHOOP4.md § "WHOOP 4 envelope"):
 *   [0] 0xAA | [1..3) length u16le | [3] crc8(length bytes) | [4] type | [5] seq | [6] cmd | [7..length) payload | [length..+4) crc32le
 *   length = inner.length + 4; complete size = length + 4; minimum 11 bytes; size must match exactly.
 *
 * WHOOP 5/MG format 1 (PROTOCOL_TRANSPORT.md § "Format 1 framing"):
 *   [0] 0xAA | [1] 0x01 | [2..4) length u16le | [4..6) header | [6..8) crc16-modbus over [0,6) |
 *   [8] type | [9] seq | [10] cmd | [11..) body, zero-padded to a 4-byte boundary | crc32le over [8, end-4)
 *   length = paddedBody + 4; complete size = length + 8.
 */
import { crc16Modbus, crc32, crc8 } from "./crc";
import {
  FORBIDDEN_COMMANDS,
  INNER_OFFSET,
  MAX_FRAME_BYTES,
  PacketType,
  SOF,
  WHOOP4_MIN_FRAME,
  WHOOP5_FORMAT_1,
  WHOOP5_MIN_FRAME,
  type StrapFamily,
} from "./constants";

export interface FrameSpec {
  type: number;
  seq: number;
  cmd: number;
  payload?: Uint8Array | ArrayLike<number>;
}

export interface ParsedFrame {
  /** Header checksum + payload CRC32 + structural size all passed. Gate every state change on this. */
  ok: boolean;
  family: StrapFamily;
  /** Packet type (frame[4] on 4.0, frame[8] on 5.0); 0 when unreadable. */
  type: number;
  /** Sequence slot; for type-47 records this is the record version (PROTOCOL_SENSORS.md). */
  seq: number;
  /** Command / event / metadata slot. */
  cmd: number;
  /** Bytes after the cmd slot up to the CRC32 trailer (includes 5.0 padding). */
  payload: Uint8Array;
  /** Absolute offset of the type byte in `raw` (4 or 8). */
  innerOffset: number;
  /** Absolute end (exclusive) of the inner record, i.e. where the CRC32 trailer starts. */
  innerEnd: number;
  raw: Uint8Array;
  error?: string;
}

function toBytes(payload: FrameSpec["payload"]): Uint8Array {
  if (payload === undefined) return new Uint8Array(0);
  return payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
}

function assertSendable(spec: FrameSpec): void {
  if (spec.type === PacketType.COMMAND && FORBIDDEN_COMMANDS.has(spec.cmd)) {
    throw new Error(`refusing to build command ${spec.cmd}: destructive commands are not implemented`);
  }
  if (spec.seq < 0 || spec.seq > 255 || spec.cmd < 0 || spec.cmd > 255 || spec.type < 0 || spec.type > 255) {
    throw new RangeError("type, seq and cmd must be unsigned bytes");
  }
}

/** Builds a WHOOP 4 frame exactly as documented (CRC8 header, CRC32 trailer). */
export function buildFrame(spec: FrameSpec): Uint8Array {
  assertSendable(spec);
  const payload = toBytes(spec.payload);
  const innerLength = 3 + payload.length;
  const length = innerLength + 4;
  if (length > 0xffff) throw new RangeError("payload too large for a u16 length field");
  const frame = new Uint8Array(length + 4);
  const view = new DataView(frame.buffer);
  frame[0] = SOF;
  view.setUint16(1, length, true);
  frame[3] = crc8(frame, 1, 3);
  frame[4] = spec.type;
  frame[5] = spec.seq;
  frame[6] = spec.cmd;
  frame.set(payload, 7);
  view.setUint32(length, crc32(frame, 4, length), true);
  return frame;
}

/**
 * Builds a WHOOP 5/MG format-1 frame. `header` defaults to `00 01` (the value
 * requests commonly carry; responses use `01 00`). The body is zero-padded to a
 * four-byte boundary as the firmware requires; padding is not a semantic argument.
 */
export function buildFrame5(spec: FrameSpec, header: readonly [number, number] = [0x00, 0x01]): Uint8Array {
  assertSendable(spec);
  const payload = toBytes(spec.payload);
  const bodyLength = 3 + payload.length;
  const padded = Math.ceil(bodyLength / 4) * 4;
  const length = padded + 4;
  if (length > 0xffff) throw new RangeError("payload too large for a u16 length field");
  const frame = new Uint8Array(padded + 12);
  const view = new DataView(frame.buffer);
  frame[0] = SOF;
  frame[1] = WHOOP5_FORMAT_1;
  view.setUint16(2, length, true);
  frame[4] = header[0];
  frame[5] = header[1];
  view.setUint16(6, crc16Modbus(frame, 0, 6), true);
  frame[8] = spec.type;
  frame[9] = spec.seq;
  frame[10] = spec.cmd;
  frame.set(payload, 11);
  view.setUint32(8 + padded, crc32(frame, 8, 8 + padded), true);
  return frame;
}

export function buildFrameFor(family: StrapFamily, spec: FrameSpec): Uint8Array {
  return family === "whoop4" ? buildFrame(spec) : buildFrame5(spec);
}

function failed(family: StrapFamily, raw: Uint8Array, error: string): ParsedFrame {
  const innerOffset = INNER_OFFSET[family];
  const at = (i: number) => (i < raw.length ? raw[i] : 0);
  return {
    ok: false,
    family,
    type: at(innerOffset),
    seq: at(innerOffset + 1),
    cmd: at(innerOffset + 2),
    payload: new Uint8Array(0),
    innerOffset,
    innerEnd: innerOffset,
    raw,
    error,
  };
}

/** Reads the complete size a WHOOP 4 frame declares, or null when the header is not yet readable. */
export function declaredTotal4(bytes: Uint8Array, at = 0): number | null {
  if (bytes.length < at + 3) return null;
  return (bytes[at + 1] | (bytes[at + 2] << 8)) + 4;
}

/** Reads the complete size a WHOOP 5 format-1 frame declares, or null when the header is not yet readable. */
export function declaredTotal5(bytes: Uint8Array, at = 0): number | null {
  if (bytes.length < at + 4) return null;
  return (bytes[at + 2] | (bytes[at + 3] << 8)) + 8;
}

/** Validates and splits a complete WHOOP 4 frame. Never throws. */
export function parseFrame(raw: Uint8Array): ParsedFrame {
  const family: StrapFamily = "whoop4";
  if (raw.length < WHOOP4_MIN_FRAME) return failed(family, raw, `frame shorter than ${WHOOP4_MIN_FRAME} bytes`);
  if (raw[0] !== SOF) return failed(family, raw, "missing 0xAA start of frame");
  const length = raw[1] | (raw[2] << 8);
  if (length < 7) return failed(family, raw, "declared length below 7");
  if (length + 4 !== raw.length) return failed(family, raw, `declared size ${length + 4} does not match ${raw.length} bytes`);
  if (crc8(raw, 1, 3) !== raw[3]) return failed(family, raw, "crc8 mismatch");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (crc32(raw, 4, length) !== view.getUint32(length, true)) return failed(family, raw, "crc32 mismatch");
  return {
    ok: true,
    family,
    type: raw[4],
    seq: raw[5],
    cmd: raw[6],
    payload: raw.subarray(7, length),
    innerOffset: 4,
    innerEnd: length,
    raw,
  };
}

/**
 * Validates and splits a complete WHOOP 5/MG format-1 frame. Never throws.
 * The firmware's inbound rule also requires `(length - 4) % 4 === 0` and size > 15;
 * inbound strap frames are accepted here from 13 bytes without the padding rule
 * so an unpadded producer is still surfaced (and logged) rather than dropped.
 */
export function parseFrame5(raw: Uint8Array): ParsedFrame {
  const family: StrapFamily = "whoop5";
  if (raw.length < WHOOP5_MIN_FRAME) return failed(family, raw, `frame shorter than ${WHOOP5_MIN_FRAME} bytes`);
  if (raw[0] !== SOF) return failed(family, raw, "missing 0xAA start of frame");
  if (raw[1] !== WHOOP5_FORMAT_1) return failed(family, raw, `unsupported outer format 0x${raw[1].toString(16)}`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const length = view.getUint16(2, true);
  if (length < 5) return failed(family, raw, "declared length below 5");
  if (length + 8 !== raw.length) return failed(family, raw, `declared size ${length + 8} does not match ${raw.length} bytes`);
  if (crc16Modbus(raw, 0, 6) !== view.getUint16(6, true)) return failed(family, raw, "crc16 mismatch");
  const innerEnd = raw.length - 4;
  if (crc32(raw, 8, innerEnd) !== view.getUint32(innerEnd, true)) return failed(family, raw, "crc32 mismatch");
  return {
    ok: true,
    family,
    type: raw[8],
    seq: raw[9],
    cmd: innerEnd > 10 ? raw[10] : 0,
    payload: raw.subarray(Math.min(11, innerEnd), innerEnd),
    innerOffset: 8,
    innerEnd,
    raw,
  };
}

export function parseFrameFor(family: StrapFamily, raw: Uint8Array): ParsedFrame {
  return family === "whoop4" ? parseFrame(raw) : parseFrame5(raw);
}

export interface ReassemblerStats {
  framesOk: number;
  framesRejected: number;
  /** 0xAA candidates whose declared total fell below the family minimum. */
  belowMinimumDrops: number;
  /** 0xAA candidates whose declared total exceeded `maxFrameBytes`. */
  aboveMaximumDrops: number;
  /** Bytes discarded while searching for a start of frame. */
  garbageBytes: number;
}

/**
 * Accumulates notification fragments from one characteristic and yields complete
 * frames (PROTOCOL_TRANSPORT.md § "WHOOP 4 frame and response procedure";
 * PROTOCOL_IMPLEMENTATION.md § Reassembly). One instance per characteristic:
 * fragments of different characteristics may interleave, frames do not.
 *
 * Frames that fail validation are still returned (with `ok: false`) so the
 * caller can log them; the scanner then resyncs one byte past that 0xAA.
 */
export class Reassembler {
  private buffer = new Uint8Array(0);
  readonly stats: ReassemblerStats = {
    framesOk: 0,
    framesRejected: 0,
    belowMinimumDrops: 0,
    aboveMaximumDrops: 0,
    garbageBytes: 0,
  };

  constructor(
    readonly family: StrapFamily,
    private readonly maxFrameBytes = MAX_FRAME_BYTES,
  ) {}

  /** Bytes currently buffered and waiting for the rest of a frame. */
  get pending(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  feed(chunk: Uint8Array): ParsedFrame[] {
    if (chunk.length > 0) {
      const next = new Uint8Array(this.buffer.length + chunk.length);
      next.set(this.buffer, 0);
      next.set(chunk, this.buffer.length);
      this.buffer = next;
    }
    const out: ParsedFrame[] = [];
    const minimum = this.family === "whoop4" ? WHOOP4_MIN_FRAME : WHOOP5_MIN_FRAME;

    for (;;) {
      const sof = this.buffer.indexOf(SOF);
      if (sof < 0) {
        this.stats.garbageBytes += this.buffer.length;
        this.buffer = new Uint8Array(0);
        return out;
      }
      if (sof > 0) {
        this.stats.garbageBytes += sof;
        this.buffer = this.buffer.subarray(sof);
      }
      const total = this.family === "whoop4" ? declaredTotal4(this.buffer) : declaredTotal5(this.buffer);
      if (total === null) return out; // need more header bytes
      if (total < minimum) {
        this.stats.belowMinimumDrops++;
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (total > this.maxFrameBytes) {
        this.stats.aboveMaximumDrops++;
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < total) return out; // wait for the rest
      const raw = this.buffer.slice(0, total);
      const frame = parseFrameFor(this.family, raw);
      out.push(frame);
      if (frame.ok) {
        this.stats.framesOk++;
        this.buffer = this.buffer.subarray(total);
      } else {
        // A CRC failure may mean this 0xAA was not a real start of frame: resync one byte on.
        this.stats.framesRejected++;
        this.buffer = this.buffer.subarray(1);
      }
    }
  }
}
