import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "./api";

export const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

export const Logo = () => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7" fill="#101216" stroke="#2b303b" /><path d="M21.5 11.2A7.2 7.2 0 1 0 21.5 20.8" stroke="#ecedee" strokeWidth="2.4" strokeLinecap="round" /><circle cx="21.8" cy="11" r="2.1" fill="#4da3ff" /><circle cx="21.8" cy="21" r="2.1" fill="#3ecf8e" /><circle cx="13.5" cy="16" r="1.7" fill="#ecedee" /></svg>
);

// ---- toasts and dialogs: a tiny module-level store, rendered once by <Overlays/>
type Toast = { id: number; msg: string; kind: "info" | "ok" | "err" };
type Dialog = { id: number; title: string; body?: string; input?: { label: string; value: string }; confirm: string; danger?: boolean; resolve: (v: string | boolean | null) => void };
let toasts: Toast[] = [];
let dialogs: Dialog[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let seq = 0;
export const toast = (msg: string, kind: Toast["kind"] = "info") => {
  const t = { id: ++seq, msg, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => ((toasts = toasts.filter((x) => x.id !== t.id)), emit()), kind === "err" ? 7000 : 3800);
};
/** Asks for a reason in a dialog. Resolves to the text, or null if cancelled. */
export const askReason = (title: string, confirm = "Confirm", defaultValue = ""): Promise<string | null> =>
  new Promise((resolve) => ((dialogs = [...dialogs, { id: ++seq, title, input: { label: "Reason (recorded in the audit trail)", value: defaultValue }, confirm, resolve: (v) => resolve(typeof v === "string" && v.trim() ? v.trim() : null) }]), emit()));
export const showInfo = (title: string, body: string) =>
  new Promise<void>((resolve) => ((dialogs = [...dialogs, { id: ++seq, title, body, confirm: "Close", resolve: () => resolve() }]), emit()));

export function Overlays() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  const d = dialogs[0];
  const close = (v: string | boolean | null) => {
    d?.resolve(v);
    dialogs = dialogs.slice(1);
    emit();
  };
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
      {d && <DialogView d={d} close={close} />}
    </>
  );
}
function DialogView({ d, close }: { d: Dialog; close: (v: string | boolean | null) => void }) {
  const [v, setV] = useState(d.input?.value ?? "");
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close(null)} role="dialog" aria-modal="true" aria-label={d.title}>
      <form className="dialog" onSubmit={(e) => (e.preventDefault(), close(d.input ? v : true))}>
        <h3>{d.title}</h3>
        {d.body && <pre>{d.body}</pre>}
        {d.input && <label>{d.input.label}<input autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>}
        <div className="row"><button type="button" onClick={() => close(null)}>Cancel</button><button className="primary" type="submit" disabled={!!d.input && !v.trim()}>{d.confirm}</button></div>
      </form>
    </div>
  );
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => void reload(), [reload]);
  return { data, error, loading, reload };
}

/** Runs an action; failures are shown as a toast and inline, successes (with a message) as a toast. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, then?: () => void, okMsg?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (okMsg) toast(okMsg, "ok");
      then?.();
    } catch (e) {
      setError(errText(e));
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export const Card = ({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) => (
  <section className="card">
    {(title || actions) && <header className="card-h"><h2>{title}</h2><div className="row">{actions}</div></header>}
    {children}
  </section>
);
export const Err = ({ e }: { e: string | null }) => (e ? <div className="err">{e}</div> : null);
export const Pill = ({ v }: { v: string | null | undefined }) => <span className={`pill p-${(v ?? "none").toLowerCase().replace(/[^a-z_]/g, "")}`}>{v ?? "—"}</span>;
export const short = (id: string | null | undefined, n = 8) => (id ? `${id.slice(0, n)}…` : "—");
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = () => <p className="muted"><span className="spin" />Loading…</p>;

const STAGES = [["DISCOVER", "registered"], ["ANALYZE", "blast radius"], ["CONTAIN", "approved plan"], ["VERIFY", "checks"], ["PROVE", "evidence"]] as const;
/** The product lifecycle, placed on an incident by its real state. */
export function Lifecycle({ status, hasPlan, hasEvidence }: { status: string; hasPlan: boolean; hasEvidence: boolean }) {
  const idx = ["detected", "investigating", "containment_planned", "awaiting_approval", "approved", "containing", "verifying"].includes(status)
    ? ({ detected: 1, investigating: 1, containment_planned: 2, awaiting_approval: 2, approved: 2, containing: 3, verifying: 3 } as Record<string, number>)[status]!
    : 4;
  const failed = ["containment_failed", "partially_contained", "rejected"].includes(status);
  return (
    <div className="steps" aria-label="Incident lifecycle">
      {STAGES.map(([name, hint], i) => {
        const done = i < idx || (i === 4 && hasEvidence);
        const now = i === idx && !done;
        const bad = failed && i === (status === "rejected" ? 2 : 3);
        return <div key={name} className={`step ${bad ? "bad" : done ? "done" : now ? "now" : ""}`}><b>{`0${i + 1} ${name}`}</b>{i === 2 && hasPlan && !done ? "plan ready" : hint}</div>;
      })}
    </div>
  );
}
