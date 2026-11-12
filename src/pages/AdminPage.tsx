// Admin: approve people into teams, see and manage members, add teams, and set
// the Google Maps key every search uses.
import { useCallback, useEffect, useState } from "react";
import { Check, UserMinus, X } from "lucide-react";
import { approve, createTeam, onAdminChange, removeMembership, saveConfig, useApp } from "../lib/store.ts";
import { must, supabase } from "../lib/supabase.ts";
import type { Membership, Profile } from "../lib/types.ts";
import { BackLink } from "../components/Bits.tsx";

interface Row extends Membership { profile: Profile | undefined }

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AdminPage() {
  const teams = useApp((s) => s.teams);
  const me = useApp((s) => s.profile)!;
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const ms = must(await supabase.from("memberships").select("*").order("requested_at")) as Membership[];
    const ps = must(await supabase.from("profiles").select("*")) as Profile[];
    setRows(ms.map((m) => ({ ...m, profile: ps.find((p) => p.id === m.user_id) })));
  }, []);
  useEffect(() => { void load().catch((e) => setError(e.message)); return onAdminChange(() => void load()); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError("");
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "Unknown team";
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <main className="page">
      <BackLink to="/">Back to lunch</BackLink>
      <h1>Admin</h1>
      {error && <div className="alert err">{error}</div>}

      <section className="card">
        <h2>Waiting for approval {pending.length > 0 && <span className="count">{pending.length}</span>}</h2>
        {pending.length === 0 ? <p className="muted">No one is waiting.</p> : (
          <ul className="people">
            {pending.map((r) => (
              <li key={r.user_id}>
                <span className="person"><b>{r.profile?.display_name || "No name"}</b><span className="muted small">{r.profile?.email}</span></span>
                <span className="muted small">wants to join <b>{teamName(r.team_id)}</b>, {when(r.requested_at)}</span>
                <span className="actions">
                  <button className="btn small" disabled={!!busy} onClick={() => void act(r.user_id, () => approve(r.user_id))}><Check size={15} aria-hidden="true" />Approve</button>
                  <button className="btn quiet small" disabled={!!busy} onClick={() => void act(r.user_id, () => removeMembership(r.user_id))}><X size={15} aria-hidden="true" />Decline</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Teams</h2>
        {teams.map((t) => {
          const members = rows.filter((r) => r.team_id === t.id && r.status === "approved");
          return (
            <div key={t.id} className="team-block">
              <h3>{t.name} <span className="muted small">{members.length} member{members.length === 1 ? "" : "s"}</span></h3>
              {members.length === 0 ? <p className="muted small">No members yet.</p> : (
                <ul className="people">
                  {members.map((r) => (
                    <li key={r.user_id}>
                      <span className="person"><b>{r.profile?.display_name || "No name"}{r.user_id === me.id && " (you)"}</b><span className="muted small">{r.profile?.email}</span></span>
                      <span>{r.profile?.role === "admin" && <span className="badge">Admin</span>}</span>
                      <span className="actions">
                        <RemoveButton disabled={!!busy} self={r.user_id === me.id} onConfirm={() => void act(r.user_id, () => removeMembership(r.user_id))} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <NewTeam onCreate={(name) => act("team", () => createTeam(name))} busy={busy === "team"} />
      </section>

      <GoogleSettings />
    </main>
  );
}

function RemoveButton({ onConfirm, disabled, self }: { onConfirm: () => void; disabled: boolean; self: boolean }) {
  const [ask, setAsk] = useState(false);
  if (ask) return (
    <span className="confirm inline">
      <button className="btn danger small" disabled={disabled} onClick={() => { setAsk(false); onConfirm(); }}>{self ? "Leave" : "Remove"}</button>
      <button className="btn quiet small" onClick={() => setAsk(false)}>Cancel</button>
    </span>
  );
  return <button className="btn quiet small" disabled={disabled} onClick={() => setAsk(true)}><UserMinus size={15} aria-hidden="true" />{self ? "Leave" : "Remove"}</button>;
}

function NewTeam({ onCreate, busy }: { onCreate: (name: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("");
  return (
    <form className="row new-team" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onCreate(name).then(() => setName("")); }}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" maxLength={60} aria-label="New team name" />
      <button className="btn quiet" disabled={busy || !name.trim()}>Add team</button>
    </form>
  );
}

function GoogleSettings() {
  const config = useApp((s) => s.config);
  const [key, setKey] = useState(config?.google_maps_key ?? "");
  const [mapId, setMapId] = useState(config?.map_id ?? "");
  const [msg, setMsg] = useState("");
  useEffect(() => { setKey(config?.google_maps_key ?? ""); setMapId(config?.map_id ?? ""); }, [config?.google_maps_key, config?.map_id]);
  const changed = key.trim() !== (config?.google_maps_key ?? "") || mapId.trim() !== (config?.map_id ?? "");

  return (
    <section className="card">
      <h2>Google Maps</h2>
      <p className="muted">Every search uses this key: the map and the place search run in the browser of whoever uses them. Only signed-in, approved people can read it, and its website restrictions keep it from working anywhere else.</p>
      <div className="field"><label htmlFor="gk">Google Maps API key</label>
        <input id="gk" className="input" value={key} onChange={(e) => { setKey(e.target.value.trim()); setMsg(""); }} placeholder="AIza…" autoComplete="off" spellCheck={false} /></div>
      <div className="field"><label htmlFor="mid">Map ID (optional)</label>
        <input id="mid" className="input" value={mapId} onChange={(e) => { setMapId(e.target.value.trim()); setMsg(""); }} placeholder="Leave empty to use Google's demo map ID" autoComplete="off" spellCheck={false} />
        <span className="hint">The numbered pins need a map ID. Google's demo ID works; your own (Google Maps Platform, Map management) lets you style the map.</span></div>
      <div className="row">
        <button className="btn" disabled={!changed} onClick={() => void saveConfig(key.trim(), mapId.trim()).then(() => setMsg("Saved. Reload open pages to use a new key."), (e) => setMsg(e.message))}>Save</button>
        {msg && <span className="small">{msg}</span>}
      </div>

    </section>
  );
}
