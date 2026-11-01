/**
 * Small, tolerant CSV reader for WHOOP and NOOP exports. Handles quoted fields with embedded commas,
 * quotes and newlines, CRLF line ends and a UTF-8 BOM. Headers are normalised the way NOOP does it
 * ("Recovery score %" -> "recovery_score_pct", "Deep (SWS) duration (min)" -> "deep_sws_duration_min")
 * so column order and capitalisation never matter.
 */
export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[()\/\\-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") records.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") records.push(row);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map(normalizeHeader);
  const rows = records.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { headers, rows };
}

export function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

export function bool(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["true", "yes", "1", "y"].includes(t)) return true;
  if (["false", "no", "0", "n"].includes(t)) return false;
  return null;
}
