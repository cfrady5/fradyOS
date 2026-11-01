import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { normalizeHeader, parseCsv } from "../csv";
import { toInstant, tzOffsetMinutes } from "../whoopTime";
import { parseWhoopExport } from "../whoopImport";
import { readZip } from "../zip";

const CYCLES = `Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Skin temp (celsius),Blood oxygen %,Day Strain,Energy burned (cal),Max HR (bpm),Average HR (bpm),Sleep onset,Wake onset,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep efficiency %,Sleep consistency %,Sleep need (min),Sleep debt (min)\r
2026-03-04 00:00:00,2026-03-05 00:00:00,UTC-05:00,67,52,88.4,33.1,96,14.2,2310,171,74,2026-03-03 23:10:00,2026-03-04 06:40:00,89,15.1,412,450,210,92,110,38,91.5,80,460,48\r
2026-03-05 00:00:00,,UTC-05:00,33,58,61.0,,,,,,,,,,,,,,,,,,,,\r
`;
const SLEEPS = `Cycle start time,Sleep onset,Wake onset,Cycle timezone,Nap,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep efficiency %,Sleep consistency %,Sleep need (min),Sleep debt (min)\r
2026-03-04 00:00:00,2026-03-03 23:10:00,2026-03-04 06:40:00,UTC-05:00,false,89,15.1,412,450,210,92,110,38,91.5,80,460,48\r
2026-03-04 00:00:00,2026-03-04 14:00:00,2026-03-04 14:30:00,UTC-05:00,true,,,28,30,,,,,,,,\r
`;
const WORKOUTS = `Cycle start time,Workout start time,Workout end time,Cycle timezone,Activity name,Activity Strain,Energy burned (cal),Max HR (bpm),Average HR (bpm),HR Zone 1 %,HR Zone 2 %,HR Zone 3 %,HR Zone 4 %,HR Zone 5 %,Distance (meters)\r
2026-03-04 00:00:00,2026-03-04 07:05:00,2026-03-04 07:50:00,UTC-05:00,Running,10.8,480,176,152,5,20,40,30,5,7600\r
`;
const JOURNAL = `Cycle start time,Cycle timezone,Question text,Answered yes/no,Notes\r
2026-03-04 00:00:00,UTC-05:00,"Have any caffeine?",true,"One coffee, ""black"""\r
`;

describe("csv", () => {
  it("normalises headers like NOOP", () => {
    expect(normalizeHeader("Recovery score %")).toBe("recovery_score_pct");
    expect(normalizeHeader("Heart rate variability (ms)")).toBe("heart_rate_variability_ms");
    expect(normalizeHeader("Deep (SWS) duration (min)")).toBe("deep_sws_duration_min");
    expect(normalizeHeader("HR Zone 1 %")).toBe("hr_zone_1_pct");
    expect(normalizeHeader("Answered yes/no")).toBe("answered_yes_no");
  });
  it("handles quotes, embedded commas and CRLF", () => {
    const t = parseCsv('a,b\r\n"hello, world","she said ""hi"""\r\n');
    expect(t.rows[0]).toEqual({ a: "hello, world", b: 'she said "hi"' });
  });
});

describe("whoop time", () => {
  it("reads the zone column and builds instants", () => {
    expect(tzOffsetMinutes("UTC-05:00")).toBe(-300);
    expect(tzOffsetMinutes("UTC+01:00")).toBe(60);
    expect(tzOffsetMinutes("UTC")).toBe(0);
    expect(toInstant("2026-03-04 06:40:00", "UTC-05:00")).toBe("2026-03-04T11:40:00.000Z");
  });
});

describe("parseWhoopExport", () => {
  it("reads loose CSVs into days, sleeps, workouts and journal rows", () => {
    const r = parseWhoopExport([
      { name: "physiological_cycles.csv", data: Buffer.from(CYCLES) },
      { name: "sleeps.csv", data: Buffer.from(SLEEPS) },
      { name: "workouts.csv", data: Buffer.from(WORKOUTS) },
      { name: "journal_entries.csv", data: Buffer.from(JOURNAL) },
    ]);
    expect(r.source).toBe("whoop");
    expect(r.days).toHaveLength(2);
    expect(r.days[0]).toMatchObject({ day: "2026-03-04", recovery: 67, strain: 14.2, hrv_ms: 88.4, resting_hr: 52, deep_min: 92, sleep_efficiency_pct: 91.5 });
    expect(r.days[1]).toMatchObject({ day: "2026-03-05", recovery: 33, strain: null, sleep_total_min: null });
    expect(r.sleeps).toHaveLength(2);
    expect(r.sleeps[0]).toMatchObject({ start_at: "2026-03-04T04:10:00.000Z", end_at: "2026-03-04T11:40:00.000Z", nap: false, day: "2026-03-04" });
    expect(r.sleeps[1].nap).toBe(true);
    expect(r.workouts[0]).toMatchObject({ activity: "Running", strain: 10.8, zone3_pct: 40, distance_m: 7600, day: "2026-03-04" });
    expect(r.journal[0]).toMatchObject({ question: "Have any caffeine?", answered_yes: true, notes: 'One coffee, "black"' });
  });

  it("reads a zip and recognises NOOP's Source column", () => {
    const lines = CYCLES.split("\r\n");
    const cycles = [lines[0] + ",Source", lines[1] + ",noop (APPROXIMATE)", lines[2] + ",import"].join("\r\n") + "\r\n";
    const zip = buildZip([["my_whoop_data/physiological_cycles.csv", cycles]]);
    const r = parseWhoopExport([{ name: "export.zip", data: zip }]);
    expect(r.source).toBe("noop");
    expect(r.files).toEqual(["physiological_cycles.csv"]);
    expect(r.days.map((d) => d.source)).toEqual(["noop (APPROXIMATE)", "import"]);
  });

  it("dedupes repeated days and ignores unknown files", () => {
    const r = parseWhoopExport([
      { name: "physiological_cycles.csv", data: Buffer.from(CYCLES + CYCLES.split("\r\n")[1] + "\r\n") },
      { name: "readme.txt", data: Buffer.from("hi") },
    ]);
    expect(r.days).toHaveLength(2);
  });
});

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Minimal zip writer (deflate) for the test. */
function buildZip(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, comp);
    centrals.push(central, n);
    offset += local.length + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("readZip", () => {
  it("inflates entries", () => {
    const z = buildZip([["a.csv", "x,y\r\n1,2\r\n"], ["dir/", ""]]);
    const e = readZip(z);
    expect(e.map((x) => x.name)).toEqual(["a.csv"]);
    expect(e[0].data.toString()).toBe("x,y\r\n1,2\r\n");
  });
});
