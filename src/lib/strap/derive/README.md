# Strap signal derivation

Turns minute-level strap samples (heart rate, R-R intervals, motion, raw sensor channels) into the
`DailySummary` fields the health intelligence engines in `src/lib/intel` consume. Pure TypeScript, no
I/O, deterministic for a given input.

Everything in this folder is an **estimate** computed from a wrist sensor. It is not EEG, not
polysomnography, not a pulse oximeter and not a medical device. None of the outputs have been
validated against polysomnography, against a clinical respiratory or SpO2 reference, or against
WHOOP's own numbers. Where a published method exists (Banister TRIMP, RMSSD, actigraphy sleep
detection, respiratory sinus arrhythmia) it is implemented from the published description; nothing
was copied from any companion app.

## Files

| File | Public API | What it does |
| --- | --- | --- |
| `types.ts` | `StrapRecord`, `StrapMinute`, `StrapProfile`, `SleepEpisode`, `DayStrain`, `DerivedWorkout` | Shapes shared across the layer. |
| `time.ts` | `localClock`, `minutesFromNoon`, `addDays`, `dayRange`, `hasContact`, `normaliseMinutes` | Minute arithmetic and local-clock helpers (Intl, timezone-aware). |
| `aggregate.ts` | `aggregateMinutes(records)`, `mergeMinutes(existing, incoming)` | Raw records to one `StrapMinute` per UTC minute. |
| `sleep.ts` | `detectSleep(minutes, profile, { dayStartHour })`, `METHOD_NOTE`, `SLEEP_PARAMS` | Rest detection, main sleep / nap selection, 4-stage estimates. |
| `cardio.ts` | `restingHr`, `overnightHrv`, `respiratoryRate`, `spo2Estimate`, `skinTempEstimate`, `dominantBreathingFrequency` | Overnight resting HR, HRV, breathing rate; explicit nulls for uncalibrated channels. |
| `strain.ts` | `dayStrain`, `detectWorkouts`, `trimpWeight`, `strainFromTrimp`, `hrrFraction`, `hrrZone` | FRADY strain (TRIMP mapped to 0..21) and workout detection. |
| `daily.ts` | `deriveDays(minutes, profile, { from, to })` | One `Partial<DailySummary>` per wake day, provider `"ble"`, plus episodes, workouts, notes and coverage. |

Row conventions follow `src/lib/intel/types.ts`: sleep fields on row *t* describe the night that
ended the morning of *t*; strain, workouts and naps on row *t* are that local calendar day.

## Input model

`StrapMinute` holds, per UTC minute: `hrAvg/hrMin/hrMax` (bpm), `rr` (R-R ms, oldest first, at most
200), `motion` (mean magnitude of the change in the gravity vector per second, in g; 0 when still),
`skinContact` (0..1 share of samples with contact), raw uncalibrated `rawSkinTemp`, `rawSpo2
{red, ir}`, `rawResp`, and `samples`. `StrapProfile` carries the IANA `timezone`, a `maxHr` (user-set
or 220 minus age) and an optional `restingHrHint`.

A minute "has contact" when it has a positive `hrAvg` and, if the device reports contact, at least
half its samples were on skin.

## aggregate.ts

- Records are grouped by `floor(unix / 60)`; `unix` is in **seconds**.
- Heart rate ignores `0`/null readings and samples flagged `skinContact: false`.
- Motion is the mean over successive gravity samples of `|g_i - g_(i-1)| / dt` with `dt <= 5 s`. The
  previous minute's last gravity sample seeds the first difference, so a one-sample-per-minute feed
  still yields a value from the second minute on. A single sample with no predecessor gives `null`.
- R-R intervals are concatenated oldest first, zero placeholders dropped, capped at 200 per minute.
- Raw channels are averaged as plain numbers and stay uncalibrated.
- `mergeMinutes` keys by minute; when both sides hold a minute, the row with more samples wins and
  ties go to the incoming row (a fuller offload replaces a thin live capture).

## sleep.ts

**Method (actigraphy plus heart rate):**

1. Minutes are grouped into noon-to-noon sleep windows (`dayStartHour`, default 12) in the profile
   timezone so a night never straddles two groups.
2. Per window, a low-motion threshold is learned from the motion distribution: `4 x` the 20th
   percentile (the still floor), kept within `0.01..0.08 g/s`. The heart-rate reference is the
   window's median over contact minutes. A minute is restful when it has contact, motion below the
   threshold and heart rate at or below `1.05 x` the median.
3. Restful runs of at least 3 minutes are seeds; seeds separated by gaps of up to 20 minutes (restless
   minutes or missing data) are bridged into one candidate.
4. **Main sleep** is the longest candidate in the window that overlaps 20:00..12:00 local and lasts
   at least 3 h. **Naps** are other candidates of at least 20 minutes whose midpoint falls between
   12:00 and 20:00. Other night candidates of at least 60 minutes are kept as `kind: "fragment"` so a
   split night is visible in notes; they are not counted in the day's sleep totals.
5. Stages are estimated per 5-minute window inside an episode, relative to that episode's own
   distributions: *awake* when motion is high (3 of 5 minutes above the threshold or the window
   median above it); *deep* when mean HR is in the lowest quartile, motion is near zero and the
   coefficient of variation of the per-minute RMSSD values is in the low part of the night's range;
   *rem* when motion is near zero, HR is above the median and RMSSD variability is in the high part
   (HR above the 75th percentile when no R-R data exist); *light* otherwise. REM inside the first 40
   minutes is demoted to light, then a 3-window majority filter smooths light/deep/rem. Awake windows
   are not smoothed away.
6. `efficiency = asleep / in bed`, `disturbances` = awake bouts of at least 2 minutes, `onsetMin` and
   `wakeMin` are minutes since the previous local noon, `confidence` blends contact coverage (0.6),
   R-R availability (0.3) and episode length (0.1), halved when the window had no motion data.

**Assumptions and limits**

- The heart-rate test is only applied when the window holds at least 12 h of contact. A night-only
  wearer's median is a sleeping value and would reject half the night.
- Without any motion data a window falls back to a heart-rate-only rule (at or below `0.92 x` the
  median) with reduced confidence. This is a degraded mode, not a validated one.
- Light versus deep is the least reliable split. Onset, wake and total sleep are the most reliable.
- A long still, low-HR period that is not sleep (meditation, lying awake, a film) will be called
  rest. There is no posture or step signal to separate them.
- Two blocks of sleep more than 20 minutes apart are not one night; the shorter becomes a fragment.
- `sleep_cycles`, `sleep_need_min`, `sleep_debt_min` and `sleep_performance` are not derived.
- `sleep_consistency` is `100 - min(100, |onset - trailing 7-day median onset| / 1.2)`, reported only
  once at least 4 of the trailing 7 days have an onset.
- `METHOD_NOTE` states that stages are estimates, not EEG. Surface it wherever stages are shown.

## cardio.ts

- **Resting HR**: mean of the lowest contiguous 5-minute HR window over asleep (non-awake) minutes
  of the main sleep. Null when the episode has fewer than 60 asleep minutes. Rounded to a whole bpm.
- **Overnight HRV**: median of 5-minute RMSSD values (`rmssd()` from `src/lib/ble/heartRate.ts`,
  which drops intervals outside 300..2000 ms and jumps over 20%) over windows holding at least 100
  intervals in the last 3 hours of the episode, skipping windows that are mostly awake. Null with
  fewer than 3 qualifying windows. Restricting to the same part of the night keeps nights comparable.
  It is RMSSD during sleep, like WHOOP's HRV, but computed over a different window and not expected
  to match WHOOP's number.
- **Respiratory rate**: respiratory sinus arrhythmia. For each 5-minute window with at least 150
  intervals the R-R series is resampled to 4 Hz by linear interpolation, a 10 s moving average is
  removed, and the dominant frequency in 0.1..0.5 Hz (6..30 breaths/min) is found with a direct
  Fourier transform under a Hann window at 0.005 Hz steps. The night value is the median over windows;
  null with fewer than 6 windows. Assumes RSA is present and dominant in the band; it is weaker in
  older people, at high resting rates and under some medications, and a 0.1..0.5 Hz band cannot
  resolve rates outside 6..30 breaths/min.
- **SpO2** and **skin temperature** always return `{ value: null, reason }`. The red/IR and thermal
  channels are raw counts without a per-device calibration; no ratio-of-ratios or ADC-to-degrees
  transfer is invented.

## strain.ts

Per contact minute, with `f = clip((hr - rhr) / (maxHr - rhr), 0, 1)` the Banister training impulse
weight is `f * 0.64 * exp(1.92 * f)`. The `0.64` and `1.92` constants are Banister's **male** fit of
blood lactate against %HRR (the female fit is `0.86` and `1.67`); they are used for everyone because
the profile carries no sex, which slightly overweights hard minutes for some users. TRIMP is summed
over contact minutes and mapped to **FRADY strain** on 0..21 with `21 * (1 - exp(-trimp / 180))`:
a 60-minute hard session on top of an ordinary day lands around 15 and a very long hard day
approaches 18..19. The no-workout baseline depends strongly on how far daytime heart rate sits
above resting: with a resting rate near 50 and a sitting rate near 60 a quiet day scores about 7,
with a sitting rate near 72 it scores 10..13. This is not WHOOP's Strain even though the range is the
same, and `K = 180` has not been fitted against any reference data.

Zones are heart-rate-reserve bands 1..5 at 50/60/70/80/90%; minutes under 50% are `restMinutes`.
`kcal` is always null: energy needs a calibrated model, not heart rate alone.

Resting HR comes from the night that ended that morning, else the most recent earlier night in the
range, else `profile.restingHrHint`; without one or without `maxHr`, strain is null and the source is
reported as `rhrSource: "none"`.

**Workouts** are runs of at least 10 minutes at or above 60% HRR, tolerating dips of up to 3
consecutive minutes, merged when 5 minutes apart or less. Each carries start, end, duration, average
and maximum HR, FRADY strain over the run and zone shares. A fast walk, a hot shower or a stressful
meeting can meet the threshold; this is heart-rate effort, not activity recognition.

## daily.ts

`deriveDays` runs sleep detection over the whole series, then for each wake day in `[from, to]`
that has any data assembles one `Partial<DailySummary>` with provider `"ble"`: sleep fields from the
main episode of that wake day, resting HR / HRV / respiratory rate from it, strain, avg/max HR and
workouts from the local calendar day, naps from the calendar day. `recovery_score` is null (FRADY's
Readiness covers it), as are `spo2`, `skin_temp`, `energy_kcal`, `steps` and the sleep need fields.
Days with fewer than 300 minutes of contact are `scored: false`. `coverage[day]` is the share of the
day with contact; `notes` carry the method statements and one line per day. Days with no data at
all produce no row.

## Not validated

No output here has been compared against polysomnography, a clinical respiratory reference, a pulse
oximeter or WHOOP's own metrics. Treat stages, respiratory rate and strain as estimates whose value
is in night-to-night and day-to-day comparison for the same person, not in absolute accuracy.
