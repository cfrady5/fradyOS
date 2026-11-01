"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bluetooth, BluetoothOff, Save, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RowList, SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { HealthRow } from "@/components/health/bits";
import { deleteLiveSession, saveLiveSession } from "@/actions/health";
import type { HealthLiveSessionRow } from "@/lib/data/health";
import { bluetoothSupport, connectStrap, type BluetoothSupport, type ConnectedStrap } from "@/lib/ble/transport";
import { hrZone, rmssd, sessionStats, type HeartRateMeasurement, type LiveSample } from "@/lib/ble/heartRate";
import { fmt0 } from "@/lib/health/stats";
import { formatTimestamp } from "@/lib/dates";

type Status = "idle" | "connecting" | "live" | "ended";

const CHART_WINDOW_SEC = 5 * 60;
const HRV_WINDOW_SEC = 60;
const ASSUMED_MAX_HR = 190;
// A strap sends a handful of R-R intervals a second; a throttled background tab can batch more, so keep the last few.
const MAX_RR_PER_SAMPLE = 32;

function fmtElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function zoneTone(bpm: number): "neutral" | "good" | "warning" | "serious" {
  const z = hrZone(bpm, ASSUMED_MAX_HR);
  if (z <= 1) return "neutral";
  if (z <= 3) return "good";
  if (z === 4) return "warning";
  return "serious";
}

/** Live heart rate from the strap over Bluetooth, with a save-to-history step at the end. */
export function LiveView({ sessions, notReady, timezone }: { sessions: HealthLiveSessionRow[]; notReady: boolean; timezone: string }) {
  const router = useRouter();
  const [support, setSupport] = React.useState<BluetoothSupport | "unknown">("unknown");
  const [status, setStatus] = React.useState<Status>("idle");
  const [device, setDevice] = React.useState<{ name: string; battery: number | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [latest, setLatest] = React.useState<HeartRateMeasurement | null>(null);
  const [samples, setSamples] = React.useState<LiveSample[]>([]);
  const [pending, startTransition] = React.useTransition();

  const strapRef = React.useRef<ConnectedStrap | null>(null);
  const startRef = React.useRef<{ ms: number; iso: string } | null>(null);
  const endRef = React.useRef<string | null>(null);
  const bufferRef = React.useRef<LiveSample[]>([]);

  // Feature detection has to wait for the browser; the server renders the neutral state.
  React.useEffect(() => {
    const id = window.setTimeout(() => setSupport(bluetoothSupport()), 0);
    return () => window.clearTimeout(id);
  }, []);

  React.useEffect(() => {
    return () => {
      void strapRef.current?.disconnect();
    };
  }, []);

  const connect = React.useCallback(() => {
    setError(null);
    setStatus("connecting");
    bufferRef.current = [];
    setSamples([]);
    setLatest(null);
    endRef.current = null;
    void (async () => {
      try {
        const strap = await connectStrap({
          onMeasurement: (m) => {
            const start = startRef.current;
            if (!start) return;
            const offset = Math.round((Date.now() - start.ms) / 1000);
            const buf = bufferRef.current;
            const last = buf[buf.length - 1];
            if (last && last[0] === offset) {
              // Several notifications in one second: keep the latest bpm, keep every R-R interval.
              last[1] = m.bpm;
              if (m.rr.length) last[2] = [...(last[2] ?? []), ...m.rr].slice(-MAX_RR_PER_SAMPLE);
            } else {
              buf.push(m.rr.length ? [offset, m.bpm, m.rr.slice(-MAX_RR_PER_SAMPLE)] : [offset, m.bpm]);
            }
            setLatest(m);
            setSamples(buf.slice());
          },
          onDisconnect: () => {
            endRef.current = new Date().toISOString();
            strapRef.current = null;
            setStatus((s) => (s === "live" ? "ended" : s));
            toast.message("Strap disconnected.");
          },
        });
        strapRef.current = strap;
        startRef.current = { ms: Date.now(), iso: new Date().toISOString() };
        setDevice({ name: strap.name, battery: strap.battery });
        setStatus("live");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(/cancel/i.test(msg) ? null : msg);
        setStatus("idle");
      }
    })();
  }, []);

  const end = React.useCallback(() => {
    endRef.current = new Date().toISOString();
    const strap = strapRef.current;
    strapRef.current = null;
    void strap?.disconnect();
    setStatus("ended");
  }, []);

  const discard = React.useCallback(() => {
    bufferRef.current = [];
    setSamples([]);
    setLatest(null);
    setDevice(null);
    setStatus("idle");
  }, []);

  const save = React.useCallback(() => {
    const start = startRef.current;
    if (!start || !bufferRef.current.length) return;
    startTransition(async () => {
      const res = await saveLiveSession({
        startAt: start.iso,
        endAt: endRef.current ?? new Date().toISOString(),
        deviceName: device?.name ?? null,
        samples: bufferRef.current,
      });
      if (res.ok) {
        toast.success("Session saved.");
        discard();
        router.refresh();
      } else toast.error(res.error);
    });
  }, [device?.name, discard, router]);

  const remove = React.useCallback(
    (id: string) => {
      if (!window.confirm("Delete this session?")) return;
      startTransition(async () => {
        const res = await deleteLiveSession(id);
        if (res.ok) router.refresh();
        else toast.error(res.error);
      });
    },
    [router],
  );

  const stats = React.useMemo(() => sessionStats(samples), [samples]);
  const elapsed = samples.length ? samples[samples.length - 1][0] : 0;
  const liveHrv = React.useMemo(() => {
    const cutoff = elapsed - HRV_WINDOW_SEC;
    return rmssd(samples.filter((s) => s[0] >= cutoff).flatMap((s) => s[2] ?? []));
  }, [samples, elapsed]);
  const bpm = latest?.bpm ?? 0;

  return (
    <div className="space-y-8">
      <section aria-labelledby="live-now">
        <SectionHeader title={<span id="live-now">Now</span>} hint={device ? `${device.name}${device.battery != null ? ` · ${device.battery}% battery` : ""}` : undefined} />

        {support === "none" ? (
          <EmptyState
            className="mt-3"
            icon={<BluetoothOff />}
            title="Bluetooth is not available here"
            description="Live needs Chrome on Android or desktop (Web Bluetooth), or the FRADY app on iPhone and Android. Safari and Firefox cannot talk to the strap."
          />
        ) : (
          <div className="border-line-1 bg-surface-1 mt-3 rounded-lg border p-4 md:p-5">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-text-3 text-meta">Heart rate</p>
                <p className={`nums mt-1 text-6xl font-semibold tracking-tight ${status === "live" && bpm > 0 ? "text-text-1" : "text-text-3"}`} aria-live="polite">
                  {status === "live" && bpm > 0 ? bpm : status === "live" ? "…" : "--"}
                  <span className="text-text-3 ml-2 text-base font-normal">bpm</span>
                </p>
                <p className="text-text-3 text-meta mt-1">
                  {status === "idle" && "Not connected."}
                  {status === "connecting" && "Choose your strap in the picker."}
                  {status === "live" && (latest?.contact === false ? "No skin contact." : `Live for ${fmtElapsed(elapsed)}`)}
                  {status === "ended" && `Ended after ${fmtElapsed(elapsed)}. Save it to history or discard.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {status === "idle" || status === "connecting" ? (
                  <Button onClick={connect} disabled={status === "connecting" || support === "unknown"}>
                    <Bluetooth /> {status === "connecting" ? "Connecting…" : "Connect strap"}
                  </Button>
                ) : null}
                {status === "live" ? (
                  <Button variant="outline" onClick={end}>
                    <Square /> End session
                  </Button>
                ) : null}
                {status === "ended" ? (
                  <>
                    <Button onClick={save} disabled={pending || !samples.length || notReady}>
                      <Save /> Save session
                    </Button>
                    <Button variant="ghost" onClick={discard} disabled={pending}>
                      Discard
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {error ? <p className="text-serious mt-3 text-sm">{error}</p> : null}

            {samples.length ? (
              <>
                <LiveChart samples={samples} />
                <MetricStrip cols={2} className="mt-4 md:grid-cols-4">
                  <Metric size="sm" label="HRV (last minute)" value={fmt0(liveHrv, " ms")} sub="RMSSD" muted={liveHrv == null} />
                  <Metric size="sm" label="Average" value={fmt0(stats.avgHr, " bpm")} muted={stats.avgHr == null} />
                  <Metric size="sm" label="Max" value={fmt0(stats.maxHr, " bpm")} tone={stats.maxHr != null ? zoneTone(stats.maxHr) : "neutral"} muted={stats.maxHr == null} />
                  <Metric size="sm" label="Readings" value={String(stats.sampleCount)} sub={`${latest?.rr.length ? "with" : "no"} R-R intervals`} />
                </MetricStrip>
              </>
            ) : null}

            {status === "idle" ? (
              <p className="text-text-3 mt-4 text-sm">
                The strap streams the standard Bluetooth heart-rate profile, so it keeps its pairing with the WHOOP app. If it does not show up in the picker, turn on Broadcast Heart Rate in the WHOOP app and make sure the strap is awake on your wrist.
                {notReady ? " Saving sessions needs migration 0012 applied first." : ""}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="live-history">
        <SectionHeader title={<span id="live-history">Sessions</span>} count={sessions.length} />
        {sessions.length ? (
          <RowList className="mt-3">
            {sessions.map((s) => {
              const mins = Math.max(1, Math.round((Date.parse(s.end_at) - Date.parse(s.start_at)) / 60_000));
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <HealthRow
                      title={formatTimestamp(s.start_at, timezone)}
                      meta={`${mins} min${s.device_name ? ` · ${s.device_name}` : ""}`}
                      value={fmt0(s.avg_hr, " bpm avg")}
                      sub={`${fmt0(s.max_hr, " max")}${s.rmssd_ms != null ? ` · HRV ${fmt0(s.rmssd_ms, " ms")}` : ""}`}
                    />
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Delete session" onClick={() => remove(s.id)} disabled={pending}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </RowList>
        ) : (
          <EmptyState className="mt-3" title="No saved sessions" description="End a live session and save it to keep the trace here." />
        )}
      </section>
    </div>
  );
}

/** Last five minutes of bpm as a thin line; a dependency-free SVG so it redraws cheaply every second. */
function LiveChart({ samples }: { samples: LiveSample[] }) {
  const last = samples[samples.length - 1][0];
  const from = Math.max(0, last - CHART_WINDOW_SEC);
  const span = Math.max(60, last - from);
  const visible = samples.filter((s) => s[0] >= from && s[1] > 0);
  const W = 600;
  const H = 120;
  const lo = 40;
  const hi = Math.max(160, ...visible.map((s) => s[1])) + 10;
  const x = (t: number) => ((t - from) / span) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = visible.map((s, i) => `${i ? "L" : "M"}${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-28 w-full" preserveAspectRatio="none" role="img" aria-label="Heart rate over the last five minutes">
      {[60, 100, 140].map((g) => (
        <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="stroke-line-1" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={path} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
