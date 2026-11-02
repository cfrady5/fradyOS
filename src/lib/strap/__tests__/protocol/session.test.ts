import { describe, expect, it } from "vitest";
import {
  CLIENT_HELLO_FRAME,
  Command,
  PacketType,
  WHOOP4_CMD_RESPONSE,
  WHOOP4_DATA,
  WHOOP4_SERVICE,
  WHOOP5_NOTIFY_0003,
  WHOOP5_NOTIFY_0005,
  WHOOP5_SERVICE,
  type StrapFamily,
} from "../../protocol/constants";
import { buildFrame, buildFrame5, parseFrame, parseFrame5 } from "../../protocol/framing";
import { StrapSession, type Effect } from "../../protocol/session";

type WriteEffect = Extract<Effect, { kind: "write" }>;

const NOW_UNIX = 1_700_000_000;

/** Drives a StrapSession the way a transport would, recording every effect. */
class Harness {
  readonly session: StrapSession;
  readonly effects: Effect[] = [];
  private seenWrites = 0;
  nowMs = 10_000;
  constructor(
    readonly family: StrapFamily,
    options: ConstructorParameters<typeof StrapSession>[0] = {},
  ) {
    this.session = new StrapSession({ ...options, onEffect: (e) => this.effects.push(e) });
  }
  start(model: "whoop4" | "whoop5" | "auto" = this.family) {
    this.session.start({ model, nowUnix: NOW_UNIX, nowMs: this.nowMs, serviceUuid: this.family === "whoop4" ? WHOOP4_SERVICE : WHOOP5_SERVICE });
  }
  tick(ms: number) {
    this.nowMs += ms;
    this.session.tick(this.nowMs);
  }
  get writes(): WriteEffect[] {
    return this.effects.filter((e): e is WriteEffect => e.kind === "write");
  }
  /** Writes emitted since the previous call. */
  newWrites(): WriteEffect[] {
    const all = this.writes;
    const out = all.slice(this.seenWrites);
    this.seenWrites = all.length;
    return out;
  }
  ack(w: WriteEffect, ok = true, error?: string) {
    this.session.onWriteAck(w.cmd, w.seq, ok, error);
  }
  /** Ack the single new write and return it; fails the test if there is not exactly one. */
  ackNext(): WriteEffect {
    const ws = this.newWrites();
    expect(ws.length).toBe(1);
    this.ack(ws[0]);
    return ws[0];
  }
  states(): string[] {
    return this.effects.filter((e) => e.kind === "state").map((e) => (e as { state: string }).state);
  }
  kinds<K extends Effect["kind"]>(kind: K): Extract<Effect, { kind: K }>[] {
    return this.effects.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
  }
  logs(): string[] {
    return this.kinds("log").map((l) => l.message);
  }
  // ---- strap → app frames -------------------------------------------------
  private frame(type: number, seq: number, inner: Uint8Array): Uint8Array {
    return this.family === "whoop4"
      ? buildFrame({ type, seq, cmd: inner[0], payload: inner.subarray(1) })
      : buildFrame5({ type, seq, cmd: inner[0], payload: inner.subarray(1) }, [1, 0]);
  }
  private dataUuid() {
    return this.family === "whoop4" ? WHOOP4_DATA : WHOOP5_NOTIFY_0005;
  }
  private respUuid() {
    return this.family === "whoop4" ? WHOOP4_CMD_RESPONSE : WHOOP5_NOTIFY_0003;
  }
  notifyData(bytes: Uint8Array) {
    this.session.onNotification(this.dataUuid(), bytes);
  }
  respond(cmd: number, originSeq: number, result: number, body: Uint8Array | number[]) {
    const inner = Uint8Array.from([cmd, originSeq, result, ...Array.from(body)]);
    this.session.onNotification(this.respUuid(), this.frame(PacketType.COMMAND_RESPONSE, 0x80, inner));
  }
  start_() {
    this.notifyData(this.frame(PacketType.METADATA, 0, Uint8Array.from([1])));
  }
  end(token: number[], unix = NOW_UNIX - 60): Uint8Array {
    const inner = new Uint8Array(19);
    inner[0] = 2;
    new DataView(inner.buffer).setUint32(1, unix, true);
    inner.set(token, 11);
    const f = this.frame(PacketType.METADATA, 0, inner);
    this.notifyData(f);
    return f;
  }
  complete() {
    this.notifyData(this.frame(PacketType.METADATA, 0, Uint8Array.from([3])));
  }
  /** A type-47 record frame for this family (v24 on 4.0, v18 on 5.0). */
  record(unix: number, hr: number, rr: number[]): Uint8Array {
    if (this.family === "whoop4") {
      const inner = new Uint8Array(82); // frame[6..88)
      const v = new DataView(inner.buffer);
      v.setUint32(11 - 6, unix, true);
      inner[21 - 6] = hr;
      inner[22 - 6] = rr.length;
      rr.forEach((ms, i) => v.setUint16(23 - 6 + 2 * i, ms, true));
      v.setFloat32(40 - 6, 0, true);
      v.setFloat32(44 - 6, 0, true);
      v.setFloat32(48 - 6, 1, true);
      inner[55 - 6] = 1;
      return this.frame(PacketType.HISTORICAL_DATA, 24, inner);
    }
    const inner = new Uint8Array(110); // frame[10..120)
    const v = new DataView(inner.buffer);
    v.setUint32(11 - 10, 1, true);
    v.setUint32(15 - 10, unix, true);
    inner[22 - 10] = hr;
    inner[23 - 10] = rr.length;
    rr.forEach((ms, i) => v.setUint16(24 - 10 + 2 * i, Math.round((ms * 1024) / 1000), true));
    v.setFloat32(53 - 10, 1, true);
    return this.frame(PacketType.HISTORICAL_DATA, 18, inner);
  }
}

const TOKEN_A = [0x1f, 0x57, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00];
const TOKEN_B = [0x7b, 0x57, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00];

function hexFrameSecs(w: WriteEffect, family: StrapFamily): number {
  const p = family === "whoop4" ? parseFrame(w.bytes) : parseFrame5(w.bytes);
  const off = family === "whoop4" ? 0 : 1;
  return new DataView(p.payload.buffer, p.payload.byteOffset).getUint32(off, true);
}

describe("StrapSession — WHOOP 4 end to end", () => {
  it("bonds, runs the documented handshake once, settles, offloads and acks only after the host confirms", () => {
    const h = new Harness("whoop4");
    h.start();

    // Bond write: confirmed GET_BATTERY_LEVEL [0x00], exactly the documented frame bytes.
    const bond = h.newWrites();
    expect(bond.length).toBe(1);
    expect(bond[0]).toMatchObject({ cmd: 26, withResponse: true, purpose: "bond", seq: 0 });
    expect(Buffer.from(bond[0].bytes).toString("hex")).toBe("aa0800a823001a001725ee23");
    expect(h.session.state).toBe("bonding");
    h.ack(bond[0]);
    expect(h.session.state).toBe("handshake");

    // Battery response correlates to the bond write by origin seq.
    h.respond(26, 0, 1, [0xf3, 0x01]);
    const battery = h.kinds("response").at(-1)!;
    expect(battery.matchedRequest).toBe(true);
    expect(battery.decoded).toEqual({ kind: "battery", battery: { percent: 49.9, unit: "tenths" } });

    // Handshake, in the documented order, each write issued after the previous ack.
    const expected: Array<[number, number[] | null, boolean]> = [
      [35, [0], false],
      [76, [0], false],
      [7, [0], false],
      [10, null, false], // 8-byte
      [10, null, false], // 9-byte
      [11, [], false],
      [11, [0], false],
      [63, [0], false],
      [34, [0], false],
    ];
    const seen: WriteEffect[] = [];
    for (const [cmd, payload, withResponse] of expected) {
      const w = h.ackNext();
      seen.push(w);
      expect(w.cmd).toBe(cmd);
      expect(w.withResponse).toBe(withResponse);
      expect(w.purpose).toBe("handshake");
      const parsed = parseFrame(w.bytes);
      expect(parsed.ok).toBe(true);
      if (payload) expect(Array.from(parsed.payload)).toEqual(payload);
      if (cmd === 35) {
        const body = new Uint8Array(131);
        body.set(Uint8Array.from("4A0123456", (c) => c.charCodeAt(0)), 14);
        body.set(Uint8Array.from("SECRET", (c) => c.charCodeAt(0)), 24);
        h.respond(35, w.seq, 1, body);
      }
    }
    expect(parseFrame(seen[3].bytes).payload.length).toBe(8);
    expect(parseFrame(seen[4].bytes).payload.length).toBe(9);
    expect(hexFrameSecs(seen[3], "whoop4")).toBe(NOW_UNIX);
    const hello = h.kinds("response").find((r) => r.response.cmd === 35)!;
    expect(hello.decoded).toMatchObject({ kind: "hello", hello: { serial: "4A0123456" } });
    expect(JSON.stringify(hello.decoded)).not.toContain("SECRET");
    expect(h.logs().some((m) => m.includes("4A0123456"))).toBe(true);
    expect(h.logs().some((m) => m.includes("SECRET"))).toBe(false);

    // Settle ~1.5 s before SEND_HISTORICAL_DATA.
    expect(h.session.state).toBe("settling");
    h.tick(1000);
    expect(h.newWrites()).toEqual([]);
    h.tick(600);
    const hist = h.newWrites();
    expect(hist.length).toBe(1);
    expect(hist[0]).toMatchObject({ cmd: 22, withResponse: true, purpose: "history" });
    expect(Array.from(parseFrame(hist[0].bytes).payload)).toEqual([0]);
    expect(h.session.state).toBe("offloading");
    h.ack(hist[0]);
    h.respond(22, hist[0].seq, 1, []);

    // START, three records fragmented across notifications, END with a token.
    h.start_();
    const r1 = h.record(NOW_UNIX - 300, 58, [1034, 1021]);
    const r2 = h.record(NOW_UNIX - 299, 59, [1010]);
    const r3 = h.record(NOW_UNIX - 298, 60, []);
    const stream = new Uint8Array([...r1, ...r2, ...r3]);
    for (let o = 0; o < stream.length; o += 23) h.notifyData(stream.subarray(o, Math.min(stream.length, o + 23)));
    const records = h.kinds("record");
    expect(records.length).toBe(3);
    expect(records.map((r) => (r.record.source === "historical" ? r.record.hr : -1))).toEqual([58, 59, 60]);
    expect(records[0].record).toMatchObject({ source: "historical", chunkId: 1, version: 24, rr: [1034, 1021] });

    const endFrame = h.end(TOKEN_A);
    const chunks = h.kinds("chunk");
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkId).toBe(1);
    expect(chunks[0].records.length).toBe(3);
    expect(chunks[0].rawFrames.length).toBe(3);
    expect(Array.from(chunks[0].token)).toEqual(TOKEN_A);
    expect(Array.from(chunks[0].token)).toEqual(Array.from(endFrame.subarray(17, 25)));
    expect(chunks[0].endUnix).toBe(NOW_UNIX - 60);

    // Save-before-ack: nothing is written until the host confirms.
    h.tick(500);
    expect(h.newWrites()).toEqual([]);
    // A repeated END with the same token (strap retry) does not open a second chunk.
    h.end(TOKEN_A);
    expect(h.kinds("chunk").length).toBe(1);

    h.session.confirmChunkStored(1);
    const ack = h.newWrites();
    expect(ack.length).toBe(1);
    expect(ack[0]).toMatchObject({ cmd: 23, withResponse: true, purpose: "ack" });
    expect(Array.from(parseFrame(ack[0].bytes).payload)).toEqual([1, ...TOKEN_A]);
    h.ack(ack[0]);
    h.respond(23, ack[0].seq, 1, []);

    // Second chunk with no records; COMPLETE arrives before the host confirms it → done is deferred.
    h.end(TOKEN_B);
    expect(h.kinds("chunk").length).toBe(2);
    h.complete();
    expect(h.session.state).toBe("offloading");
    expect(h.kinds("done").length).toBe(0);
    h.session.confirmChunkStored(2);
    const ack2 = h.ackNext();
    expect(Array.from(parseFrame(ack2.bytes).payload)).toEqual([1, ...TOKEN_B]);
    expect(h.session.state).toBe("complete");
    const done = h.kinds("done");
    expect(done.length).toBe(1);
    expect(done[0].summary).toMatchObject({ reason: "complete", complete: true, records: 3, chunks: 2, acked: 2, unacked: 0, unknownRecords: 0 });
    expect(h.states()).toEqual(["bonding", "handshake", "settling", "offloading", "complete"]);

    // The handshake never ran twice: exactly one write per handshake command id.
    const handshakeWrites = h.writes.filter((w) => w.purpose === "handshake");
    expect(handshakeWrites.length).toBe(9);
    expect(h.kinds("error")).toEqual([]);
  });

  it("maps an insufficient-authentication failure on the bond write to a clear bond-refused error", () => {
    const h = new Harness("whoop4");
    h.start();
    const [bond] = h.newWrites();
    h.ack(bond, false, "GATT_INSUFFICIENT_AUTHENTICATION");
    const errors = h.kinds("error");
    expect(errors.length).toBe(1);
    expect(errors[0].fatal).toBe(true);
    expect(errors[0].message).toMatch(/^bond refused: free the strap from the WHOOP app and put it in pairing mode/);
    expect(h.session.state).toBe("failed");
    expect(h.kinds("done")[0].summary.reason).toBe("failed");
    // Nothing else is written after a fatal failure.
    h.tick(5000);
    expect(h.newWrites()).toEqual([]);
  });

  it("maps an authentication failure on a later write to bond-refused as well, and fails when the bond write is never acked", () => {
    const h = new Harness("whoop4");
    h.start();
    h.ackNext();
    const [hello] = h.newWrites();
    h.ack(hello, false, "Encryption is insufficient");
    expect(h.kinds("error")[0].message).toMatch(/bond refused/);

    const g = new Harness("whoop4", { bondAckTimeoutMs: 1000 });
    g.start();
    g.newWrites();
    g.tick(1500);
    expect(g.kinds("error")[0].message).toMatch(/not acknowledged/);
    expect(g.session.state).toBe("failed");
  });

  it("re-requests history on idle timeout without re-running the handshake, then reports a stall", () => {
    const h = new Harness("whoop4", { idleTimeoutMs: 1000, maxReRequests: 2 });
    h.start();
    h.ackNext(); // bond
    for (let i = 0; i < 9; i++) h.ackNext(); // handshake
    h.tick(1500);
    const first = h.ackNext();
    expect(first.cmd).toBe(22);
    h.tick(1100);
    const second = h.ackNext();
    expect(second.cmd).toBe(22);
    h.tick(1100);
    const third = h.ackNext();
    expect(third.cmd).toBe(22);
    h.tick(1100);
    expect(h.newWrites()).toEqual([]);
    expect(h.kinds("done")[0].summary.reason).toBe("stalled");
    expect(h.kinds("error")[0]).toMatchObject({ fatal: false });
    expect(h.writes.filter((w) => w.purpose === "handshake").length).toBe(9);
  });

  it("abort() writes ABORT_HISTORICAL_TRANSMITS and drops pending chunks without acknowledging them", () => {
    const h = new Harness("whoop4");
    h.start();
    h.ackNext();
    for (let i = 0; i < 9; i++) h.ackNext();
    h.tick(1500);
    h.ackNext(); // 22
    h.start_();
    h.notifyData(h.record(NOW_UNIX - 10, 61, [990]));
    h.end(TOKEN_A);
    expect(h.kinds("chunk").length).toBe(1);
    h.session.abort();
    const [abort] = h.newWrites();
    expect(abort).toMatchObject({ cmd: 20, withResponse: true, purpose: "abort" });
    expect(Array.from(parseFrame(abort.bytes).payload)).toEqual([0]);
    expect(h.session.state).toBe("aborted");
    expect(h.kinds("done")[0].summary).toMatchObject({ reason: "aborted", chunks: 1, acked: 0, unacked: 1 });
    h.ack(abort);
    h.session.confirmChunkStored(1); // too late: no ack goes out
    expect(h.writes.some((w) => w.cmd === 23)).toBe(false);
  });

  it("keeps unknown record layouts raw in the chunk and counts them", () => {
    const h = new Harness("whoop4");
    h.start();
    h.ackNext();
    for (let i = 0; i < 9; i++) h.ackNext();
    h.tick(1500);
    h.ackNext();
    h.start_();
    h.notifyData(buildFrame({ type: 47, seq: 99, cmd: 0, payload: new Uint8Array(60) }));
    h.notifyData(h.record(NOW_UNIX - 10, 61, [990]));
    h.end(TOKEN_A);
    const chunk = h.kinds("chunk")[0];
    expect(chunk.records.length).toBe(1);
    expect(chunk.rawFrames.length).toBe(2);
    expect(h.logs().some((m) => m.includes("unknown type-47 layout version 99"))).toBe(true);
  });

  it("allows TOGGLE_REALTIME_HR only after the handshake and emits realtime records", () => {
    const h = new Harness("whoop4");
    h.start();
    h.session.requestRealtimeHr(true);
    expect(h.writes.some((w) => w.cmd === 3)).toBe(false);
    h.ackNext();
    for (let i = 0; i < 9; i++) h.ackNext();
    h.session.requestRealtimeHr(true);
    const [rt] = h.newWrites();
    expect(rt).toMatchObject({ cmd: 3, withResponse: false, purpose: "realtime" });
    expect(Array.from(parseFrame(rt.bytes).payload)).toEqual([1]);
    const inner = new Uint8Array(12);
    const v = new DataView(inner.buffer);
    v.setUint32(0, NOW_UNIX, true);
    inner[6] = 64;
    inner[7] = 1;
    v.setUint16(8, 940, true);
    h.notifyData(buildFrame({ type: 40, seq: 1, cmd: inner[0], payload: inner.subarray(1) }));
    expect(h.kinds("record")[0].record).toMatchObject({ source: "realtime", hr: 64, rr: [940] });
  });

  it("decodes events and ignores notifications from standard characteristics", () => {
    const h = new Harness("whoop4");
    h.start();
    h.ackNext();
    h.session.onNotification("00002a37-0000-1000-8000-00805f9b34fb", Uint8Array.from([0x10, 60, 0, 4]));
    h.session.onNotification("61080004-8d6d-82b8-614a-1c8cb0f8dcc6", buildFrame({ type: 48, seq: 1, cmd: 14, payload: Uint8Array.from([0, 1, 2, 3, 4]) }));
    const events = h.kinds("event");
    expect(events.length).toBe(1);
    expect(events[0].event.name).toBe("DOUBLE_TAP");
  });

  it("fails fast when model is auto and no service UUID is given", () => {
    const s = new StrapSession();
    s.start({ model: "auto", nowUnix: NOW_UNIX, nowMs: 0 });
    const effects = s.drain();
    expect(effects.find((e) => e.kind === "error")).toMatchObject({ fatal: true });
    expect(s.state).toBe("failed");
  });
});

describe("StrapSession — WHOOP 5 end to end", () => {
  it("writes CLIENT_HELLO as the bond, reads the clock, fixes drift, requests the range, then offloads with +4 offsets", () => {
    const h = new Harness("whoop5");
    h.start("auto");
    const [hello] = h.newWrites();
    expect(hello).toMatchObject({ cmd: Command.GET_HELLO, seq: 1, withResponse: true, purpose: "bond" });
    expect(Array.from(hello.bytes)).toEqual(Array.from(CLIENT_HELLO_FRAME));
    h.ack(hello);
    expect(h.logs().some((m) => m.includes("CLIENT_HELLO acknowledged"))).toBe(true);
    // The strap answers hello with PENDING then SUCCESS; neither leaks identity blocks into logs.
    h.respond(145, 1, 2, new Uint8Array(107));
    h.respond(145, 1, 1, new Uint8Array(107));

    // GET_CLOCK (147) awaits its response.
    const [getClock] = h.newWrites();
    expect(getClock).toMatchObject({ cmd: 147, withResponse: false });
    expect(Array.from(parseFrame5(getClock.bytes).payload)).toEqual([1]);
    h.ack(getClock);
    expect(h.newWrites()).toEqual([]);
    const clockBody = new Uint8Array(7);
    clockBody[0] = 1;
    new DataView(clockBody.buffer).setUint32(1, NOW_UNIX - 100, true);
    h.respond(147, getClock.seq, 1, clockBody);

    // Drift of 100 s > 30 s → SET_CLOCK (146) [1, now u32, ticks u16], then a readback.
    const [setClock] = h.newWrites();
    expect(setClock.cmd).toBe(146);
    const setPayload = parseFrame5(setClock.bytes).payload;
    expect(setPayload[0]).toBe(1);
    expect(hexFrameSecs(setClock, "whoop5")).toBe(NOW_UNIX);
    h.ack(setClock);
    const [reread] = h.newWrites();
    expect(reread.cmd).toBe(147);
    h.ack(reread);
    h.tick(2100); // no reply → times out and moves on
    const [range] = h.newWrites();
    expect(range).toMatchObject({ cmd: 34, withResponse: false });
    h.ack(range);
    h.respond(34, range.seq, 2, []);
    expect(h.session.state).toBe("settling");
    h.tick(1500);
    const [hist] = h.newWrites();
    expect(hist).toMatchObject({ cmd: 22, withResponse: true });
    expect(parseFrame5(hist.bytes).ok).toBe(true);
    h.ack(hist);

    h.start_();
    h.notifyData(h.record(NOW_UNIX - 50, 62, [1000, 977]));
    const endFrame = h.end(TOKEN_A);
    const [chunk] = h.kinds("chunk");
    expect(chunk.records.length).toBe(1);
    expect(chunk.records[0]).toMatchObject({ version: 18, hr: 62, rr: [1000, 977], family: "whoop5" });
    expect(Array.from(chunk.token)).toEqual(Array.from(endFrame.subarray(21, 29)));
    expect(h.newWrites()).toEqual([]);
    h.session.confirmChunkStored(chunk.chunkId);
    const [ack] = h.newWrites();
    const parsedAck = parseFrame5(ack.bytes);
    expect(parsedAck.ok).toBe(true);
    expect(parsedAck.cmd).toBe(23);
    expect(Array.from(parsedAck.payload.subarray(0, 9))).toEqual([1, ...TOKEN_A]);
    h.ack(ack);
    h.complete();
    expect(h.session.state).toBe("complete");
    expect(h.kinds("done")[0].summary).toMatchObject({ reason: "complete", records: 1, chunks: 1, acked: 1 });
    expect(h.writes.filter((w) => w.cmd === 63 || w.cmd === 76 || w.cmd === 7 || w.cmd === 35).length).toBe(0);
  });

  it("skips SET_CLOCK when the strap clock is within the drift threshold", () => {
    const h = new Harness("whoop5");
    h.start();
    h.ackNext();
    const [getClock] = h.newWrites();
    h.ack(getClock);
    const body = new Uint8Array(7);
    body[0] = 1;
    new DataView(body.buffer).setUint32(1, NOW_UNIX + 5, true);
    h.respond(147, getClock.seq, 1, body);
    const [next] = h.newWrites();
    expect(next.cmd).toBe(34);
  });

  it("reports bond refusal for a rejected CLIENT_HELLO with 5.0-specific guidance", () => {
    const h = new Harness("whoop5");
    h.start();
    const [hello] = h.newWrites();
    h.ack(hello, false, "insufficient encryption");
    const err = h.kinds("error")[0];
    expect(err.message).toMatch(/bond refused/);
    expect(err.message).toMatch(/LEDs flash blue/);
  });
});
