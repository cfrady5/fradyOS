import { describe, expect, it } from "vitest";
import { CLIENT_HELLO_FRAME, PacketType, WHOOP4_MIN_FRAME } from "../../protocol/constants";
import { crc32, crc8 } from "../../protocol/crc";
import {
  buildFrame,
  buildFrame5,
  declaredTotal4,
  declaredTotal5,
  parseFrame,
  parseFrame5,
  Reassembler,
} from "../../protocol/framing";
import { DOC_CLIENT_HELLO, DOC_EVENT_102, DOC_EVENT_68 } from "./crc.test";

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("buildFrame (WHOOP 4)", () => {
  it("lays out SOF, u16le length, crc8, type, seq, cmd, payload, crc32le with length = inner + 4", () => {
    const f = buildFrame({ type: PacketType.COMMAND, seq: 0, cmd: 26, payload: [0x00] });
    expect(f.length).toBe(12);
    expect(f[0]).toBe(0xaa);
    expect(f[1] | (f[2] << 8)).toBe(8); // inner [35,0,26,0] = 4 bytes + 4
    expect(f[3]).toBe(crc8(f, 1, 3));
    expect(Array.from(f.subarray(4, 8))).toEqual([35, 0, 26, 0]);
    expect(new DataView(f.buffer).getUint32(8, true)).toBe(crc32(f, 4, 8));
    expect(Buffer.from(f).toString("hex")).toBe("aa0800a823001a001725ee23");
  });
  it("produces the 11-byte minimum for an empty payload and total = length + 4", () => {
    const f = buildFrame({ type: PacketType.COMMAND, seq: 3, cmd: 11 });
    expect(f.length).toBe(WHOOP4_MIN_FRAME);
    expect(f[1] | (f[2] << 8)).toBe(7);
    expect(parseFrame(f).ok).toBe(true);
  });
  it("round-trips through parseFrame", () => {
    const payload = Uint8Array.from({ length: 200 }, (_, i) => (i * 7) & 0xff);
    const f = buildFrame({ type: 47, seq: 24, cmd: 5, payload });
    const p = parseFrame(f);
    expect(p.ok).toBe(true);
    expect(p.type).toBe(47);
    expect(p.seq).toBe(24);
    expect(p.cmd).toBe(5);
    expect(Array.from(p.payload)).toEqual(Array.from(payload));
    expect(p.innerOffset).toBe(4);
    expect(p.innerEnd).toBe(f.length - 4);
  });
  it("refuses to build destructive commands", () => {
    for (const cmd of [25, 29, 32, 36, 45, 99, 142]) {
      expect(() => buildFrame({ type: PacketType.COMMAND, seq: 0, cmd, payload: [0] })).toThrow(/destructive/);
    }
    // Only type-35 COMMAND frames are guarded; a response that happens to carry id 29 is fine.
    expect(() => buildFrame({ type: PacketType.COMMAND_RESPONSE, seq: 0, cmd: 29 })).not.toThrow();
  });
});

describe("parseFrame (WHOOP 4)", () => {
  it("accepts the documented event frames", () => {
    const p = parseFrame(DOC_EVENT_68);
    expect(p.ok).toBe(true);
    expect(p.type).toBe(48);
    expect(p.seq).toBe(0xfc);
    expect(p.cmd).toBe(0x44);
    expect(p.payload.length).toBe(20 - 7);
    expect(parseFrame(DOC_EVENT_102).ok).toBe(true);
  });
  it("rejects a truncated frame, trailing bytes, a bad crc8 and a bad crc32", () => {
    expect(parseFrame(DOC_EVENT_68.subarray(0, 23)).error).toMatch(/does not match/);
    expect(parseFrame(concat(DOC_EVENT_68, Uint8Array.from([0]))).error).toMatch(/does not match/);
    const badHeader = DOC_EVENT_68.slice();
    badHeader[3] ^= 1;
    expect(parseFrame(badHeader).error).toMatch(/crc8/);
    const badBody = DOC_EVENT_68.slice();
    badBody[12] ^= 1;
    expect(parseFrame(badBody).error).toMatch(/crc32/);
    const noSof = DOC_EVENT_68.slice();
    noSof[0] = 0x55;
    expect(parseFrame(noSof).error).toMatch(/0xAA/);
    expect(parseFrame(new Uint8Array(5)).error).toMatch(/shorter/);
  });
  it("rejects a declared length below 7 even when both CRCs are consistent", () => {
    const f = new Uint8Array(10);
    f[0] = 0xaa;
    f[1] = 6;
    f[3] = crc8(f, 1, 3);
    expect(parseFrame(f).ok).toBe(false);
  });
});

describe("buildFrame5 / parseFrame5 (WHOOP 5 format 1)", () => {
  it("reproduces the documented CLIENT_HELLO byte for byte", () => {
    const f = buildFrame5({ type: PacketType.COMMAND, seq: 1, cmd: 145, payload: [0x01] });
    expect(Array.from(f)).toEqual(Array.from(DOC_CLIENT_HELLO));
    expect(Array.from(CLIENT_HELLO_FRAME)).toEqual(Array.from(DOC_CLIENT_HELLO));
  });
  it("pads the body to a 4-byte boundary and sets length = padded + 4, total = padded + 12", () => {
    const f = buildFrame5({ type: 35, seq: 9, cmd: 23, payload: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    // inner = 3 + 9 = 12 → already aligned → total 24, length 16
    expect(f.length).toBe(24);
    expect(f[2] | (f[3] << 8)).toBe(16);
    const g = buildFrame5({ type: 35, seq: 9, cmd: 34, payload: [0] });
    expect(g.length).toBe(16);
    expect(Array.from(g.subarray(8, 12))).toEqual([35, 9, 34, 0]);
    const p = parseFrame5(g);
    expect(p.ok).toBe(true);
    expect(p.innerOffset).toBe(8);
    expect(p.cmd).toBe(34);
    expect(Array.from(p.payload)).toEqual([0]);
  });
  it("parses CLIENT_HELLO and rejects header/body corruption", () => {
    const p = parseFrame5(DOC_CLIENT_HELLO);
    expect(p.ok).toBe(true);
    expect(p.type).toBe(35);
    expect(p.seq).toBe(1);
    expect(p.cmd).toBe(145);
    const bad16 = DOC_CLIENT_HELLO.slice();
    bad16[4] ^= 1;
    expect(parseFrame5(bad16).error).toMatch(/crc16/);
    const bad32 = DOC_CLIENT_HELLO.slice();
    bad32[11] ^= 1;
    expect(parseFrame5(bad32).error).toMatch(/crc32/);
    const badFormat = DOC_CLIENT_HELLO.slice();
    badFormat[1] = 2;
    expect(parseFrame5(badFormat).error).toMatch(/format/);
    expect(parseFrame5(DOC_CLIENT_HELLO.subarray(0, 15)).ok).toBe(false);
  });
  it("declaredTotal helpers read the complete size", () => {
    expect(declaredTotal4(DOC_EVENT_68)).toBe(24);
    expect(declaredTotal5(DOC_CLIENT_HELLO)).toBe(16);
    expect(declaredTotal4(new Uint8Array(2))).toBeNull();
    expect(declaredTotal5(new Uint8Array(3))).toBeNull();
  });
});

describe("Reassembler", () => {
  const a = buildFrame({ type: 47, seq: 24, cmd: 1, payload: Uint8Array.from({ length: 77 }, (_, i) => i) });
  const b = DOC_EVENT_68;
  const c = buildFrame({ type: 49, seq: 2, cmd: 2, payload: new Uint8Array(18) });

  it("emits one frame from a single complete notification", () => {
    const r = new Reassembler("whoop4");
    const frames = r.feed(b);
    expect(frames.length).toBe(1);
    expect(frames[0].ok).toBe(true);
    expect(r.pending).toBe(0);
  });

  it("reassembles frames split across arbitrary chunk sizes", () => {
    const stream = concat(a, b, c);
    for (const size of [1, 2, 7, 19, 20, 23, 64]) {
      const r = new Reassembler("whoop4");
      const got: number[] = [];
      for (let o = 0; o < stream.length; o += size) {
        for (const f of r.feed(stream.subarray(o, Math.min(stream.length, o + size)))) {
          expect(f.ok).toBe(true);
          got.push(f.type);
        }
      }
      expect(got).toEqual([47, 48, 49]);
      expect(r.pending).toBe(0);
    }
  });

  it("splits several frames concatenated in one notification", () => {
    const r = new Reassembler("whoop4");
    const frames = r.feed(concat(a, b, c));
    expect(frames.map((f) => f.type)).toEqual([47, 48, 49]);
  });

  it("drops leading garbage and resyncs on 0xAA", () => {
    const r = new Reassembler("whoop4");
    const garbage = Uint8Array.from([0x00, 0x11, 0x22, 0x33]);
    const frames = r.feed(concat(garbage, b));
    expect(frames.length).toBe(1);
    expect(frames[0].ok).toBe(true);
    expect(r.stats.garbageBytes).toBe(4);
  });

  it("drops a fake 0xAA whose declared size is below the minimum or above the ceiling", () => {
    const r = new Reassembler("whoop4", 64);
    const tooSmall = Uint8Array.from([0xaa, 0x02, 0x00]); // total 6 < 11
    const tooBig = Uint8Array.from([0xaa, 0xff, 0xff]); // total 65539 > 64
    const frames = r.feed(concat(tooSmall, tooBig, b));
    expect(frames.length).toBe(1);
    expect(frames[0].ok).toBe(true);
    expect(r.stats.belowMinimumDrops).toBeGreaterThanOrEqual(1);
    expect(r.stats.aboveMaximumDrops).toBeGreaterThanOrEqual(1);
  });

  it("reports a corrupted frame as not ok and still recovers the following frame", () => {
    const r = new Reassembler("whoop4");
    const corrupt = b.slice();
    corrupt[10] ^= 0xff;
    const frames = r.feed(concat(corrupt, c));
    const ok = frames.filter((f) => f.ok);
    expect(ok.length).toBe(1);
    expect(ok[0].type).toBe(49);
    expect(r.stats.framesRejected).toBeGreaterThanOrEqual(1);
  });

  it("handles the WHOOP 5 envelope with its own length offset and total", () => {
    const r = new Reassembler("whoop5");
    const resp = buildFrame5({ type: 36, seq: 7, cmd: 26, payload: [1, 1, 47, 0, 0, 0] }, [1, 0]);
    const stream = concat(DOC_CLIENT_HELLO, resp);
    const got: number[] = [];
    for (let o = 0; o < stream.length; o += 5) {
      for (const f of r.feed(stream.subarray(o, Math.min(stream.length, o + 5)))) {
        expect(f.ok).toBe(true);
        got.push(f.type);
      }
    }
    expect(got).toEqual([35, 36]);
  });

  it("reset() discards buffered partial data", () => {
    const r = new Reassembler("whoop4");
    r.feed(b.subarray(0, 10));
    expect(r.pending).toBe(10);
    r.reset();
    expect(r.pending).toBe(0);
    expect(r.feed(b).length).toBe(1);
  });
});
