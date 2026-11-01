# Engine contract

Every engine is `(ctx: EngineContext) => Finding[]` (see `../types.ts`), pure and synchronous.

- Read history from `ctx.days` (ascending, calendar-filled, ends on `ctx.today`; unscored days have `scored: false`
  and null metrics). Use `series()` from `../baselines.ts` and the helpers in `../findings.ts`.
- Personal rules fire only when `ctx.baselines[metric].ready` is true. Fixed safety thresholds may fire earlier.
- Skip any finding whose `rule` is in `ctx.settings.disabled`.
- Rule keys are `engine.snake_case` and stable; they become event identities in the database.
- Every finding carries value, baseline, delta, method, completeness, explanation and nextStep. Use `fmtMetric()` for
  numbers in text. Wording is conservative: deviations and associations, never diagnoses. No em dashes.
- A finding's `day` is the day the evidence ends (usually the metric's last valid day).
- Severity: `severityFromZ()` for deviations; `info` for neutral status and positive trends.
- Correlation findings use `kind: "correlation"` and put n, r and the CI in `evidence`.
- Each engine exports `ENGINE_RULES: { rule: string; label: string; description: string }[]` listing every rule it can emit.
