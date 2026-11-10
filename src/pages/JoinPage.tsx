// Signed in but not in a team yet: ask to join one, then wait for approval.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Users } from "lucide-react";
import { leaveTeam, requestJoin, useApp } from "../lib/store.ts";

export function JoinPage() {
  const teams = useApp((s) => s.teams);
  const membership = useApp((s) => s.membership);
  const profile = useApp((s) => s.profile)!;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const admin = profile.role === "admin";

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };

  if (membership?.status === "pending") {
    const t = teams.find((x) => x.id === membership.team_id);
    return (
      <main className="page narrow">
        <div className="card center">
          <span className="big-icon"><Clock size={26} aria-hidden="true" /></span>
          <h1>Waiting for approval</h1>
          <p className="muted">You asked to join <b>{t?.name ?? "a team"}</b>. This page opens your team's lunch list as soon as an admin approves you.</p>
          {error && <div className="alert err">{error}</div>}
          <button className="btn quiet" disabled={!!busy} onClick={() => void act("cancel", leaveTeam)}>Cancel request</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>Join a team</h1>
      <p className="muted lead">Everyone in a team sees the same lunch list each day.{admin ? " As the admin, you join straight away." : " An admin approves each request."}</p>
      {error && <div className="alert err">{error}</div>}
      <ul className="team-list">
        {teams.map((t) => (
          <li key={t.id} className="card team-row">
            <span className="team-icon"><Users size={20} aria-hidden="true" /></span>
            <span className="team-name">{t.name}</span>
            <button className="btn" disabled={!!busy} onClick={() => void act(t.id, () => requestJoin(t.id))}>
              {busy === t.id ? "Sending" : admin ? "Join" : "Ask to join"}
            </button>
          </li>
        ))}
        {!teams.length && <li className="muted">There are no teams yet.</li>}
      </ul>
      {admin && <p className="muted small">Teams, approvals and the Google Maps key are in <Link to="/admin">Admin</Link>.</p>}
    </main>
  );
}
