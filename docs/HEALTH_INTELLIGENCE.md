# FRADY Health Intelligence

An analytics and detection layer over the biometric data FRADY OS already holds. It never replaces the
strap's sensors or scores; it turns imported measurements into personal baselines, derived scores,
detections, trends, correlations and plainly worded recommendations. Nothing here is a diagnosis.

## Phase 1 audit (1 November 2026)

**What existed before this work**

| Area | State |
| --- | --- |
| WHOOP OAuth / developer API | **Not present.** There was no WHOOP client, token store, sync job or webhook anywhere in the repo. |
| WHOOP data | Imported from the WHOOP data export zip or NOOP's CSV export (`src/lib/health/whoopImport.ts`) into `health_days`, `health_sleeps`, `health_workouts`, `health_journal`, `health_imports` (migration 0011). Upserts keyed by day or session start. |
| Live strap data | Health, Live reads heart rate and R-R intervals over the standard Bluetooth heart-rate profile (web and native) into `health_live_sessions` (migration 0012). This is the only beat-level source; it is a session you start by hand, not a continuous feed. |
| Fields stored per day | recovery, day strain, resting HR, HRV (RMSSD), SpO2, skin temperature, respiratory rate, energy, max and average HR, sleep performance, total sleep, time in bed, light, deep, REM, awake, efficiency, consistency, sleep need, sleep debt. Per sleep: timestamps, nap flag, stages, efficiency, consistency, need, debt. Per workout: timestamps, activity, strain, energy, max and average HR, zone shares, distance. |
| Fields not available from any current source | steps, sleep-cycle count, disturbance count, sleep-need components, body measurements, recovery score state. The WHOOP export does not carry them. The developer API carries cycle, recovery, sleep (with cycle and disturbance counts and need components), workout and body measurement records; it does not expose steps or beat-level data. |
| Visualisations | Health Overview (metric strip, recovery and HRV charts), Workouts, Data; Today's Body block. Hand-rolled SVG charts in `src/components/finance/charts.tsx`. |
| Other health integrations | None (no Apple Health, nutrition, scale). |
| Jobs and webhooks | Vercel cron routes guarded by `CRON_SECRET` (`src/lib/cron-auth.ts`); Plaid and Monday webhooks with signature verification; `after()` for background work; notifications table with `dedupe_key` upserts. |
| Secrets at rest | AES-256-GCM helper in `src/lib/plaid/crypto.ts`, key from env or derived from `CRON_SECRET`. Reused for WHOOP tokens. |

**Consequences for the build**

- The "already connected WHOOP 5.0" in the brief does not exist as an API connection. The detection layer is built over a unified daily model that any source can fill, so it works today on export data and picks up API records as soon as a WHOOP developer app is connected (see "WHOOP API" below).
- Steps, inactivity windows and minute-level movement are not implemented as detections because no connected source provides them. The source-capability registry records that honestly and the dashboard shows "no source" rather than a zero.
- Live heart rate is a manual Bluetooth session, so no score is labelled live.

## Architecture

```
WHOOP export / NOOP CSV ─┐
WHOOP developer API ─────┼─> normalise (src/lib/intel/summaries.ts) ─> biometric_daily_summaries + biometric_measurements
Live Bluetooth sessions ─┘                      │
                                                 ▼
                       baselines (stats.ts) ─> engines (engines/*.ts) ─> detected events, derived scores,
                                                 correlations, insights ─> notifications ─> dashboard
```

Everything from normalisation onward is pure TypeScript with unit tests. `src/lib/intel/pipeline.ts` does the
database reads and writes and is triggered after an import, after a WHOOP sync or webhook, by the daily
cron and by the Recompute button.

## Data model

See `supabase/migrations/0013_biometrics.sql`. Every table is owner-only under RLS.

| Table | Holds |
| --- | --- |
| `biometric_measurements` | One row per metric per day per provider: value, unit, period, source field, availability, quality, sync time, algorithm version. |
| `biometric_daily_summaries` | The unified day with every metric nullable, provider, completeness, scored flag. |
| `biometric_baselines` | Rolling means (7/14/30/60), 90-day median, SD, MAD, quartiles, percentile, slopes, EWMA, rate of change, sample count, version. One row per metric per day so past interpretations stay reproducible. |
| `biometric_detected_events` | Findings with value, baseline, delta, method, severity, completeness, explanation, next step, evidence, lifecycle (open, resolved, dismissed). |
| `biometric_derived_metrics` | Sleep Quality Index, Readiness, Physiological Load, Health Trend with factor breakdowns and formula versions. |
| `biometric_correlations` | Metric-to-metric and behaviour-to-metric relationships with n, r, CI, method, period. |
| `biometric_insights` | Ranked, worded insights with evidence and confidence. |
| `biometric_detection_rules` | Per-user rule enablement and thresholds. |
| `biometric_notification_preferences` | In-app and email choices, minimum severity. |
| `biometric_processing_jobs` | Pipeline runs with window, status, stats, errors, attempts. |
| `biometric_source_capabilities` | Which provider exposes which metric (seeded). |
| `health_behaviors` | Manually logged habits (caffeine, alcohol, water, meals, calories, protein, exercise timing, bedtime routine, supplements, stress, travel, illness, medication). Medication rows carry a private flag and never appear in insights text. |
| `whoop_connections`, `whoop_records` | OAuth tokens (encrypted) and raw API records for auditability. |

## Scores

Each score lives next to its engine: `readinessScore` in `engines/recovery.ts`, `sleepQualityIndex` in `engines/sleep.ts`, `physiologicalLoad` in `engines/load.ts`, `healthTrend` in `engines/longterm.ts`, each with tests in `src/lib/intel/__tests__/`.

- **Sleep Quality Index** (0..100): sufficiency 35, efficiency 20, consistency 15, restorative share 20, disturbances 10. Sufficiency is sleep against need when need is known, otherwise against the personal 30-day median.
- **Readiness** (0..100): HRV versus baseline 30, resting HR versus baseline 25, sleep sufficiency 20, recent strain 15, recent recovery history 10. Not WHOOP's recovery; a transparent factor list explains every change.
- **Physiological Load** (0..100, higher is more loaded): HRV deviation 30, RHR deviation 25, sleep deficiency 20, recent strain 15, recovery trend 10. Daily, never live, and not WHOOP's Stress Monitor.
- **Health Trend** (experimental, labelled as such): 90-day direction of RHR, HRV, sleep consistency, sleep efficiency, recovery consistency and activity consistency. It is a direction summary, not a biological age.

## Baselines

Per metric and day: last value, 7/14/30/60-day means, 90-day median, SD, MAD, quartiles, percentile rank,
30- and 90-day slopes, EWMA (alpha 0.2), 7-vs-30 rate of change. Personal alerts wait for the metric's
minimum sample count (14 recovery days for cardio, 7 for sleep and activity). Baselines use the 90-day
median and MAD, so one bad night does not move them, and a persistent shift takes weeks to become the
new normal.

## Anomaly methods

Robust z (MAD units), persistent deviation (consecutive days past a personal threshold), EWMA drift,
CUSUM change points, and multi-metric clustering (two or more core metrics deviating the same day).
Safety thresholds that do not depend on the person: SpO2 below 90%, resting HR above 100 or below 40
when not an athlete baseline, respiratory rate above 24 or below 8. These are flagged as "check with a
clinician if this persists", never as a diagnosis.

## WHOOP API

Set `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` from a developer app at developer.whoop.com with the
redirect `https://<site>/api/whoop/callback`, then connect from Health, Data. The sync backfills cycles,
recovery, sleep, workouts and body measurements with pagination, stores the raw records, refreshes tokens
before expiry and respects the documented rate limits. Webhooks post to `/api/webhooks/whoop` and are
verified with the signature headers before any record is fetched; each event re-fetches the one record
it names, so a webhook is a notification, not a data stream.

## What this layer does not do

- No disease, arrhythmia, apnoea or infection classification.
- No invented beat-level or minute-level data; the strap's summaries are the input.
- No biological-age claim.
- Correlations are reported with sample size, period and uncertainty, and worded as associations.
