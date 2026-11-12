// Pick a game to choose lunch from the contenders. One game for now; each new
// game adds a card to the grid.
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { useApp } from "../lib/store.ts";
import { useTeamList } from "../lib/list.ts";
import { BackLink } from "../components/Bits.tsx";
import { WheelArt } from "../components/Wheel.tsx";
import type { ReactNode } from "react";

interface Game { to: string; title: string; text: string; art: ReactNode }

const GAMES: Game[] = [
  { to: "/choose/wheel", title: "Spin the Wheel", text: "Every contender gets a slice. Spin it, and lunch is wherever the wheel stops.", art: <WheelArt /> },
];

/** Today's contenders, from the places on the team's list. */
export function useContenders() {
  const { all } = useTeamList();
  const ids = useApp((s) => s.teamDay?.contenders);
  const set = new Set(ids ?? []);
  return all.filter((s) => set.has(s.id));
}

export function ChoosePage() {
  const pool = useContenders();
  const enough = pool.length >= 2;
  return (
    <main className="page">
      <BackLink to="/">Back to the list</BackLink>
      <h1>Choose a game</h1>
      {pool.length > 0 ? (
        <div className="pool-row" aria-label="Contenders">
          <span className="muted small">{pool.length} contender{pool.length === 1 ? "" : "s"}:</span>
          {pool.map((s) => <span key={s.id} className="chip">{s.name}</span>)}
        </div>
      ) : null}
      {!enough && <div className="alert warn">Tick at least 2 places as contenders in the list first. <Link to="/">Go to the list</Link></div>}
      <ul className="games">
        {GAMES.map((g) => (
          <li key={g.to} className={`game${enough ? "" : " off"}`}>
            {enough ? <Link to={g.to} className="game-link" aria-label={`Play ${g.title}`} /> : null}
            <div className="game-art">{g.art}</div>
            <div className="game-body">
              <h2>{g.title}</h2>
              <p className="muted">{g.text}</p>
              <span className="btn red small game-play" aria-hidden="true"><Play size={15} aria-hidden="true" />Play</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">More games are coming.</p>
    </main>
  );
}
