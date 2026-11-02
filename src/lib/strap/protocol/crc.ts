/**
 * Checksums used by the WHOOP envelopes. Table-driven, pure, browser-safe.
 *
 * Parameters (PROTOCOL_CONCEPTS.md § "Checksums"):
 *  - CRC8:          poly 0x07, init 0x00, no reflection, no final XOR (WHOOP 4 header, over the two length bytes)
 *  - CRC32 (zlib):  reflected poly 0xEDB88320, init 0xFFFFFFFF, final XOR 0xFFFFFFFF (both families, over the inner record)
 *  - CRC16-Modbus:  reflected poly 0xA001, init 0xFFFF, no final XOR (WHOOP 5 header, over bytes 0..6)
 */

function buildCrc8Table(): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 0x80) !== 0 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    }
    table[i] = c;
  }
  return table;
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

function buildCrc16ModbusTable(): Uint16Array {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC8_TABLE = buildCrc8Table();
const CRC32_TABLE = buildCrc32Table();
const CRC16_TABLE = buildCrc16ModbusTable();

/** CRC-8 (poly 0x07, init 0) over `bytes[start, end)`. */
export function crc8(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0;
  for (let i = start; i < end; i++) c = CRC8_TABLE[(c ^ bytes[i]) & 0xff];
  return c;
}

/** zlib / IEEE CRC-32 over `bytes[start, end)`, returned as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-16/MODBUS over `bytes[start, end)`. */
export function crc16Modbus(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffff;
  for (let i = start; i < end; i++) c = CRC16_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c & 0xffff;
}
