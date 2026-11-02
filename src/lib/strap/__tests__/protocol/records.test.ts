import { describe, expect, it } from "vitest";
import { Command, EventId, PacketType } from "../../protocol/constants";
import { buildFrame, buildFrame5, parseFrame, parseFrame5 } from "../../protocol/framing";
import {
  decodeBattery,
  decodeClock,
  decodeCommandResponse,
  decodeDataRange,
  decodeEvent,
  decodeExtendedBattery,
  decodeHello,
  decodeHistorical,
  decodeMetadata,
  decodeRealtime,
  decodeResponseBody,
  decodeVersionInfo,
  ticksToMs,
} from "../../protocol/records";
import { DOC_EVENT_68 } from "./crc.test";

/** Writes little-endian values into a buffer at absolute offsets. */
class Buf {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  u8(o: number, v: number) {
    this.bytes[o] = v;
    return this;
  }
  u16(o: number, v: number) {
    this.view.setUint16(o, v, true);
    return this;
  }
  i16(o: number, v: number) {
    this.view.setInt16(o, v, true);
    return this;
  }
  u32(o: number, v: number) {
    this.view.setUint32(o, v, true);
    return this;
  }
  f32(o: number, v: number) {
    this.view.setFloat32(o, v, true);
    return this;
  }
}

/** Builds a WHOOP 4 frame from the inner bytes after the seq slot (frame[6..]) so absolute offsets can be used directly. */
function frame4(type: number, seq: number, inner: Uint8Array) {
  return parseFrame(buildFrame({ type, seq, cmd: inner[0], payload: inner.subarray(1) }));
}
function frame5(type: number, seq: number, inner: Uint8Array) {
  return parseFrame5(buildFrame5({ type, seq, cmd: inner[0], payload: inner.subarray(1) }, [1, 0]));
}

/** A WHOOP 4 frame body laid out by absolute frame offset: `abs(o)` maps to the inner buffer. */
function body4(length: number) {
  return { b: new Buf(length - 6), abs: (o: number) => o - 6 };
}
function body5(length: number) {
  return { b: new Buf(length - 10), abs: (o: number) => o - 10 };
}

describe("decodeCommandResponse", () => {
  it("reads cmd at 6, origin seq at 7, result at 8, body from 9 (WHOOP 4)", () => {
    const inner = Uint8Array.from([26, 0x2a, 1, 0x1c, 0x02, 0xaa]); // cmd, origin, result, body...
    const f = frame4(PacketType.COMMAND_RESPONSE, 0x90, inner);
    const r = decodeCommandResponse(f)!;
    expect(r.cmd).toBe(26);
    expect(r.originSeq).toBe(0x2a);
    expect(r.result).toBe(1);
    expect(r.resultName).toBe("SUCCESS");
    expect(Array.from(r.body)).toEqual([0x1c, 0x02, 0xaa]);
  });
  it("reads the same slots at +4 on WHOOP 5 and tolerates padding", () => {
    const f = frame5(PacketType.COMMAND_RESPONSE, 3, Uint8Array.from([34, 7, 2]));
    const r = decodeCommandResponse(f)!;
    expect(r.cmd).toBe(34);
    expect(r.originSeq).toBe(7);
    expect(r.resultName).toBe("PENDING");
    expect(f.raw[10]).toBe(34);
  });
  it("returns null for other packet types or invalid frames", () => {
    expect(decodeCommandResponse(frame4(PacketType.EVENT, 0, Uint8Array.from([1, 2, 3, 4, 5])))).toBeNull();
    expect(decodeCommandResponse({ ...frame4(36, 0, Uint8Array.from([1, 2, 3])), ok: false })).toBeNull();
  });
});

describe("decodeEvent", () => {
  it("decodes the documented event frame: id at 6, u32 time at 8", () => {
    const e = decodeEvent(parseFrame(DOC_EVENT_68))!;
    expect(e.id).toBe(0x44);
    expect(e.name).toBe("0x44(68)"); // not in the schema enum → raw label
    expect(e.unix).toBe(0x6a63ee3c);
    expect(Array.from(e.payload)).toEqual([0x80, 0x7e, 0x04, 0x00, 0x01, 0x01, 0xff, 0x00]);
  });
  it("decodes a BATTERY_LEVEL event: soc u16/10 at 17, mV at 21, charging bit at 26", () => {
    const { b, abs } = body4(28);
    b.u8(abs(6), EventId.BATTERY_LEVEL).u32(abs(8), 1_700_000_000).u16(abs(17), 499).u16(abs(21), 3812).u8(abs(26), 0x01);
    const e = decodeEvent(frame4(PacketType.EVENT, 1, b.bytes))!;
    expect(e.name).toBe("BATTERY_LEVEL");
    expect(e.battery).toEqual({ percent: 49.9, millivolts: 3812, charging: true });
    const w5 = body5(32);
    w5.b.u8(w5.abs(10), EventId.BATTERY_LEVEL).u32(w5.abs(12), 1_700_000_000).u16(w5.abs(21), 477).u16(w5.abs(25), 3790).u8(w5.abs(30), 0);
    const e5 = decodeEvent(frame5(PacketType.EVENT, 1, w5.b.bytes))!;
    expect(e5.battery).toEqual({ percent: 47.7, millivolts: 3790, charging: false });
  });
  it("names wrist / tap / pairing / bonded / extended-battery events from the schema", () => {
    for (const [id, name] of [
      [9, "WRIST_ON"],
      [10, "WRIST_OFF"],
      [14, "DOUBLE_TAP"],
      [18, "PAIRING_MODE"],
      [23, "BLE_BONDED"],
      [63, "EXTENDED_BATTERY_INFORMATION"],
    ] as const) {
      const inner = Uint8Array.from([id, 0, 1, 2, 3, 4]);
      expect(decodeEvent(frame4(PacketType.EVENT, 0, inner))!.name).toBe(name);
    }
  });
});

describe("decodeMetadata", () => {
  const token = [0x5f, 0x57, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00];
  it("reads START / COMPLETE types at 6", () => {
    expect(decodeMetadata(frame4(PacketType.METADATA, 0, Uint8Array.from([1])))!.name).toBe("HISTORY_START");
    expect(decodeMetadata(frame4(PacketType.METADATA, 0, Uint8Array.from([3])))!.name).toBe("HISTORY_COMPLETE");
    expect(decodeMetadata(frame4(PacketType.METADATA, 0, Uint8Array.from([9])))!.name).toBe("UNKNOWN");
  });
  it("copies the HISTORY_END token from frame[17..25) and reads unix at 7 (WHOOP 4)", () => {
    const { b, abs } = body4(25);
    b.u8(abs(6), 2).u32(abs(7), 1_700_000_123).u16(abs(11), 77);
    b.bytes.set(token, abs(17));
    const m = decodeMetadata(frame4(PacketType.METADATA, 0, b.bytes))!;
    expect(m.name).toBe("HISTORY_END");
    expect(m.unix).toBe(1_700_000_123);
    expect(m.subseconds).toBe(77);
    expect(Array.from(m.token!)).toEqual(token);
    expect(m.trimCursor).toBe(0x575f);
  });
  it("copies the token from frame[21..29) on WHOOP 5 and accepts puffin type 56", () => {
    const { b, abs } = body5(29);
    b.u8(abs(10), 2).u32(abs(11), 1_700_000_000);
    b.bytes.set(token, abs(21));
    const m = decodeMetadata(frame5(PacketType.PUFFIN_METADATA, 0, b.bytes))!;
    expect(Array.from(m.token!)).toEqual(token);
  });
  it("omits the token when the END frame is too short", () => {
    const m = decodeMetadata(frame4(PacketType.METADATA, 0, Uint8Array.from([2, 0, 0, 0, 0])))!;
    expect(m.token).toBeUndefined();
  });
});

describe("decodeRealtime", () => {
  it("reads unix at 6, subseconds at 10, HR at 12, count at 13, R-R ms from 14 (WHOOP 4)", () => {
    const { b, abs } = body4(20);
    b.u32(abs(6), 1_700_000_000).u16(abs(10), 512).u8(abs(12), 61).u8(abs(13), 3).u16(abs(14), 980).u16(abs(16), 0).u16(abs(18), 1010);
    const r = decodeRealtime(frame4(PacketType.REALTIME_DATA, 5, b.bytes))!;
    expect(r).toEqual({ unix: 1_700_000_000, subseconds: 512, hr: 61, rr: [980, 1010] });
  });
  it("never reads past the frame end when the count overstates the words", () => {
    const { b, abs } = body4(16);
    b.u32(abs(6), 1_700_000_000).u8(abs(12), 70).u8(abs(13), 9).u16(abs(14), 850);
    expect(decodeRealtime(frame4(PacketType.REALTIME_DATA, 5, b.bytes))!.rr).toEqual([850]);
  });
  it("converts WHOOP 5 ticks (1/1024 s) to rounded milliseconds", () => {
    expect([512, 1024, 1536].map(ticksToMs)).toEqual([500, 1000, 1500]);
    const { b, abs } = body5(22);
    b.u32(abs(10), 1_700_000_000).u8(abs(16), 60).u8(abs(17), 2).u16(abs(18), 1024).u16(abs(20), 1536);
    const r = decodeRealtime(frame5(PacketType.REALTIME_DATA, 1, b.bytes))!;
    expect(r.hr).toBe(60);
    expect(r.rr).toEqual([1000, 1500]);
  });
});

describe("decodeHistorical", () => {
  function v24(opts: { version?: number; rr?: number[]; hr?: number } = {}) {
    const { b, abs } = body4(88);
    b.u32(abs(11), 1_700_000_000).u8(abs(21), opts.hr ?? 58).u8(abs(22), (opts.rr ?? [1034, 1021]).length);
    (opts.rr ?? [1034, 1021]).forEach((v, i) => b.u16(abs(23 + 2 * i), v));
    b.u16(abs(33), 1200).u16(abs(35), 3400);
    b.f32(abs(40), 0.1).f32(abs(44), -0.2).f32(abs(48), 0.97);
    b.u8(abs(55), 1);
    b.u16(abs(68), 4200).u16(abs(70), 5100).u16(abs(72), 826).u16(abs(74), 12).u16(abs(80), 1500).u16(abs(82), 97);
    return frame4(PacketType.HISTORICAL_DATA, opts.version ?? 24, b.bytes);
  }

  it("decodes a v24 record at the documented absolute offsets", () => {
    const r = decodeHistorical(v24())!;
    expect(r.version).toBe(24);
    expect(r.family).toBe("whoop4");
    expect(r.unix).toBe(1_700_000_000);
    expect(r.hr).toBe(58);
    expect(r.rr).toEqual([1034, 1021]);
    expect(r.rawPpg).toEqual({ green: 1200, redIr: 3400 });
    expect(r.gravity![0]).toBeCloseTo(0.1, 5);
    expect(r.gravity![1]).toBeCloseTo(-0.2, 5);
    expect(r.gravity![2]).toBeCloseTo(0.97, 5);
    expect(r.skinContact).toBe(1);
    expect(r.rawSpo2).toEqual({ red: 4200, ir: 5100 });
    expect(r.rawSkinTemp).toBe(826);
    expect(r.rawResp).toBe(1500);
    expect(r.quality).toBe(97);
  });
  it("treats v12 as the v24 layout, drops zero R-R placeholders and caps R-R at five words", () => {
    const r = decodeHistorical(v24({ version: 12, rr: [900, 0, 910, 920, 930, 940] }))!;
    expect(r.version).toBe(12);
    expect(r.rr).toEqual([900, 910, 920, 930]); // five words read (900,0,910,920,930), zero omitted
  });
  it("decodes the 84-byte v25 record: unix at 11, i16 gravity / 16384 at 73/75/77, no HR", () => {
    const { b, abs } = body4(84);
    b.u32(abs(11), 1_690_000_000).i16(abs(73), 16384).i16(abs(75), -8192).i16(abs(77), 0);
    const r = decodeHistorical(frame4(PacketType.HISTORICAL_DATA, 25, b.bytes))!;
    expect(r.version).toBe(25);
    expect(r.hr).toBeNull();
    expect(r.rr).toEqual([]);
    expect(r.gravity).toEqual([1, -0.5, 0]);
    // A v25 byte that is not 84 bytes long is not the documented layout.
    const { b: short, abs: a2 } = body4(80);
    short.u32(a2(11), 1_690_000_000);
    expect(decodeHistorical(frame4(PacketType.HISTORICAL_DATA, 25, short.bytes))).toBeNull();
  });
  it("decodes generic v5/7/9 HR-only records", () => {
    const { b, abs } = body4(30);
    b.u32(abs(11), 1_650_000_000).u8(abs(21), 55).u8(abs(22), 1).u16(abs(23), 1090);
    for (const v of [5, 7, 9]) {
      const r = decodeHistorical(frame4(PacketType.HISTORICAL_DATA, v, b.bytes))!;
      expect(r.version).toBe(v);
      expect(r.hr).toBe(55);
      expect(r.rr).toEqual([1090]);
    }
  });
  it("returns null for unknown WHOOP 4 versions and for a v18 byte on WHOOP 4", () => {
    expect(decodeHistorical(frame4(PacketType.HISTORICAL_DATA, 26, new Uint8Array(80)))).toBeNull();
    expect(decodeHistorical(frame4(PacketType.HISTORICAL_DATA, 18, new Uint8Array(110)))).toBeNull();
  });
  it("decodes the WHOOP 5 v18 (R18) 124-byte record at its absolute offsets", () => {
    const { b, abs } = body5(124);
    b.u32(abs(11), 4242).u32(abs(15), 1_710_000_000).u8(abs(22), 62).u8(abs(23), 2).u16(abs(24), 1024).u16(abs(26), 1000);
    b.u8(abs(36), 0x30).f32(abs(45), 0.0).f32(abs(49), 0.6).f32(abs(53), 0.8);
    b.u16(abs(57), 1234).u8(abs(63), 1).u16(abs(73), 3312).u8(abs(81), 0x20);
    const f = frame5(PacketType.HISTORICAL_DATA, 18, b.bytes);
    expect(f.raw.length).toBe(124);
    const r = decodeHistorical(f)!;
    expect(r.family).toBe("whoop5");
    expect(r.version).toBe(18);
    expect(r.index).toBe(4242);
    expect(r.unix).toBe(1_710_000_000);
    expect(r.hr).toBe(62);
    expect(r.rr).toEqual([1000, 977]);
    expect(r.quality).toBe(0x30);
    expect(r.gravity![1]).toBeCloseTo(0.6, 5);
    expect(r.steps).toBe(1234);
    expect(r.activity).toBe(1);
    expect(r.rawSkinTemp).toBe(3312);
    expect(r.skinTempC).toBeCloseTo(33.12, 5);
    expect(r.bandState).toBe(2); // SLEEP
    expect(r.rawSpo2).toBeUndefined(); // no verified optical offsets on v18
  });
  it("returns null for unknown WHOOP 5 layouts (20/21/26 are preserved raw by the caller)", () => {
    for (const v of [20, 21, 26]) {
      expect(decodeHistorical(frame5(PacketType.HISTORICAL_DATA, v, new Uint8Array(100)))).toBeNull();
    }
  });
});

describe("decodeHello", () => {
  it("extracts the nine-character WHOOP 4 serial at body 14 and never copies the key material at 24..78", () => {
    const body = new Uint8Array(131);
    body.set(Uint8Array.from("3A0123456", (c) => c.charCodeAt(0)), 14);
    body[23] = 0;
    body.set(Uint8Array.from("SECRETKEYMATERIAL", (c) => c.charCodeAt(0)), 24);
    const h = decodeHello(body, "whoop4");
    expect(h.serial).toBe("3A0123456");
    expect(h.bodyLength).toBe(131);
    expect(JSON.stringify(h)).not.toContain("SECRET");
  });
  it("leaves the serial unresolved when the field is not a plausible serial", () => {
    const body = new Uint8Array(131);
    body.set(Uint8Array.from("3A01-3456", (c) => c.charCodeAt(0)), 14);
    expect(decodeHello(body, "whoop4").serial).toBeNull();
    expect(decodeHello(new Uint8Array(10), "whoop4").serial).toBeNull();
  });
  it("extracts version, battery, clock and preparation bits from a WHOOP 5 final hello body only", () => {
    const b = new Buf(107);
    b.u8(0, 1).u32(1, 873).u32(6, 1_700_000_000);
    b.bytes.set(Uint8Array.from("TOKENTOKENTOKENTOKENTOKEN", (c) => c.charCodeAt(0)), 25);
    b.u8(91, 50).u8(92, 42).u8(93, 1).u32(94, 0).u32(103, 0x10);
    const h = decodeHello(b.bytes, "whoop5");
    expect(h.firmware).toBe("50.42.1.0");
    expect(h.batteryPercent).toBeCloseTo(87.3, 5);
    expect(h.unix).toBe(1_700_000_000);
    expect(h.preparationBits).toBe(0x10);
    expect(h.serial).toBeNull();
    expect(JSON.stringify(h)).not.toContain("TOKEN");
  });
});

describe("response bodies", () => {
  it("decodeVersionInfo reads Harvard at 1 and Boylston at 17 as four u32le each", () => {
    const b = new Buf(68);
    b.u8(0, 1).u32(1, 41).u32(5, 17).u32(9, 6).u32(13, 0).u32(17, 17).u32(21, 2).u32(25, 2).u32(29, 0);
    expect(decodeVersionInfo(b.bytes)).toEqual({ revision: 1, harvard: "41.17.6.0", boylston: "17.2.2.0" });
    expect(decodeVersionInfo(new Uint8Array(10))).toBeNull();
  });
  it("decodeBattery: WHOOP 4 u16le / 10, WHOOP 5 u32 whole percent", () => {
    expect(decodeBattery(Uint8Array.from([0xf3, 0x01]), "whoop4")).toEqual({ percent: 49.9, unit: "tenths" });
    expect(decodeBattery(Uint8Array.from([47, 0, 0, 0]), "whoop5")).toEqual({ percent: 47, unit: "percent" });
    expect(decodeBattery(Uint8Array.from([0xff, 0xff]), "whoop4")).toBeNull();
    expect(decodeBattery(Uint8Array.from([1]), "whoop5")).toBeNull();
  });
  it("decodeDataRange finds plausible unix pairs and the WHOOP 5 ring fields", () => {
    const b = new Buf(65);
    b.u8(0, 1).u32(1, 10).u32(5, 200).u32(9, 300).u32(13, 150).u32(17, 0).u32(21, 4096).u32(25, 1500);
    b.u32(33, 1_690_000_000).u32(37, 12).u32(41, 1_690_500_000).u32(45, 50).u32(57, 1_700_000_000).u32(61, 65535);
    const r = decodeDataRange(b.bytes, "whoop5");
    expect(r.oldestUnix).toBe(1_690_000_000);
    expect(r.newestUnix).toBe(1_700_000_000);
    expect(r.ring).toEqual({ boundaryA: 10, readPage: 200, writePage: 300, trimBoundary: 150, wrapState: 0, capacityPages: 4096, recordEstimate: 1500 });
    const w4 = new Buf(20);
    w4.u8(0, 1).u32(3, 1_650_000_000).u32(7, 1_700_000_000);
    const r4 = decodeDataRange(w4.bytes, "whoop4");
    expect(r4.oldestUnix).toBe(1_650_000_000);
    expect(r4.newestUnix).toBe(1_700_000_000);
    expect(r4.ring).toBeUndefined();
    expect(decodeDataRange(new Uint8Array(8), "whoop4").oldestUnix).toBeNull();
  });
  it("decodeClock: WHOOP 5 revision/u32/u16, WHOOP 4 heuristic", () => {
    const b = new Buf(7);
    b.u8(0, 1).u32(1, 1_700_000_000).u16(5, 16384);
    expect(decodeClock(b.bytes, "whoop5")).toEqual({ unix: 1_700_000_000, ticks: 16384, documented: true });
    expect(decodeClock(Uint8Array.from([2, 0, 0, 0, 0, 0, 0]), "whoop5")).toBeNull();
    const w4 = new Buf(8);
    w4.u32(0, 1_700_000_000);
    expect(decodeClock(w4.bytes, "whoop4")).toEqual({ unix: 1_700_000_000, documented: false });
    expect(decodeClock(new Uint8Array(8), "whoop4")).toBeNull();
  });
  it("decodeExtendedBattery reads pack millivolts at body 5 only for a 25-byte SUCCESS body", () => {
    const body = new Buf(25);
    body.u16(5, 3950);
    const ok = { cmd: 98, originSeq: 1, result: 1, resultName: "SUCCESS", body: body.bytes };
    expect(decodeExtendedBattery(ok)!.packMillivolts).toBe(3950);
    expect(decodeExtendedBattery({ ...ok, result: 0 })).toBeNull();
  });
  it("decodeResponseBody dispatches by command and family", () => {
    const base = { originSeq: 1, result: 1, resultName: "SUCCESS" };
    expect(decodeResponseBody({ ...base, cmd: Command.GET_BATTERY_LEVEL, body: Uint8Array.from([0xf3, 1]) }, "whoop4").kind).toBe("battery");
    expect(decodeResponseBody({ ...base, cmd: Command.GET_HELLO_HARVARD, body: new Uint8Array(131) }, "whoop4").kind).toBe("hello");
    expect(decodeResponseBody({ ...base, cmd: Command.GET_HELLO_HARVARD, body: new Uint8Array(131) }, "whoop5").kind).toBe("raw");
    expect(decodeResponseBody({ ...base, cmd: Command.GET_DATA_RANGE, body: new Uint8Array(8) }, "whoop4").kind).toBe("dataRange");
    expect(decodeResponseBody({ ...base, cmd: Command.GET_DATA_RANGE, result: 2, resultName: "PENDING", body: new Uint8Array(0) }, "whoop5").kind).toBe("raw");
    expect(decodeResponseBody({ ...base, cmd: 77, body: new Uint8Array(0) }, "whoop4").kind).toBe("raw");
  });
});
