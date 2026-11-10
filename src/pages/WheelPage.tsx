// Spin the Wheel: a fair random pick from the contenders. The result pops up with
// confetti and is saved as the team's pick for today.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, RotateCw } from "lucide-react";
import { BackLink, RatingLine, WalkLine, celebrate } from "../components/Bits.tsx";
import { PhotoStrip } from "../components/Photos.tsx";
import { Wheel } from "../components/Wheel.tsx";
import { pickIndex, spinTarget } from "../lib/wheel.ts";
import { savePick } from "../lib/store.ts";
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
      {result && <ResultModal s={result} saveError={saveError} onAgain={again} onClose={close} />}
    </main>
  );
}

function ResultModal({ s, saveError, onAgain, onClose }: { s: Suggestion; saveError: string; onAgain: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="res-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <PhotoStrip photos={s.photos} label={s.name} size="lg" />
        <div className="modal-body">
          <p className="eyebrow">Lunch is at</p>
          <h2 id="res-title">{s.name}</h2>
          <RatingLine s={s} />
          <WalkLine s={s} />
          {s.address && <p className="muted small">{s.address}</p>}
          <p className="muted small">Saved as today's pick for your team.</p>
          {saveError && <div className="alert err">Could not save the pick: {saveError}</div>}
          <div className="modal-actions">
            {s.mapsUrl && <a href={s.mapsUrl} target="_blank" rel="noreferrer" className="btn">Open in Google Maps<ExternalLink size={15} aria-hidden="true" /></a>}
            <button className="btn quiet" onClick={onAgain}><RotateCw size={15} aria-hidden="true" />Spin again</button>
          </div>
          <Link to="/" className="modal-back-link">Back to the list</Link>
        </div>
      </div>
    </div>
  );
}
