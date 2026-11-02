# WHOOP strap BLE protocol layer

Pure TypeScript (Uint8Array / DataView only, no browser or Node APIs) that lets
FRADY OS talk to a WHOOP 4.0 or WHOOP 5.0 / MG strap directly over Bluetooth LE,
with no WHOOP cloud involved. It covers framing, checksums, command encoding,
record decoding and a transport-independent session state machine. The
Bluetooth transport (Web Bluetooth in the browser, `@capacitor-community/bluetooth-le`
in the app) is a separate concern that executes the effects the session emits.

**Nothing in this directory has touched a real strap.** Every byte layout is
implemented from NOOP's protocol documentation and its machine-readable
`whoop_protocol.json`; the tests use constructed frames plus the handful of
real frames those docs reproduce. See "Unverified on hardware" below.

## Licensing

NOOP's code is PolyForm Noncommercial and was not copied, paraphrased or
vendored. Its LICENSE states that the protocol facts (UUIDs, frame layouts, CRC
parameters, command / event / packet numbers, byte offsets) are uncopyrightable
and freely reusable; this module is an original implementation of those facts.
Each source file cites the doc file and section a fact comes from.

## Files

| File | What it holds |
|---|---|
| `constants.ts` | GATT UUIDs for both families and the standard HR / Battery / DIS services, packet types, metadata types, result codes, every event id, the command ids this layer uses, the destructive-command deny list, framing constants, the fixed `CLIENT_HELLO` frame. |
| `crc.ts` | Table-driven CRC8 (poly 0x07), CRC32 (zlib) and CRC16-Modbus. |
| `framing.ts` | `buildFrame` / `parseFrame` (WHOOP 4), `buildFrame5` / `parseFrame5` (WHOOP 5 format 1), `Reassembler` (per characteristic, resyncs on 0xAA, bounded sizes). |
| `commands.ts` | Typed builders returning `{ cmd, payload, withResponse }`, `encodeCommand`, `SequenceCounter`. |
| `records.ts` | Decoders for type 36 responses, 48 events, 49 metadata, 40 realtime, 47 historical (v5/7/9/12/24/25 on 4.0, v18 on 5.0) and the response bodies (hello, version info, battery, data range, clock, extended battery). |
| `session.ts` | `StrapSession`: bond → handshake → settle → offload loop with save-before-ack, timeouts, abort, bond-refused mapping. |
| `index.ts` | Public API re-exports. |

## Transport contract

```ts
const session = new StrapSession({ onEffect });   // or poll session.drain()
session.start({ model: "whoop4" | "whoop5" | "auto", nowUnix, nowMs, serviceUuid });
session.onNotification(characteristicUuid, bytes); // every notification on 6108…/fd4b… characteristics
session.onWriteAck(cmd, seq, ok, errorText?);     // exactly once per { kind: "write" } effect
session.tick(nowMs);                               // every ~250–500 ms, same clock as nowMs
session.confirmChunkStored(chunkId);               // after the chunk effect was durably persisted
session.abort();                                   // stop without trimming
```

Before `start`, the transport subscribes the family's notify characteristics
(`FAMILY_GATT[family].notify`). The custom characteristics on WHOOP 5 need an
encrypted link, so the first write may trigger OS pairing.

Effects: `write` (bytes, `withResponse`, cmd, seq, purpose), `log`, `state`,
`record` (historical with `chunkId`, or realtime), `event`, `response` (decoded
type-36 body, correlated by command + origin sequence), `chunk` (records, raw
frames and the 8-byte END token to persist), `offloadProgress`, `done`, `error`.

### Save-before-ack

A `HISTORY_END` produces a `chunk` effect and nothing is written to the strap
until the host calls `confirmChunkStored(chunkId)`. Only then is
`HISTORICAL_DATA_RESULT` (`[0x01] || token`) written with response, where the
token is the eight bytes copied verbatim from the END frame (frame[17..25) on
4.0, frame[21..29) on 5.0). Repeated ENDs with the same token while the host is
still storing are ignored; an END repeating the last acknowledged token is
re-acknowledged (idempotent). `HISTORY_COMPLETE` ends the session only after
every outstanding chunk is confirmed and acknowledged. Timeouts re-request
`SEND_HISTORICAL_DATA`; the handshake is never re-run mid-offload.

## 4.0 vs 5.0 as implemented

| | WHOOP 4.0 ("Harvard") | WHOOP 5.0 / MG ("puffin") |
|---|---|---|
| Service | `61080001-…`, write 0002, notify 0003/0004/0005 | `fd4b0001-…`, write 0002, notify 0003/0004/0005/0007 |
| Envelope | `AA, len u16le, crc8(len), type, seq, cmd, payload, crc32le`; size = len + 4; min 11 | `AA, 01, len u16le, hdr(2), crc16-modbus[0..6), type, seq, cmd, body padded to 4, crc32le`; size = len + 8; min 13 inbound, 16 outbound |
| Bond proof | confirmed `GET_BATTERY_LEVEL [00]` write acknowledged | confirmed fixed `CLIENT_HELLO` (GET_HELLO 145 rev 1) write acknowledged |
| Handshake (once) | 35, 76, 7, SET_CLOCK 8-byte, SET_CLOCK 9-byte, GET_CLOCK empty, GET_CLOCK `[00]`, 63 `[00]`, 34 `[00]` | GET_CLOCK 147 `[01]` (await reply); SET_CLOCK 146 only if drift > 30 s, then re-read; 34 `[00]` |
| Then | ~1.5 s settle → 22 `[00]` with response → START / 47 / END / … / COMPLETE | same |
| Response slots | cmd@6, origin@7, result@8, body@9 | cmd@10, origin@11, result@12, body@13 |
| Event slots | id@6, unix@8; battery soc u16/10@17, mV@21, charging bit@26 | +4 |
| END token | frame[17..25) | frame[21..29) |
| Type 40 | unix@6, subsec@10, HR@12, count@13, R-R ms u16 from 14 | +4, R-R in 1/1024 s ticks → `(t*1000+512)//1024` ms |
| Type 47 | version = frame[5]: v24/v12 full layout, v25 84-byte gravity-only, v5/7/9 HR-only | version = frame[9]: v18 (124 bytes: index@11, unix@15, HR@22, R-R@24, gravity f32@45/49/53, skin temp u16/100 °C@73, steps@57, state@81). v20/v21/v26 kept raw. |
| Battery (26) | `u16le / 10` percent | `u32le` whole percent |
| Identity | serial = 9 chars at hello body offset 14; bytes 24..78 (key material) never read | DIS Serial Number String (2A25) via the transport; hello identity blocks not copied |

## Fact sources

- GATT UUIDs, 4.0 envelope, connect lifecycle, END layout, hello serial: `docs/PROTOCOL_WHOOP4.md`.
- 5.0 service, `CLIENT_HELLO`, DIS identification: `docs/PROTOCOL_WHOOP5.md`.
- Format-1 framing, response offsets and result codes, clock contracts (146/147), data-range body, history ownership rules, battery bodies: `docs/PROTOCOL_TRANSPORT.md`.
- Command ids, request bodies, confirmed-write usage, forbidden commands: `docs/PROTOCOL_COMMANDS.md`, `docs/PROTOCOL_IMPLEMENTATION.md` (§ client subset, § destructive commands, § session state machine, § safe-trim invariant, § watchdog).
- Record layouts (type 40, v24, v25, R18 / v18): `docs/PROTOCOL_SENSORS.md`, `docs/BLE_REVERSE_ENGINEERING.md` §§ 2, 3, 5.
- CRC parameters: `docs/PROTOCOL_CONCEPTS.md`.
- Enums (packet, metadata, event, command, result numbers): `whoop_protocol.json`.
- Test vectors: the two complete WHOOP 4 event frames in `docs/BLE_REVERSE_ENGINEERING.md` appendix and the `CLIENT_HELLO` frame; everything else in the tests is constructed.

## Choices where the docs were ambiguous

- `whoop_protocol.json` names 10/11 `SET_CLOCK`/`GET_CLOCK`; the command matrix calls them `*_DEPRECATED` on 5.0 and has no JSON entry for 146/147. The ids are taken from the matrix and named `SET_CLOCK_V5`/`GET_CLOCK_V5`.
- SET_CLOCK form order on 4.0: 8-byte then 9-byte (41.17.6.0 was observed to latch only the 9-byte body, so it is last). Both carry the same wall-clock seconds.
- Handshake steps advance on the write acknowledgement, not on the reply (many 4.0 firmwares are silent for 7/10/11/26/35); only the 5.0 `GET_CLOCK` steps await their reply (2 s timeout).
- 5.0 handshake: the documented 4.0 commands 76/7/63 return UNSUPPORTED on 5.0, so they are not sent. `SET_CLOCK` 146 is written only when the readback drifts more than `clockDriftThresholdS` (default 30 s), mirroring NOOP's documented clock policy.
- 5.0 frame minimum: the firmware accepts inbound frames only above 15 bytes with 4-byte padding; strap-emitted frames are accepted here from 13 bytes without enforcing the padding rule, which is NOOP's documented floor.
- `GET_DATA_RANGE` on 4.0 has no documented body; the decoder scans aligned u32 words for plausible Unix seconds (2015–2039) and reports min/max, and decodes the 65-byte 5.0 structure when present.
- `GET_CLOCK` (11) reply on 4.0 is undocumented; the first plausible u32 at body offset 0 or 1 is used and flagged `documented: false`.
- v24 R-R words are capped at five so they never run into the optical scalars at offset 33.
- Authentication failures: any failed bond write, and any later write whose error text matches insufficient / authentication / encryption / bonding / pairing / security, becomes the fatal "bond refused" error with family-specific instructions.
- The deny list also includes FORGET_BONDS (15) and SET_READ_POINTER (33), beyond firmware / DFU / reboot / power-cycle / force-trim / fuel-gauge, because they mutate pairing or history ownership. `buildFrame` throws for any of them.

## Unverified on hardware

Everything. In particular: that the write-ack gating of handshake steps works on real stacks, the WHOOP 5 handshake choice (147/146/34), that `GET_CLOCK` 147 is answered, the heuristic 4.0 data-range / clock decoders, the v18 secondary fields (steps, activity, band state, skin temperature), the idle / re-request timings, and the exact error strings each platform reports for an unauthenticated write. The next step is a capture against a strap the user owns.
