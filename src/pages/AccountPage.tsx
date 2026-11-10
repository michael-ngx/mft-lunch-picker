// Your name (shown to your team), your team, and signing out.
import { useState } from "react";
import { leaveTeam, saveName, signOut, useApp } from "../lib/store.ts";
import { BackLink } from "../components/Bits.tsx";

export function AccountPage() {
  const profile = useApp((s) => s.profile)!;
  const team = useApp((s) => s.team);
  const membership = useApp((s) => s.membership);
  const teams = useApp((s) => s.teams);
  const [name, setName] = useState(profile.display_name);
  const [msg, setMsg] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const pendingTeam = membership?.status === "pending" ? teams.find((t) => t.id === membership.team_id) : null;

  return (
    <main className="page narrow">
      <BackLink to="/">Back to lunch</BackLink>
      <h1>Your account</h1>
      <section className="card">
        <div className="field"><label htmlFor="acc-name">Your name</label>
          <div className="row">
            <input id="acc-name" className="input" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setMsg(""); }} />
            <button className="btn" disabled={!name.trim() || name.trim() === profile.display_name}
              onClick={() => void saveName(name).then(() => setMsg("Saved."), (e) => setMsg(e.message))}>Save</button>
          </div>
          <span className="hint">Your team sees this name next to the runs you make.{msg && <> <b>{msg}</b></>}</span></div>
        <p className="kv"><span>Email</span><b>{profile.email}</b></p>
        <p className="kv"><span>Role</span><b>{profile.role === "admin" ? "Admin" : "Member"}</b></p>
      </section>

      <section className="card">
        <h2>Team</h2>
        {team ? (
          <>
            <p>You are in <b>{team.name}</b>.</p>
            {confirmLeave ? (
              <div className="confirm">
                <span>Leave {team.name}? You would need approval again to rejoin.</span>
                <button className="btn danger" onClick={() => void leaveTeam()}>Leave team</button>
                <button className="btn quiet" onClick={() => setConfirmLeave(false)}>Cancel</button>
              </div>
            ) : <button className="btn quiet" onClick={() => setConfirmLeave(true)}>Leave team</button>}
          </>
        ) : pendingTeam ? <p>Waiting for approval to join <b>{pendingTeam.name}</b>.</p> : <p className="muted">You are not in a team yet.</p>}
      </section>

      <button className="btn quiet" onClick={() => void signOut()}>Sign out</button>
    </main>
  );
}
