// Small shared pieces: the back link, a place's key facts, the confetti burst.
import { Link } from "react-router-dom";
import { ArrowLeft, Star } from "lucide-react";
import confetti from "canvas-confetti";
import { PRICE_LEVEL_LABEL, fmtDistance, fmtPrice, type Suggestion } from "../lib/lunch.ts";

export function BackLink({ to, children }: { to: string; children: string }) {
  return <Link to={to} className="backlink"><ArrowLeft size={17} aria-hidden="true" />{children}</Link>;
}

export function priceText(s: Suggestion): string {
  if (s.price) return fmtPrice(s.price);
  if (s.priceLevel && PRICE_LEVEL_LABEL[s.priceLevel]) return PRICE_LEVEL_LABEL[s.priceLevel];
  return "";
}

/** Rating, review count and price on one line. */
export function RatingLine({ s }: { s: Suggestion }) {
  const price = priceText(s);
  return (
    <span className="rl">
      {s.rating !== null && <span className="rl-rating"><b>{s.rating.toFixed(1)}</b><Star size={13} aria-hidden="true" className="star" /><span className="muted">({s.ratingCount.toLocaleString("en-CA")})</span></span>}
      {s.rating !== null && price && <span className="muted" aria-hidden="true">·</span>}
      {price && <span>{price}</span>}
    </span>
  );
}

export function WalkLine({ s }: { s: Suggestion }) {
  // Non-breaking spaces keep "10 min walk" and "800 m" from splitting across lines.
  return <span className="muted">{[s.type, `${s.walkMin}\u00a0min\u00a0walk`, fmtDistance(s.distanceM).replace(" ", "\u00a0")].filter(Boolean).join(" · ")}</span>;
}

const CONFETTI_COLORS = ["#1d4ed8", "#60a5fa", "#bfdbfe", "#f59e0b", "#ef4444", "#ffffff"];

/** A celebration burst from both sides and the middle. Skipped for people who ask for less motion. */
export function celebrate() {
  const base = { colors: CONFETTI_COLORS, disableForReducedMotion: true, zIndex: 60 };
  void confetti({ ...base, particleCount: 120, spread: 80, startVelocity: 45, origin: { x: 0.5, y: 0.55 } });
  setTimeout(() => {
    void confetti({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
    void confetti({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
  }, 180);
  setTimeout(() => void confetti({ ...base, particleCount: 60, spread: 120, startVelocity: 30, origin: { x: 0.5, y: 0.35 } }), 450);
}
