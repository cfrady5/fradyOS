"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/finance/format";

export type LineSeries = { id: string; name: string; color: string; values: (number | null)[]; dashed?: boolean };

const PAD = { top: 14, right: 12, bottom: 26, left: 56 };
/** Axis and marker text: metadata colour, 11px, tabular. */
const AXIS_TEXT = { fill: "var(--text-3)", fontSize: 11, className: "nums" } as const;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const step = Math.max(1, Math.abs(min) / 2 || 1);
    return [min - step, min, min + step];
  }
  const span = max - min;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setW((prev) => (Math.abs(prev - width) > 0.5 ? width : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Legend swatch: a short solid line, or a dashed one for projected series. */
function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return <span aria-hidden className="inline-block w-4 shrink-0" style={dashed ? { height: 0, borderTop: `2px dashed ${color}` } : { height: 2, borderRadius: 1, backgroundColor: color }} />;
}

/**
 * Multi-series line chart: one y axis, recessive hairline grid, 2px lines, legend for ≥2 series
 * (projected series dashed), crosshair + tooltip on hover. Text stays in text tokens; colour
 * carries series identity only.
 */
export function LineChart({
  xLabels,
  series,
  height = 220,
  yFormat = (v) => fmtMoney(v, { compact: true }),
  markers = [],
  zeroLine = true,
  className,
  ariaLabel,
}: {
  xLabels: string[];
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  markers?: { index: number; label: string }[];
  zeroLine?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const n = xLabels.length;
  const W = Math.max(width, 240);
  const H = height;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  let min = Math.min(...all, zeroLine ? 0 : Infinity);
  let max = Math.max(...all, zeroLine ? 0 : -Infinity);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  const ticks = niceTicks(min, max);
  const yMin = Math.min(ticks[0], min);
  const yMax = Math.max(ticks[ticks.length - 1], max);
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const paths = series.map((s) => {
    let d = "";
    let open = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    return d;
  });

  const xTickCount = Math.max(2, Math.min(6, Math.floor(innerW / 90)));
  const xTicks = Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (n - 1))).filter((v, i, a) => a.indexOf(v) === i);

  function onMove(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const clientX = "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
    const px = clientX - rect.left - PAD.left;
    const idx = Math.round((px / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  }

  const hi = hover;
  const tipLeft = hi != null ? x(hi) : 0;
  const flip = hi != null && tipLeft > W * 0.6;

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      {series.length >= 2 ? (
        <ul className="text-text-2 mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <Swatch color={s.color} dashed={s.dashed} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <svg
        role="img"
        aria-label={ariaLabel ?? series.map((s) => s.name).join(", ")}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block overflow-visible select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchStart={onMove}
        onTouchMove={onMove}
        onTouchEnd={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 && zeroLine ? "var(--line-3)" : "var(--line-1)"} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" {...AXIS_TEXT}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} {...AXIS_TEXT}>
            {xLabels[i]}
          </text>
        ))}
        {markers.map((m) => (
          <g key={`${m.index}-${m.label}`}>
            <line x1={x(m.index)} x2={x(m.index)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-3)" strokeDasharray="3 3" />
            <text x={x(m.index) + 4} y={PAD.top + 10} {...AXIS_TEXT}>
              {m.label}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <path key={s.id} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 4" : undefined} />
        ))}
        {hi != null ? (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-3)" strokeWidth={1} />
            {series.map((s) => {
              const v = s.values[hi];
              if (v == null) return null;
              return <circle key={s.id} cx={x(hi)} cy={y(v)} r={5} fill={s.color} stroke="var(--surface-0)" strokeWidth={2} />;
            })}
          </g>
        ) : null}
      </svg>
      {hi != null ? (
        <div className="bg-surface-3 border-line-2 shadow-popover text-text-1 pointer-events-none absolute top-2 z-10 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap" style={flip ? { right: W - tipLeft + 8 } : { left: tipLeft + 8 }}>
          <div className="text-text-3 nums mb-0.5">{xLabels[hi]}</div>
          {series.map((s) => (
            <div key={s.id} className="nums flex items-center justify-between gap-3">
              <span className="text-text-2 flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </span>
              <span className="font-medium">{s.values[hi] == null ? "—" : yFormat(s.values[hi]!)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal stacked bar with 2px surface gaps and a legend carrying the values. */
export function StackedBar({ segments, total, className, ariaLabel }: { segments: { id: string; label: string; value: number; color: string }[]; total?: number; className?: string; ariaLabel?: string }) {
  const sum = total ?? segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div role="img" aria-label={ariaLabel} className="bg-surface-2 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {visible.map((s) => (
          <div key={s.id} className="h-full rounded-sm first:rounded-l-full last:rounded-r-full" style={{ width: `${sum > 0 ? (s.value / sum) * 100 : 0}%`, backgroundColor: s.color }} title={`${s.label}: ${fmtMoney(s.value)}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.id} className="nums flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-text-2">{s.label}</span>
            <span className="text-text-1 font-medium">{fmtMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Progress toward a target. The fill is translated rather than resized so only transform animates;
 * callers pair it with a status badge so the tone never carries the meaning alone.
 */
export function ProgressMeter({ value, target, tone = "good", className }: { value: number; target: number; tone?: "good" | "warning" | "serious" | "critical" | "neutral"; className?: string }) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  const color = tone === "neutral" ? "var(--chart-1)" : `var(--chart-${tone})`;
  return (
    <div className={cn("bg-surface-3 relative h-1.5 w-full overflow-hidden rounded-full", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full w-full rounded-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out" style={{ transform: `translateX(-${100 - pct}%)`, backgroundColor: color }} />
    </div>
  );
}
