import { describe, expect, it } from "vitest";
import { StrapSession, type Effect } from "../../protocol";
import { buildFrame, PacketType, Command, MetadataType, WHOOP4_SERVICE, WHOOP4_CMD_RESPONSE, WHOOP4_DATA } from "../../protocol";

/** Minimal scripted WHOOP 4 strap: acks every write, answers START/END/COMPLETE on demand. */
function harness() {
  const effects: Effect[] = [];
  const s = new StrapSession({ onEffect: (e) => effects.push(e), settleMs: 0, responseTimeoutMs: 0 });
  let now = 0;
  const tick = (ms = 250) => {
    now += ms;
    s.tick(now);
  };
  const ackAllWrites = () => {
    for (const e of effects.splice(0).filter((x) => x.kind === "write")) s.onWriteAck(e.cmd, e.seq, true);
  };
  const metadata = (type: number, token: number[] = []) => {
    // The metadata type sits in the cmd slot (frame offset 6); the END token is at frame 17..25 = payload[10..18].
    const payload = new Uint8Array(20);
    new DataView(payload.buffer).setUint32(0, 1_700_000_000, true);
    token.forEach((b, i) => (payload[10 + i] = b));
    return buildFrame({ type: PacketType.METADATA, seq: 0, cmd: type, payload });
  };
  return { s, effects, tick, ackAllWrites, metadata };
}

describe("keep-alive sessions", () => {
  it("stays linked after HISTORY_COMPLETE and can pull the recorder again", () => {
    const h = harness();
    h.s.start({ model: "whoop4", nowUnix: 1_700_000_000, nowMs: 0, serviceUuid: WHOOP4_SERVICE, keepAlive: true });
    // Bond and handshake: acknowledge every write until the session asks for history.
    for (let i = 0; i < 30 && h.s.state !== "offloading"; i++) {
      h.ackAllWrites();
      h.tick();
    }
    expect(h.s.state).toBe("offloading");
    h.ackAllWrites();
    h.s.onNotification(WHOOP4_DATA, h.metadata(MetadataType.HISTORY_START));
    h.s.onNotification(WHOOP4_DATA, h.metadata(MetadataType.HISTORY_END, [1, 2, 3, 4, 5, 6, 7, 8]));
    const chunk = h.effects.find((e) => e.kind === "chunk");
    expect(chunk).toBeDefined();
    h.s.confirmChunkStored((chunk as { chunkId: number }).chunkId);
    h.ackAllWrites();
    h.s.onNotification(WHOOP4_DATA, h.metadata(MetadataType.HISTORY_COMPLETE));
    expect(h.s.state).toBe("linked");
    expect(h.effects.some((e) => e.kind === "cycleDone")).toBe(true);
    expect(h.effects.some((e) => e.kind === "done")).toBe(false);

    h.effects.length = 0;
    h.s.resumeOffload();
    expect(h.s.state).toBe("offloading");
    expect(h.effects.some((e) => e.kind === "write" && e.cmd === Command.SEND_HISTORICAL_DATA)).toBe(true);
    h.ackAllWrites();
    h.s.onNotification(WHOOP4_DATA, h.metadata(MetadataType.HISTORY_START));
    h.s.onNotification(WHOOP4_DATA, h.metadata(MetadataType.HISTORY_COMPLETE));
    expect(h.s.state).toBe("linked");

    h.s.end();
    expect(h.s.state).toBe("complete");
    expect(h.effects.some((e) => e.kind === "done")).toBe(true);
  });

  it("ignores resumeOffload outside the linked state", () => {
    const h = harness();
    h.s.start({ model: "whoop4", nowUnix: 1_700_000_000, nowMs: 0, serviceUuid: WHOOP4_SERVICE, keepAlive: true });
    h.s.resumeOffload();
    expect(h.s.state).not.toBe("offloading");
    expect(h.effects.some((e) => e.kind === "log" && /resumeOffload ignored/.test(e.message))).toBe(true);
  });
});

void WHOOP4_CMD_RESPONSE;
