import { describe, expect, it } from "vitest";
import { CLIENT_HELLO_FRAME, Command } from "../../protocol/constants";
import {
  abortHistoricalTransmits,
  clientHello,
  encodeCommand,
  getAdvertisingNameHarvard,
  getBatteryLevel,
  getClock5,
  getClockEmpty,
  getClockZero,
  getDataRange,
  getExtendedBatteryInfo,
  getHello5,
  getHelloHarvard,
  historicalDataResult,
  reportVersionInfo,
  sendHistoricalData,
  sendR10R11Realtime,
  SequenceCounter,
  setClock5,
  setClock8,
  setClock9,
  toggleRealtimeHr,
} from "../../protocol/commands";
import { parseFrame, parseFrame5 } from "../../protocol/framing";

const bytes = (u: Uint8Array) => Array.from(u);

describe("command payloads", () => {
  it("GET_BATTERY_LEVEL is [0x00] with response (the 4.0 bond write)", () => {
    const c = getBatteryLevel();
    expect(c.cmd).toBe(26);
    expect(bytes(c.payload)).toEqual([0]);
    expect(c.withResponse).toBe(true);
  });
  it("identity and version reads use [0x00] without response", () => {
    for (const [c, id] of [
      [getHelloHarvard(), 35],
      [getAdvertisingNameHarvard(), 76],
      [reportVersionInfo(), 7],
      [getDataRange(), 34],
      [getExtendedBatteryInfo(), 98],
    ] as const) {
      expect(c.cmd).toBe(id);
      expect(bytes(c.payload)).toEqual([0]);
      expect(c.withResponse).toBe(false);
    }
  });
  it("SET_CLOCK has the 8-byte and 9-byte forms with u32le seconds and zero tails", () => {
    const secs = 1_700_000_000; // 0x6553F100
    expect(bytes(setClock8(secs).payload)).toEqual([0x00, 0xf1, 0x53, 0x65, 0, 0, 0, 0]);
    expect(bytes(setClock9(secs).payload)).toEqual([0x00, 0xf1, 0x53, 0x65, 0, 0, 0, 0, 0]);
    expect(setClock8(secs).cmd).toBe(Command.SET_CLOCK);
  });
  it("GET_CLOCK has the empty and [0x00] forms", () => {
    expect(bytes(getClockEmpty().payload)).toEqual([]);
    expect(bytes(getClockZero().payload)).toEqual([0]);
    expect(getClockEmpty().cmd).toBe(11);
  });
  it("SEND_R10_R11_REALTIME and TOGGLE_REALTIME_HR use [0x01]/[0x00]", () => {
    expect(bytes(sendR10R11Realtime(false).payload)).toEqual([0]);
    expect(bytes(sendR10R11Realtime(true).payload)).toEqual([1]);
    expect(sendR10R11Realtime(true).cmd).toBe(63);
    expect(bytes(toggleRealtimeHr(true).payload)).toEqual([1]);
    expect(bytes(toggleRealtimeHr(false).payload)).toEqual([0]);
    expect(toggleRealtimeHr(true).cmd).toBe(3);
  });
  it("history commands: 22 [0x00], 23 [0x01]+token, 20 [0x00], all with response", () => {
    expect(sendHistoricalData().cmd).toBe(22);
    expect(bytes(sendHistoricalData().payload)).toEqual([0]);
    expect(sendHistoricalData().withResponse).toBe(true);
    const token = Uint8Array.from([0x1f, 0x57, 0, 0, 0xde, 0xad, 0xbe, 0xef]);
    const ack = historicalDataResult(token);
    expect(ack.cmd).toBe(23);
    expect(bytes(ack.payload)).toEqual([1, 0x1f, 0x57, 0, 0, 0xde, 0xad, 0xbe, 0xef]);
    expect(ack.withResponse).toBe(true);
    expect(() => historicalDataResult(new Uint8Array(4))).toThrow(/8 bytes/);
    expect(abortHistoricalTransmits().cmd).toBe(20);
    expect(bytes(abortHistoricalTransmits().payload)).toEqual([0]);
    expect(abortHistoricalTransmits().withResponse).toBe(true);
  });
  it("WHOOP 5 clock pair: 146 = [1, u32, u16], 147 = [1]; hello revision byte", () => {
    expect(bytes(setClock5(1_700_000_000, 16384).payload)).toEqual([1, 0x00, 0xf1, 0x53, 0x65, 0x00, 0x40]);
    expect(bytes(setClock5(1, 99999).payload).slice(5)).toEqual([0xff, 0x7f]); // clamped to 32767
    expect(bytes(getClock5().payload)).toEqual([1]);
    expect(getClock5().cmd).toBe(147);
    expect(bytes(getHello5(3).payload)).toEqual([3]);
    expect(getHello5().withResponse).toBe(true);
  });
});

describe("encodeCommand", () => {
  it("wraps in the WHOOP 4 envelope", () => {
    const f = encodeCommand(getBatteryLevel(), 0, "whoop4");
    const p = parseFrame(f);
    expect(p.ok).toBe(true);
    expect(p.type).toBe(35);
    expect(p.cmd).toBe(26);
    expect(bytes(p.payload)).toEqual([0]);
  });
  it("wraps in the WHOOP 5 envelope and reproduces CLIENT_HELLO for GET_HELLO rev 1 at seq 1", () => {
    expect(bytes(encodeCommand(getHello5(1), 1, "whoop5"))).toEqual(bytes(CLIENT_HELLO_FRAME));
    const hello = clientHello();
    expect(hello.seq).toBe(1);
    expect(bytes(hello.bytes)).toEqual(bytes(CLIENT_HELLO_FRAME));
    const ack = encodeCommand(historicalDataResult(new Uint8Array(8)), 5, "whoop5");
    const p = parseFrame5(ack);
    expect(p.ok).toBe(true);
    expect(p.cmd).toBe(23);
    expect(p.payload.length).toBe(9); // inner 3 + 9 = 12 bytes is already 4-byte aligned, so no padding
  });
});

describe("SequenceCounter", () => {
  it("counts and wraps at 8 bits", () => {
    const s = new SequenceCounter(254);
    expect(s.next()).toBe(254);
    expect(s.next()).toBe(255);
    expect(s.next()).toBe(0);
    expect(s.peek()).toBe(1);
  });
});
