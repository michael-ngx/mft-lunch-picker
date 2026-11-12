// The team's history: every day a game was played, with its contenders, the
// game's result and where the team went; the team's most chosen places; and the
// never-again list, where anyone in the team can allow a place again.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, ExternalLink, MapPinCheck } from "lucide-react";
import { dayKey, loadHistory, setBan, useApp, type Member } from "../lib/store.ts";
import { BackLink, RatingLine } from "../components/Bits.tsx";
import type { PlaceRef } from "../lib/lunch.ts";
import type { Ban as BanRow, TeamDay } from "../lib/types.ts";
import { clock } from "./PickerPage.tsx";

const dayLabel = (day: string) => {
  if (day === dayKey()) return "Today";
  if (day === dayKey(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

export function HistoryPage() {
  const team = useApp((s) => s.team)!;
  const me = useApp((s) => s.profile?.id);
  const members = useApp((s) => s.members);
  const bans = useApp((s) => s.bans);
  const dayRev = useApp((s) => s.dayRev);
  const [days, setDays] = useState<TeamDay[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    loadHistory().then((d) => { if (live) { setDays(d); setError(""); } }).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [dayRev, team.id]);

  const favourites = useMemo(() => {
    const by = new Map<string, { place: PlaceRef; went: number; played: number }>();
    for (const d of days ?? []) {
      for (const p of d.played) {
        const e = by.get(p.id) ?? { place: p, went: 0, played: 0 };
        e.played++;
        by.set(p.id, e);
      }
      if (d.went) {
        const e = by.get(d.went.id) ?? { place: d.went, went: 0, played: 0 };
        e.went++;
        by.set(d.went.id, e);
      }
    }
    return [...by.values()]
      .filter((e) => e.went > 0 || e.played > 1)
      .sort((a, b) => b.went - a.went || b.played - a.played || a.place.name.localeCompare(b.place.name))
      .slice(0, 5);
  }, [days]);

  return (
    <main className="page history">
      <BackLink to="/">Back to the list</BackLink>
      <h1>History</h1>
      <p className="muted lead">Every game {team.name} played: the contenders, the wheel's result and where the team went. Everyone in the team sees this page.</p>
      {error && <div className="alert err">Could not load the history: {error}</div>}

      {favourites.length > 0 && (
        <section className="card">
          <h2>Most chosen</h2>
          <ol className="fav-list">
            {favourites.map((f) => (
              <li key={f.place.id}>
                <b>{f.place.name}</b>
                <span className="muted small">
                  {[f.went ? `went ${times(f.went)}` : "", `contender ${times(f.played)}`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="hist-days" aria-label="Days">
        {days === null && !error ? (
          <div className="lp-idle"><span className="loading-dots"><i /><i /><i /></span></div>
        ) : days && days.length === 0 ? (
          <div className="card center">
            <p>No games yet. Tick a few places as contenders, press Let's choose and play a game. It shows up here.</p>
            <Link to="/" className="btn">Go to the list</Link>
          </div>
        ) : (
          (days ?? []).map((d) => <DayCard key={d.day} d={d} me={me} members={members} />)
        )}
      </section>

      <section className="card" id="never-again">
        <h2><Ban size={18} aria-hidden="true" />Never again</h2>
        <p className="muted small">Places on this list are never suggested to {team.name}. Anyone in the team can add a place from its card on the list, or allow it again here.</p>
        {bans.length === 0 ? <p className="muted">No places yet.</p> : (
          <ul className="ban-list">{bans.map((b) => <BanItem key={b.place_id} b={b} me={me} />)}</ul>
        )}
      </section>
    </main>
  );
}

function DayCard({ d, me, members }: { d: TeamDay; me: string | undefined; members: Member[] }) {
  const name = (id: string | null, fallback: string) => (id === me ? "you" : members.find((m) => m.id === id)?.display_name || fallback || "a teammate");
  const players = d.players.map((id) => name(id, "")).filter((x, i, all) => all.indexOf(x) === i);
  const went = d.went;
  const result = d.pick && d.pick.id !== went?.id ? d.pick : null;
  return (
    <article className="day-card">
      <header className="day-head">
        <h2>{dayLabel(d.day)}</h2>
        {players.length > 0 && <span className="muted small">Played by {players.join(", ")}</span>}
      </header>
      {went ? (
        <div className="went">
          {went.photos?.[0] ? <img src={went.photos[0].uri} alt="" className="went-img" loading="lazy" /> : <span className="went-img blank"><MapPinCheck size={20} aria-hidden="true" /></span>}
          <span className="went-info">
            <span className="eyebrow">Went to</span>
            <b>{went.name}</b>
            <RatingLine s={went} />
            <span className="muted small">Set by {name(d.went_by, d.went_by_name)}{d.went_at ? ` at ${clock(d.went_at)}` : ""}</span>
          </span>
          {went.mapsUrl && <a href={went.mapsUrl} target="_blank" rel="noreferrer" className="icon-link" aria-label={`${went.name} on Google Maps`}><ExternalLink size={16} aria-hidden="true" /></a>}
        </div>
      ) : (
        <p className="muted small">Where the team went was not logged.</p>
      )}
      {result && <p className="small">The wheel's last pick: <b>{result.name}</b></p>}
      <div className="day-pool">
        <span className="muted small">Contenders ({d.played.length})</span>
        <ul className="chips">
          {d.played.map((p) => (
            <li key={p.id} className={`chip${p.id === went?.id ? " won" : ""}`}>
              {p.id === went?.id && <Check size={13} aria-hidden="true" />}{p.name}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function BanItem({ b, me }: { b: BanRow; me: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allow = () => {
    setBusy(true); setError("");
    void setBan({ id: b.place_id, name: b.name, address: b.address }, false).catch((e) => { setBusy(false); setError(e instanceof Error ? e.message : String(e)); });
  };
  return (
    <li>
      <span className="ban-info">
        <b>{b.name || "Unnamed place"}</b>
        {b.address && <span className="muted small">{b.address}</span>}
        <span className="muted small">Added by {b.banned_by === me ? "you" : b.banned_by_name || "a teammate"} on {shortDate(b.banned_at)}</span>
        {error && <span className="err-text small">{error}</span>}
      </span>
      <button className="btn quiet small" onClick={allow} disabled={busy}>Allow again</button>
    </li>
  );
}
