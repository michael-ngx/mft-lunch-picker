// Spin the Wheel: a fair random pick from the contenders. Each spin logs the game
// (its contenders) in the team's history. The result pops up with confetti; the
// person who spun can log it as where the team is going today.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, MapPinCheck, RotateCw } from "lucide-react";
import { BackLink, RatingLine, WalkLine, celebrate } from "../components/Bits.tsx";
import { PhotoStrip } from "../components/Photos.tsx";
import { Wheel } from "../components/Wheel.tsx";
import { pickIndex, spinTarget } from "../lib/wheel.ts";
import { confirmWent, logGame, savePick, useApp } from "../lib/store.ts";
import { useContenders } from "./ChoosePage.tsx";
import type { Suggestion } from "../lib/lunch.ts";

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WheelPage() {
  const live = useContenders();
  // While spinning and showing the result, keep the wheel as it was when the spin
  // started, even if a teammate changes the contenders meanwhile.
  const [frozen, setFrozen] = useState<Suggestion[] | null>(null);
  const items = frozen ?? live;
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Suggestion | null>(null);
  const [saveError, setSaveError] = useState("");
  // The log of the current spin; "We're going here today" waits for it.
  const logged = useRef<Promise<void> | null>(null);
  const winner = useRef(-1);
  const spinningRef = useRef(false);
  const frozenRef = useRef<Suggestion[] | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const duration = reduceMotion() ? 1200 : 5200;

  useEffect(() => () => { if (stopTimer.current) clearTimeout(stopTimer.current); }, []);

  const spin = () => {
    const list = liveRef.current;
    if (spinningRef.current || list.length < 2) return;
    setResult(null); setSaveError("");
    frozenRef.current = list;
    setFrozen(list);
    const log = logGame(list);
    log.catch((e) => setSaveError(e instanceof Error ? e.message : String(e)));
    logged.current = log;
    const i = pickIndex(list.length);
    winner.current = i;
    spinningRef.current = true;
    setSpinning(true);
    setRotation((r) => spinTarget(r, i, list.length, undefined, reduceMotion() ? 2 : 6));
    // In case the browser skips the transition's end event (background tab).
    stopTimer.current = setTimeout(stop, duration + 300);
  };

  function stop() {
    if (!spinningRef.current) return;
    spinningRef.current = false;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    setSpinning(false);
    const w = frozenRef.current?.[winner.current];
    if (!w) return;
    setResult(w);
    celebrate();
    void savePick(w).catch((e) => setSaveError(e instanceof Error ? e.message : String(e)));
  }

  const again = () => { setResult(null); frozenRef.current = null; setFrozen(null); setTimeout(spin, 50); };
  const close = () => { setResult(null); frozenRef.current = null; setFrozen(null); };

  return (
    <main className="page wheel-page">
      <BackLink to="/choose">Back to games</BackLink>
      <h1>Spin the Wheel</h1>
      {items.length < 2 ? (
        <div className="alert warn">The wheel needs at least 2 contenders. <Link to="/">Go to the list</Link> and tick a few places.</div>
      ) : (
        <>
          <p className="muted lead">{items.length} contenders. Everyone has the same chance.</p>
          <Wheel items={items} rotation={rotation} durationMs={duration} spinning={spinning} onStop={stop} />
          <button className="btn red spin-btn" onClick={spin} disabled={spinning}>{spinning ? "Spinning…" : "Spin"}</button>
        </>
      )}
      {result && <ResultModal s={result} saveError={saveError} logged={logged.current} onAgain={again} onClose={close} />}
    </main>
  );
}

function ResultModal({ s, saveError, logged, onAgain, onClose }: {
  s: Suggestion; saveError: string; logged: Promise<void> | null; onAgain: () => void; onClose: () => void;
}) {
  const day = useApp((st) => st.teamDay);
  const me = useApp((st) => st.profile?.id);
  const [going, setGoing] = useState<"idle" | "saving" | "error">("idle");
  const [goError, setGoError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const went = day?.went ?? null;
  const isGoing = went?.id === s.id;
  const go = async (place: Suggestion | null) => {
    setGoing("saving"); setGoError("");
    try {
      await logged;
      await confirmWent(place);
      setGoing("idle");
    } catch (e) {
      setGoing("error");
      setGoError(e instanceof Error ? e.message : String(e));
    }
  };
  const by = went ? (went_by(day, me)) : "";

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="res-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <PhotoStrip photos={s.photos} label={s.name} size="lg" />
        <div className="modal-body">
          <p className="eyebrow">The wheel picked</p>
          <h2 id="res-title">{s.name}</h2>
          <RatingLine s={s} />
          <WalkLine s={s} />
          {s.address && <p className="muted small">{s.address}</p>}
          {saveError && <div className="alert err">Could not log this game: {saveError}</div>}

          {isGoing ? (
            <div className="going on" role="status">
              <Check size={18} aria-hidden="true" />
              <span>Logged: {by === "you" ? "you set" : `${by} set`} {s.name} as where the team is going today. Spin again to change it.
                {" "}<button className="linkbtn" onClick={() => void go(null)} disabled={going === "saving"}>Undo</button></span>
            </div>
          ) : (
            <div className="going">
              <button className="btn wide go-btn" onClick={() => void go(s)} disabled={going === "saving"}>
                <MapPinCheck size={18} aria-hidden="true" />{going === "saving" ? "Saving…" : "We're going here today"}
              </button>
              <span className="muted small">
                {went ? <>Replaces {went.name}, set by {by}.</> : <>Logs it in the team's history as where you went today.</>}
              </span>
            </div>
          )}
          {goError && <div className="alert err">{goError}</div>}

          <div className="modal-actions">
            {s.mapsUrl && <a href={s.mapsUrl} target="_blank" rel="noreferrer" className="btn quiet">Open in Google Maps<ExternalLink size={15} aria-hidden="true" /></a>}
            <button className="btn quiet" onClick={onAgain}><RotateCw size={15} aria-hidden="true" />Spin again</button>
          </div>
          <Link to="/" className="modal-back-link">Back to the list</Link>
        </div>
      </div>
    </div>
  );
}

function went_by(day: { went_by: string | null; went_by_name: string } | null, me: string | undefined): string {
  if (!day) return "";
  return day.went_by === me ? "you" : day.went_by_name || "a teammate";
}
