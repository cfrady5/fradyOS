import { describe, expect, it } from "vitest";
import { crc16Modbus, crc32, crc8 } from "../../protocol/crc";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, "").match(/../g)!.map((b) => parseInt(b, 16)));

/**
 * Two complete WHOOP 4 event frames observed on a real strap and reproduced in
 * NOOP docs/BLE_REVERSE_ENGINEERING.md § "Appendix: observed but undecoded".
 * They are protocol facts (bytes on the wire), used here as CRC vectors.
 */
export const DOC_EVENT_68 = hex("aa 14 00 03 30 fc 44 00 3c ee 63 6a 80 7e 04 00 01 01 ff 00 58 2e c2 81");
export const DOC_EVENT_102 = hex("aa 14 00 03 30 0a 66 00 9e ee 63 6a 60 48 04 00 01 01 00 00 34 0e 63 88");
/** The fixed WHOOP 5 CLIENT_HELLO frame (docs/PROTOCOL_WHOOP5.md § "Connection and frame format"). */
export const DOC_CLIENT_HELLO = hex("AA 01 08 00 00 01 E6 71 23 01 91 01 36 3E 5C 8D");

describe("crc8 (poly 0x07, init 0)", () => {
  it("matches the standard CRC-8 check value", () => {
    expect(crc8(ascii("123456789"))).toBe(0xf4);
  });
  it("matches the header byte of the documented WHOOP 4 frames (over the two length bytes)", () => {
    expect(crc8(DOC_EVENT_68, 1, 3)).toBe(DOC_EVENT_68[3]);
    expect(crc8(DOC_EVENT_102, 1, 3)).toBe(DOC_EVENT_102[3]);
    expect(crc8(Uint8Array.from([0x14, 0x00]))).toBe(0x03);
  });
  it("is zero for empty input", () => {
    expect(crc8(new Uint8Array(0))).toBe(0);
  });
});

describe("crc32 (zlib / IEEE)", () => {
  it("matches the standard check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });
  it("matches the trailer of the documented WHOOP 4 frames over frame[4..length)", () => {
    for (const frame of [DOC_EVENT_68, DOC_EVENT_102]) {
      const length = frame[1] | (frame[2] << 8);
      const trailer = new DataView(frame.buffer).getUint32(length, true);
      expect(crc32(frame, 4, length)).toBe(trailer);
    }
    expect(crc32(DOC_EVENT_68, 4, 20)).toBe(0x81c22e58);
  });
  it("matches the trailer of CLIENT_HELLO over the padded body [8, 12)", () => {
    expect(crc32(DOC_CLIENT_HELLO, 8, 12)).toBe(0x8d5c3e36);
  });
  it("returns an unsigned value", () => {
    expect(crc32(Uint8Array.from([0xff, 0xff]))).toBeGreaterThan(0);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("crc16Modbus", () => {
  it("matches the standard CRC-16/MODBUS check value", () => {
    expect(crc16Modbus(ascii("123456789"))).toBe(0x4b37);
  });
  it("matches the CLIENT_HELLO header word over bytes 0..6", () => {
    expect(crc16Modbus(DOC_CLIENT_HELLO, 0, 6)).toBe(0x71e6);
  });
});
