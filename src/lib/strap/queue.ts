import type { StrapMinute } from "./derive";

/**
 * Durable on-device queue for strap minutes. A recorder chunk is acknowledged to the strap as soon as
 * its minutes are in IndexedDB (fast and survives the app being killed); a background drain uploads
 * them to the server in large batches. Without IndexedDB the queue works in memory only.
 */
const DB = "frady-strap";
const STORE = "minutes";

interface Entry {
  minute: string;
  rev: number;
  data: StrapMinute;
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "minute" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

const richer = (a: StrapMinute, b: StrapMinute) => {
  const aRich = a.motion != null;
  const bRich = b.motion != null;
  if (aRich !== bRich) return aRich ? a : b;
  return b.samples >= a.samples ? b : a;
};

export class MinuteQueue {
  private db: IDBDatabase | null | undefined;
  private memory = new Map<string, Entry>();
  private rev = 0;

  private async ready() {
    if (this.db === undefined) this.db = await open();
    return this.db;
  }

  /** Save minutes locally. Resolves once they are durable (or in memory when IndexedDB is unavailable). */
  async put(minutes: StrapMinute[]): Promise<void> {
    if (!minutes.length) return;
    const db = await this.ready();
    if (!db) {
      for (const m of minutes) {
        const prev = this.memory.get(m.minute);
        this.memory.set(m.minute, { minute: m.minute, rev: ++this.rev, data: prev ? richer(prev.data, m) : m });
      }
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const m of minutes) {
        const get = store.get(m.minute);
        get.onsuccess = () => {
          const prev = get.result as Entry | undefined;
          store.put({ minute: m.minute, rev: ++this.rev + Date.now(), data: prev ? richer(prev.data, m) : m } satisfies Entry);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
    });
  }

  async pending(): Promise<number> {
    const db = await this.ready();
    if (!db) return this.memory.size;
    return new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  }

  private async take(limit: number): Promise<Entry[]> {
    const db = await this.ready();
    if (!db) return [...this.memory.values()].slice(0, limit);
    return new Promise((resolve) => {
      const out: Entry[] = [];
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value as Entry);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    });
  }

  /** Remove entries that are still at the revision we uploaded; anything rewritten meanwhile stays queued. */
  private async remove(entries: Entry[]): Promise<void> {
    const db = await this.ready();
    if (!db) {
      for (const e of entries) if (this.memory.get(e.minute)?.rev === e.rev) this.memory.delete(e.minute);
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const e of entries) {
        const get = store.get(e.minute);
        get.onsuccess = () => {
          if ((get.result as Entry | undefined)?.rev === e.rev) store.delete(e.minute);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /** Upload up to `batch` queued minutes with `upload`; returns how many were sent. */
  async drain(upload: (minutes: StrapMinute[]) => Promise<void>, batch = 600): Promise<number> {
    const entries = await this.take(batch);
    if (!entries.length) return 0;
    await upload(entries.map((e) => e.data));
    await this.remove(entries);
    return entries.length;
  }
}
