/**
 * Signal-derivation layer for strap data: the shapes shared by aggregate, sleep, cardio, strain and
 * daily. Everything here is an estimate computed from heart rate, R-R intervals and motion. None of it is
 * EEG, polysomnography or a medical measurement, and nothing substitutes a number for missing data.
 */

/** One raw transport record, as the BLE or offload layer hands it over. `unix` is in seconds. */
export interface StrapRecord {
  unix: number;
  /** Beats per minute; 0 or null means no reading. */
  hr: number | null;
  /** R-R intervals in milliseconds received with this record. */
  rr: number[];
  /** Gravity vector in g, when the record carries one. */
  gravity?: [number, number, number];
  skinContact?: boolean;
  /** Uncalibrated ADC value; not degrees. */
  rawSkinTemp?: number;
  /** Uncalibrated optical scalars; not a saturation. */
  rawSpo2?: { red: number; ir: number };
  /** Uncalibrated respiration-adjacent scalar; not breaths per minute. */
  rawResp?: number;
  /** Device quality word, scale unknown; carried for auditing, never used to invent a reading. */
  quality?: number;
}

/** One stored minute. `minute` is the ISO instant (UTC) at the start of the minute. */
export interface StrapMinute {
  minute: string;
  hrAvg: number | null;
  hrMin: number | null;
  hrMax: number | null;
  /** R-R intervals in ms, oldest first, capped at 200 per minute. */
  rr: number[];
  /** Mean magnitude of gravity-vector change per second, in g; 0 when perfectly still, null without gravity data. */
  motion: number | null;
  /** Share of the minute's samples that reported skin contact (0..1); null when the device does not report it. */
  skinContact: number | null;
  rawSkinTemp: number | null;
  rawSpo2: { red: number; ir: number } | null;
  rawResp: number | null;
  /** Records received in this minute. */
  samples: number;
}

export interface StrapProfile {
  /** IANA timezone used for local days, bedtimes and the noon day boundary. */
  timezone: string;
  /** User-set maximum heart rate, or an estimate such as 220 minus age. Null disables strain. */
  maxHr: number | null;
  /** Fallback resting heart rate when no night has been measured yet. */
  restingHrHint?: number | null;
}

export type SleepStage = "awake" | "light" | "deep" | "rem";

export interface StagedMinute {
  minute: string;
  stage: SleepStage;
}

/**
 * One detected rest episode. `day` is the wake day in the profile timezone for the main sleep (the night
 * that ended that morning) and the local calendar day of the nap for naps.
 */
export interface SleepEpisode {
  /** ISO instant of the first restful minute. */
  start: string;
  /** ISO instant one minute after the last restful minute (exclusive). */
  end: string;
  day: string;
  nap: boolean;
  /** "main": the night's longest sleep. "nap": a daytime rest. "fragment": a second night block that is not the main sleep. */
  kind: "main" | "nap" | "fragment";
  minutesAsleep: number;
  minutesAwake: number;
  stages: StagedMinute[];
  light: number;
  deep: number;
  rem: number;
  awake: number;
  /** Asleep minutes divided by minutes in bed, 0..100. */
  efficiency: number;
  /** Awake bouts of at least 2 minutes inside the episode. */
  disturbances: number;
  /** Minutes since the previous local noon, so bedtimes around midnight form one continuous scale. */
  onsetMin: number;
  wakeMin: number;
  /** 0..1: how much of the episode had contact, R-R data and a full-length record. */
  confidence: number;
}

export type HrrZone = 0 | 1 | 2 | 3 | 4 | 5;

export interface DayStrain {
  /** FRADY strain, 0..21. Null when no resting or maximum heart rate is available. */
  strain: number | null;
  /** Banister training impulse summed over contact minutes. */
  trimp: number | null;
  /** Minutes per heart-rate-reserve zone 1..5 (50..60%, 60..70%, 70..80%, 80..90%, 90..100%). */
  minutesByZone: [number, number, number, number, number];
  /** Contact minutes below 50% of heart-rate reserve. */
  restMinutes: number;
  avgHr: number | null;
  maxHr: number | null;
  /** Not derivable from heart rate alone without a calibrated model. */
  kcal: null;
  /** Resting heart rate the reserve was computed against, and where it came from. */
  rhrUsed: number | null;
  rhrSource: "night" | "profile" | "none";
  contactMinutes: number;
}

export interface DerivedWorkout {
  start: string;
  end: string;
  /** Local calendar day of the start. */
  day: string;
  durationMin: number;
  avgHr: number;
  maxHr: number;
  strain: number;
  trimp: number;
  /** Share of the workout's minutes in each heart-rate-reserve zone 1..5 (0..1 each). */
  zoneShares: [number, number, number, number, number];
}
