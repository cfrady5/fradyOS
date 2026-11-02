/**
 * Typed command builders. Each builder returns a CommandSpec (command number,
 * exact body bytes, whether the GATT write must be confirmed); `encodeCommand`
 * wraps it in the family envelope. Bodies are the documented request forms:
 *   PROTOCOL_COMMANDS.md § "WHOOP 4" table and § "WHOOP 5/MG" table,
 *   PROTOCOL_IMPLEMENTATION.md § "CommandNumber (sending) — client subset",
 *   PROTOCOL_TRANSPORT.md § "Clock and identity contracts" (146/147).
 */
import {
  CLIENT_HELLO_FRAME,
  CLIENT_HELLO_SEQ,
  Command,
  PacketType,
  commandName,
  type StrapFamily,
} from "./constants";
import { buildFrameFor } from "./framing";

export interface CommandSpec {
  name: string;
  cmd: number;
  payload: Uint8Array;
  /**
   * True when the write must be a confirmed GATT write (write-with-response):
   * the WHOOP 4 bond write (26), SEND_HISTORICAL_DATA (22), HISTORICAL_DATA_RESULT (23),
   * ABORT_HISTORICAL_TRANSMITS (20) and the WHOOP 5 CLIENT_HELLO. Everything else
   * may go without response.
   */
  withResponse: boolean;
  /** Families this request form is documented for. */
  families: readonly StrapFamily[];
}

const BOTH: readonly StrapFamily[] = ["whoop4", "whoop5"];
const W4: readonly StrapFamily[] = ["whoop4"];
const W5: readonly StrapFamily[] = ["whoop5"];

function spec(cmd: number, payload: ArrayLike<number>, withResponse: boolean, families: readonly StrapFamily[], name = commandName(cmd)): CommandSpec {
  return { name, cmd, payload: Uint8Array.from(payload), withResponse, families };
}

function u32le(value: number): number[] {
  const v = Math.floor(value) >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function u16le(value: number): number[] {
  const v = Math.floor(value) & 0xffff;
  return [v & 0xff, (v >>> 8) & 0xff];
}

/** GET_BATTERY_LEVEL (26) `[0x00]`, confirmed write; on WHOOP 4 this is the bonding trigger. */
export function getBatteryLevel(): CommandSpec {
  return spec(Command.GET_BATTERY_LEVEL, [0x00], true, BOTH);
}

/** GET_HELLO_HARVARD (35) `[0x00]` — WHOOP 4 identity hello; the response carries the serial. */
export function getHelloHarvard(): CommandSpec {
  return spec(Command.GET_HELLO_HARVARD, [0x00], false, W4);
}

/** GET_ADVERTISING_NAME_HARVARD (76) `[0x00]`. */
export function getAdvertisingNameHarvard(): CommandSpec {
  return spec(Command.GET_ADVERTISING_NAME_HARVARD, [0x00], false, W4);
}

/** REPORT_VERSION_INFO (7) `[0x00]`. */
export function reportVersionInfo(): CommandSpec {
  return spec(Command.REPORT_VERSION_INFO, [0x00], false, W4);
}

/** SET_CLOCK (10) eight-byte form: `seconds u32le || 00 00 00 00`. */
export function setClock8(unixSeconds: number): CommandSpec {
  return spec(Command.SET_CLOCK, [...u32le(unixSeconds), 0, 0, 0, 0], false, W4, "SET_CLOCK(8)");
}

/** SET_CLOCK (10) nine-byte form: `seconds u32le || 00 00 00 00 00` (the form 41.17.6.0 was observed to latch). */
export function setClock9(unixSeconds: number): CommandSpec {
  return spec(Command.SET_CLOCK, [...u32le(unixSeconds), 0, 0, 0, 0, 0], false, W4, "SET_CLOCK(9)");
}

/** GET_CLOCK (11) with an empty body. */
export function getClockEmpty(): CommandSpec {
  return spec(Command.GET_CLOCK, [], false, W4, "GET_CLOCK(empty)");
}

/** GET_CLOCK (11) with body `[0x00]`. */
export function getClockZero(): CommandSpec {
  return spec(Command.GET_CLOCK, [0x00], false, W4, "GET_CLOCK(00)");
}

/** SEND_R10_R11_REALTIME (63): `[0x00]` stops the ~2/s type-43 raw flood, `[0x01]` starts it. WHOOP 4 only. */
export function sendR10R11Realtime(on: boolean): CommandSpec {
  return spec(Command.SEND_R10_R11_REALTIME, [on ? 0x01 : 0x00], false, W4);
}

/** TOGGLE_REALTIME_HR (3): `[0x01]` on / `[0x00]` off. */
export function toggleRealtimeHr(on: boolean): CommandSpec {
  return spec(Command.TOGGLE_REALTIME_HR, [on ? 0x01 : 0x00], false, BOTH);
}

/** GET_DATA_RANGE (34) `[0x00]`. */
export function getDataRange(): CommandSpec {
  return spec(Command.GET_DATA_RANGE, [0x00], false, BOTH);
}

/** SEND_HISTORICAL_DATA (22) `[0x00]`, confirmed write. */
export function sendHistoricalData(): CommandSpec {
  return spec(Command.SEND_HISTORICAL_DATA, [0x00], true, BOTH);
}

/**
 * HISTORICAL_DATA_RESULT (23): `[0x01]` followed by the eight bytes copied
 * verbatim from the HISTORY_END frame (frame[17..25) on 4.0, frame[21..29) on 5.0).
 * Never reconstruct the token (PROTOCOL_TRANSPORT.md § "History sequencing and storage ownership").
 */
export function historicalDataResult(endToken: Uint8Array): CommandSpec {
  if (endToken.length !== 8) throw new RangeError("HISTORY_END acknowledgement token must be exactly 8 bytes");
  return spec(Command.HISTORICAL_DATA_RESULT, [0x01, ...endToken], true, BOTH);
}

/** ABORT_HISTORICAL_TRANSMITS (20) `[0x00]`, confirmed write. A stop request, not a trim. */
export function abortHistoricalTransmits(): CommandSpec {
  return spec(Command.ABORT_HISTORICAL_TRANSMITS, [0x00], true, BOTH);
}

/** GET_EXTENDED_BATTERY_INFO (98) `[0x00]`. WHOOP 4 only (result 3 on 5.0). */
export function getExtendedBatteryInfo(): CommandSpec {
  return spec(Command.GET_EXTENDED_BATTERY_INFO, [0x00], false, W4);
}

/** GET_HELLO (145) with revision 1 or 3 — WHOOP 5/MG. Revision 1 at seq 1 is the fixed CLIENT_HELLO frame. */
export function getHello5(revision: 1 | 3 = 1): CommandSpec {
  return spec(Command.GET_HELLO, [revision], true, W5);
}

/** SET_CLOCK (146) revision 1: `01 || seconds u32le || ticks u16le` (ticks in 1/32768 s, canonical 0..32767). */
export function setClock5(unixSeconds: number, fractionalTicks = 0): CommandSpec {
  const ticks = Math.min(32767, Math.max(0, Math.floor(fractionalTicks)));
  return spec(Command.SET_CLOCK_V5, [0x01, ...u32le(unixSeconds), ...u16le(ticks)], false, W5);
}

/** GET_CLOCK (147) revision 1: `[0x01]`. */
export function getClock5(): CommandSpec {
  return spec(Command.GET_CLOCK_V5, [0x01], false, W5);
}

/** The fixed WHOOP 5 session-start frame plus the sequence number it carries. */
export function clientHello(): { bytes: Uint8Array; seq: number; spec: CommandSpec } {
  return { bytes: CLIENT_HELLO_FRAME.slice(), seq: CLIENT_HELLO_SEQ, spec: getHello5(1) };
}

/** Wraps a CommandSpec in a type-35 COMMAND frame for the given family. */
export function encodeCommand(command: CommandSpec, seq: number, family: StrapFamily): Uint8Array {
  return buildFrameFor(family, { type: PacketType.COMMAND, seq, cmd: command.cmd, payload: command.payload });
}

/** Eight-bit rolling request sequence (PROTOCOL_TRANSPORT.md: "The request sequence is eight bits and can wrap"). */
export class SequenceCounter {
  private value: number;

  constructor(start = 0) {
    this.value = start & 0xff;
  }

  /** Returns the current value and advances. */
  next(): number {
    const v = this.value;
    this.value = (this.value + 1) & 0xff;
    return v;
  }

  peek(): number {
    return this.value;
  }
}
