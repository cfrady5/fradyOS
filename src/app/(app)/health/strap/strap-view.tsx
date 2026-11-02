"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bluetooth, BluetoothOff, Link2, Square, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { HealthRow } from "@/components/health/bits";
import { clearStrapData, deriveStrapRecent, finishStrapOffload, ingestStrapMinutes, rederiveStrap, registerStrapDevice, setStrapMaxHr, startStrapOffload } from "@/actions/strap";
import type { StrapData } from "@/lib/data/strap";
import { runLiveLink, runOffload, strapSupport, type OffloadProgress, type StrapModel, type StrapSupport } from "@/lib/strap/transport";
import { formatDate, formatTimestamp } from "@/lib/dates";

type Status = "idle" | "connecting" | "bonding" | "handshake" | "offloading" | "finishing" | "done" | "error" | "linked" | "reconnecting";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Not connected.",
  connecting: "Choose your strap in the picker.",
  bonding: "Bonding with the strap.",
  handshake: "Setting the clock and reading device info.",
  offloading: "Reading the strap's history.",
  finishing: "Deriving sleep, heart and strain from the samples.",
  done: "Offload complete.",
  error: "Stopped.",
  linked: "Connected. Streaming heart rate; the recorder is pulled every 15 minutes.",
  reconnecting: "Strap out of range. Reconnecting when it is back.",
};

const PREF_AUTOLINK = "strap:autolink";
const PREF_DEVICE = "strap:deviceId";
const PREF_MODEL = "strap:model";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the link still works for this session.
  }
}

/** Pair the strap, offload its stored history, and see what has been collected. */
export function StrapView({ data, today }: { data: StrapData; today: string }) {
  const router = useRouter();
  const [support, setSupport] = React.useState<StrapSupport | "unknown">("unknown");
  const [status, setStatus] = React.useState<Status>("idle");
  const [model, setModel] = React.useState<StrapModel>((data.devices[0]?.model as StrapModel) ?? "auto");
  const [log, setLog] = React.useState<string[]>([]);
  const [progress, setProgress] = React.useState<OffloadProgress>({ records: 0, chunks: 0, minutes: 0 });
  const [maxHr, setMaxHr] = React.useState<string>(data.devices[0]?.max_hr ? String(data.devices[0].max_hr) : "");
  const [pending, startTransition] = React.useTransition();
  const [bpm, setBpm] = React.useState<number | null>(null);
  const [cycles, setCycles] = React.useState(0);
  const [lastCycleAt, setLastCycleAt] = React.useState<string | null>(null);
  const [autolink, setAutolink] = React.useState(false);
  const [liveMode, setLiveMode] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const logRef = React.useRef<string[]>([]);
  const liveRef = React.useRef(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setSupport(strapSupport());
      setAutolink(readPref(PREF_AUTOLINK) === "1");
      const savedModel = readPref(PREF_MODEL);
      if (savedModel === "whoop4" || savedModel === "whoop5" || savedModel === "auto") setModel(savedModel);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const append = React.useCallback((line: string) => {
    logRef.current = [...logRef.current.slice(-199), `${new Date().toLocaleTimeString()} ${line}`];
    setLog(logRef.current);
  }, []);

  const start = React.useCallback(() => {
    logRef.current = [];
    setLog([]);
    setProgress({ records: 0, chunks: 0, minutes: 0 });
    setStatus("connecting");
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      const platform = support === "native" ? ((navigator.userAgent.includes("Android") ? "android" : "ios") as "ios" | "android") : "web";
      let offloadId: string | null = null;
      let serial: string | null = null;
      let battery: number | null = null;
      let firmware: string | null = null;
      let records = 0;
      let chunks = 0;
      const started = await startStrapOffload({ serial: null, platform });
      if (!started.ok) {
        toast.error(started.error);
        setStatus("error");
        return;
      }
      offloadId = started.data.id;
      try {
        await runOffload({
          model,
          signal: controller.signal,
          callbacks: {
            onLog: (line, level) => append(level === "debug" ? line : `[${level}] ${line}`),
            onState: (s) => setStatus(s === "bonding" ? "bonding" : s === "handshake" ? "handshake" : s === "offloading" ? "offloading" : s === "connected" ? "bonding" : status),
            onDevice: (info) => {
              serial = info.serial ?? serial;
              battery = info.battery ?? battery;
              firmware = info.firmware ?? firmware;
              if (info.serial) void registerStrapDevice({ serial: info.serial, name: info.name ?? null, model, firmware: info.firmware ?? null, batteryPct: info.battery ?? null, maxHr: maxHr ? Number(maxHr) : null });
            },
            onProgress: (p) => {
              records = p.records;
              chunks = p.chunks;
              setProgress(p);
            },
            onMinutes: async (minutes) => {
              const res = await ingestStrapMinutes({ offloadId: offloadId!, minutes, records, chunks });
              if (!res.ok) throw new Error(res.error);
            },
          },
        });
        setStatus("finishing");
        const fin = await finishStrapOffload({ offloadId, status: "succeeded", serial, batteryPct: battery, firmware, log: logRef.current.slice(-120) });
        if (fin.ok) {
          toast.success(`Offload done: ${fin.data.days} days, ${fin.data.sleeps} sleeps, ${fin.data.workouts} workouts derived.`);
          setStatus("done");
        } else {
          toast.error(fin.error);
          setStatus("error");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const aborted = controller.signal.aborted;
        append(aborted ? "Aborted." : `Error: ${message}`);
        await finishStrapOffload({ offloadId, status: aborted ? "aborted" : "failed", error: aborted ? null : message, serial, batteryPct: battery, firmware, log: logRef.current.slice(-120) });
        if (!aborted && !/cancel/i.test(message)) toast.error(message);
        setStatus(aborted ? "idle" : "error");
      }
      router.refresh();
    })();
  }, [append, maxHr, model, router, status, support]);


  /** Always-on mode: live heart rate plus a recorder pull every 15 minutes, with automatic reconnects. */
  const startLive = React.useCallback(
    (silent = false) => {
      if (liveRef.current) return;
      liveRef.current = true;
      setLiveMode(true);
      logRef.current = [];
      setLog([]);
      setProgress({ records: 0, chunks: 0, minutes: 0 });
      setBpm(null);
      setCycles(0);
      setStatus("connecting");
      writePref(PREF_AUTOLINK, "1");
      writePref(PREF_MODEL, model);
      setAutolink(true);
      const controller = new AbortController();
      abortRef.current = controller;
      void (async () => {
        const platform = support === "native" ? ((navigator.userAgent.includes("Android") ? "android" : "ios") as "ios" | "android") : "web";
        const started = await startStrapOffload({ serial: null, platform, mode: "link" });
        const offloadId = started.ok ? started.data.id : null;
        let serial: string | null = null;
        let battery: number | null = null;
        let firmware: string | null = null;
        let records = 0;
        let chunks = 0;
        let pullCount = 0;
        try {
          await runLiveLink({
            model,
            signal: controller.signal,
            intervalMin: 15,
            knownDeviceId: silent ? readPref(PREF_DEVICE) : null,
            callbacks: {
              onLog: (line, level) => append(level === "debug" ? line : `[${level}] ${line}`),
              onState: (st) => setStatus(st === "linked" ? "linked" : st === "reconnecting" ? "reconnecting" : st === "offloading" ? "offloading" : st === "handshake" ? "handshake" : st === "bonding" ? "bonding" : st === "idle" ? "idle" : "connecting"),
              onDevice: (info) => {
                serial = info.serial ?? serial;
                battery = info.battery ?? battery;
                firmware = info.firmware ?? firmware;
                if (info.deviceId) writePref(PREF_DEVICE, info.deviceId);
                if (info.serial) void registerStrapDevice({ serial: info.serial, name: info.name ?? null, model, firmware: info.firmware ?? null, batteryPct: info.battery ?? null, maxHr: maxHr ? Number(maxHr) : null });
              },
              onProgress: (p) => {
                records = p.records;
                chunks = p.chunks;
                setProgress(p);
              },
              onMinutes: async (minutes) => {
                const res = await ingestStrapMinutes({ offloadId, minutes, records, chunks });
                if (!res.ok) throw new Error(res.error);
              },
              onHeartRate: (value) => setBpm(value),
              onCycle: ({ since }) => {
                pullCount++;
                setCycles(pullCount);
                setLastCycleAt(new Date().toISOString());
                void deriveStrapRecent({ sinceIso: since }).then((res) => {
                  if (res.ok) router.refresh();
                  else append(`[warn] derive failed: ${res.error}`);
                });
              },
            },
          });
          if (offloadId) await finishStrapOffload({ offloadId, status: "aborted", serial, batteryPct: battery, firmware, log: logRef.current.slice(-120) });
          setStatus("idle");
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          append(`[error] ${message}`);
          if (offloadId) await finishStrapOffload({ offloadId, status: "failed", error: message, serial, batteryPct: battery, firmware, log: logRef.current.slice(-120) });
          if (!/cancel/i.test(message)) toast.error(message);
          setStatus("error");
        } finally {
          liveRef.current = false;
          setLiveMode(false);
          setBpm(null);
        }
        router.refresh();
      })();
    },
    [append, maxHr, model, router, support],
  );

  function stopLive() {
    writePref(PREF_AUTOLINK, "0");
    setAutolink(false);
    abortRef.current?.abort();
  }

  // The app re-links on open when the user left the link on last time (native only: the picker needs a tap on the web).
  React.useEffect(() => {
    if (support !== "native" || !autolink || liveRef.current || !readPref(PREF_DEVICE)) return;
    const id = window.setTimeout(() => startLive(true), 400);
    return () => window.clearTimeout(id);
  }, [autolink, startLive, support]);

  const live = liveMode && status !== "idle" && status !== "error";
  const busy = status === "connecting" || status === "bonding" || status === "handshake" || status === "offloading" || status === "finishing";
  const device = data.devices[0];

  function saveMaxHr() {
    if (!device) return;
    startTransition(async () => {
      const v = maxHr.trim() ? Number(maxHr) : null;
      const res = await setStrapMaxHr(device.serial, v);
      if (res.ok) {
        toast.success("Saved. Re-derive to apply it to stored days.");
        router.refresh();
      } else toast.error(res.error);
    });
  }
  function rederive() {
    startTransition(async () => {
      const res = await rederiveStrap();
      if (res.ok) {
        toast.success(`Re-derived ${res.data.days} days.`);
        router.refresh();
      } else toast.error(res.error);
    });
  }
  function clearAll() {
    if (!window.confirm("Delete every stored strap minute and the days derived from them? Offload again to rebuild.")) return;
    startTransition(async () => {
      const res = await clearStrapData();
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {data.notReady ? <EmptyState title="Strap storage is not set up yet" description="Run supabase/migrations/0014_strap.sql in the Supabase SQL editor, then reload." /> : null}

      <section aria-labelledby="strap-connect">
        <SectionHeader title={<span id="strap-connect">Your strap</span>} hint={device ? `${device.name ?? device.serial}${device.battery_pct != null ? ` · ${Math.round(device.battery_pct)}% battery` : ""}${device.firmware ? ` · firmware ${device.firmware}` : ""}` : "Nothing paired yet"} />
        {support === "none" ? (
          <EmptyState className="mt-3" icon={<BluetoothOff />} title="Bluetooth is not available here" description="Reading the strap needs the FRADY app on iPhone or Android, or Chrome on Android or desktop. Safari and Firefox cannot do it." />
        ) : (
          <div className="border-line-1 bg-surface-1 mt-3 rounded-lg border p-4 md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-text-1 text-sm font-medium">{STATUS_TEXT[status]}</p>
                <p className="text-text-3 text-meta nums mt-1">
                  {busy || status === "done" ? `${progress.records} records · ${progress.chunks} chunks · ${progress.minutes} minutes stored` : device?.last_offload_at ? `Last offload ${formatTimestamp(device.last_offload_at)}` : "No offload yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="text-text-3 text-meta block">Model</span>
                  <select value={model} onChange={(e) => setModel(e.target.value as StrapModel)} disabled={busy} className="bg-surface-2 border-line-1 mt-1 h-9 rounded-md border px-2 text-sm">
                    <option value="auto">Detect</option>
                    <option value="whoop4">WHOOP 4.0</option>
                    <option value="whoop5">WHOOP 5.0 / MG</option>
                  </select>
                </label>
                {busy || live ? (
                  <Button variant="outline" onClick={liveMode ? stopLive : () => abortRef.current?.abort()}>
                    <Square /> {liveMode ? "Disconnect" : "Stop"}
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => startLive(false)} disabled={support === "unknown" || data.notReady}>
                      <Link2 /> Keep connected
                    </Button>
                    <Button variant="outline" onClick={start} disabled={support === "unknown" || data.notReady}>
                      <Bluetooth /> One-time pull
                    </Button>
                  </>
                )}
              </div>
            </div>
            {live ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-text-3 text-meta">Heart rate</p>
                  <p className={`nums text-3xl font-semibold tracking-tight ${bpm ? "text-text-1" : "text-text-3"}`} aria-live="polite">{bpm ?? "--"}<span className="text-text-3 ml-1 text-sm font-normal">bpm</span></p>
                </div>
                <div>
                  <p className="text-text-3 text-meta">Recorder pulls</p>
                  <p className="nums text-text-1 text-3xl font-semibold tracking-tight">{cycles}</p>
                  {lastCycleAt ? <p className="text-text-3 text-meta nums">last {formatTimestamp(lastCycleAt)}</p> : null}
                </div>
                <div>
                  <p className="text-text-3 text-meta">Minutes stored</p>
                  <p className="nums text-text-1 text-3xl font-semibold tracking-tight">{progress.minutes}</p>
                </div>
              </div>
            ) : null}
            {log.length ? <pre className="bg-surface-2 text-text-2 nums mt-4 max-h-56 overflow-auto rounded-md p-3 text-[11px] leading-relaxed">{log.join("\n")}</pre> : null}
            <div className="text-text-3 mt-4 space-y-1 text-sm">
              <p className="text-text-2">Before the first offload (the strap holds one encrypted bond at a time)</p>
              <p>1. Turn Bluetooth off on the phone that runs the WHOOP app. Quitting the app is not always enough.</p>
              <p>2. If an earlier attempt half-paired the strap, forget it in this device&apos;s Bluetooth settings.</p>
              <p>3. WHOOP 5.0 or MG: tap the sensor firmly and repeatedly until the LEDs flash blue. That is its pairing window.</p>
              <p>4. On a Mac or Windows PC, pair the strap once in the system Bluetooth settings while the LEDs are blue, then come back and press Connect. Chrome cannot create the bond by itself on a desktop. The FRADY app on a phone bonds on its own.</p>
              <p>5. Press Keep connected. FRADY streams your heart rate, pulls the strap&apos;s recorder every 15 minutes for sleep and motion, and reconnects by itself when the strap comes back into range. The first pull takes several minutes for a full 14-day store.</p>
              <p>In the FRADY app the link keeps running in the background and reconnects on launch. In a browser it runs while this tab is open. The WHOOP app will need to re-pair if you go back to it.</p>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="strap-coverage">
        <SectionHeader title={<span id="strap-coverage">Coverage</span>} hint={`${data.totalMinutes.toLocaleString()} minutes stored in total`} />
        <MetricStrip cols={4} className="mt-3 md:grid-cols-7">
          {data.coverage.map((c) => (
            <Metric key={c.day} size="sm" label={formatDate(c.day, "short", today)} value={c.minutes ? `${Math.round((c.minutes / 1440) * 100)}%` : "--"} sub={c.minutes ? `${c.minutes} min` : "no data"} tone={c.minutes >= 1200 ? "good" : c.minutes > 0 ? "warning" : "neutral"} muted={!c.minutes} />
          ))}
        </MetricStrip>
      </section>

      <section aria-labelledby="strap-settings">
        <SectionHeader title={<span id="strap-settings">Derivation</span>} />
        <div className="border-line-1 mt-3 flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end md:justify-between">
          <label className="text-sm">
            <span className="text-text-2 block">Max heart rate (for strain zones)</span>
            <input type="number" min={100} max={230} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="220 minus age" className="bg-surface-1 border-line-1 nums mt-1 h-9 w-40 rounded-md border px-2" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={saveMaxHr} disabled={pending || !device}>Save</Button>
            <Button size="sm" variant="outline" onClick={rederive} disabled={pending || !data.totalMinutes}><RefreshCw /> Re-derive days</Button>
            <Button size="sm" variant="ghost" onClick={clearAll} disabled={pending || !data.totalMinutes}><Trash2 /> Clear strap data</Button>
          </div>
        </div>
        <p className="text-text-3 mt-2 text-xs leading-relaxed">Sleep stages, resting heart rate, HRV, respiratory rate, strain and workouts are FRADY&apos;s own estimates from heart rate, R-R intervals and motion. They are not WHOOP&apos;s numbers and not EEG. SpO2 and skin temperature are not reported because the raw channels are uncalibrated.</p>
      </section>

      <section aria-labelledby="strap-offloads">
        <SectionHeader title={<span id="strap-offloads">Offloads</span>} count={data.offloads.length} />
        {data.offloads.length ? (
          <div className="hairline-rows -mx-2 mt-3">
            {data.offloads.map((o) => (
              <div key={o.id}>
                <HealthRow title={`${formatTimestamp(o.started_at)} · ${o.status}${o.error ? ` · ${o.error}` : ""}`} meta={`${o.platform ?? ""}${o.first_sample_at && o.last_sample_at ? ` · ${formatTimestamp(o.first_sample_at)} to ${formatTimestamp(o.last_sample_at)}` : ""}`} value={`${o.minutes} min`} sub={`${o.records} records · ${o.chunks} chunks`} />
                {o.log?.length ? (
                  <details className="px-2 pb-2">
                    <summary className="text-text-3 text-meta cursor-pointer">Log ({o.log.length} lines)</summary>
                    <pre className="bg-surface-2 text-text-2 nums mt-1 max-h-56 overflow-auto rounded-md p-3 text-[11px] leading-relaxed">{o.log.join("\n")}</pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState className="mt-3" title="No offloads yet" />
        )}
      </section>
    </div>
  );
}
