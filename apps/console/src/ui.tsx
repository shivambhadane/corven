import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "./api";

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

export const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/** Runs an action, shows its error, and calls `then` on success. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      then?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export const Card = ({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) => (
  <section className="card">
    {(title || actions) && (
      <header className="card-h">
        <h2>{title}</h2>
        <div className="row">{actions}</div>
      </header>
    )}
    {children}
  </section>
);
export const Err = ({ e }: { e: string | null }) => (e ? <div className="err">{e}</div> : null);
export const Pill = ({ v }: { v: string | null | undefined }) => <span className={`pill p-${(v ?? "none").replace(/[^a-z_]/gi, "")}`}>{v ?? "—"}</span>;
export const short = (id: string | null | undefined, n = 8) => (id ? `${id.slice(0, n)}…` : "—");
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");
export const Empty = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;
