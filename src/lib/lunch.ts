// The fixed filters, the strict check every suggestion must pass, and the ranking.
// Pure functions, so the rules are tested without Google Maps.

export interface LatLng { lat: number; lng: number }

/** Price ranges as Google Maps shows them (per person, local currency). max null = no upper bound. */
export const PRICE_BANDS = [
  { id: "1-10", min: 0, max: 10, label: "$1–10" },
  { id: "10-20", min: 10, max: 20, label: "$10–20" },
  { id: "20-30", min: 20, max: 30, label: "$20–30" },
  { id: "30-50", min: 30, max: 50, label: "$30–50" },
  { id: "50-100", min: 50, max: 100, label: "$50–100" },
  { id: "100+", min: 100, max: null, label: "$100+" },
] as const;
export type BandId = (typeof PRICE_BANDS)[number]["id"];

export interface LunchFilters {
  /** Price ranges allowed. Empty means any price. */
  bands: BandId[];
  /** With a budget set: also keep places that show no price range on Google. */
  allowNoPrice: boolean;
  radiusM: number;
  /** 0 means any rating. */
  minRating: number;
  count: number;
  openNow: boolean;
}

export const RADIUS = { min: 100, max: 5000, step: 50 } as const;
export const COUNT = { min: 1, max: 20 } as const;

export const DEFAULT_FILTERS: LunchFilters = {
  bands: ["1-10", "10-20", "20-30"],
  allowNoPrice: false,
  radiusM: 1000,
  minRating: 4,
  count: 8,
  openNow: true,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);

/** Reads a team's stored fixed filters, filling gaps with defaults and clamping values. */
export function normalizeFilters(raw: unknown): LunchFilters {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = new Set<string>(PRICE_BANDS.map((b) => b.id));
  const bands = Array.isArray(f.bands) ? (f.bands.filter((b) => typeof b === "string" && ids.has(b)) as BandId[]) : DEFAULT_FILTERS.bands;
  return {
    bands: PRICE_BANDS.map((b) => b.id).filter((id) => bands.includes(id)),
    allowNoPrice: typeof f.allowNoPrice === "boolean" ? f.allowNoPrice : DEFAULT_FILTERS.allowNoPrice,
    radiusM: Math.round(clamp(num(f.radiusM, DEFAULT_FILTERS.radiusM), RADIUS.min, RADIUS.max)),
    minRating: Math.round(clamp(num(f.minRating, DEFAULT_FILTERS.minRating), 0, 4.9) * 10) / 10,
    count: Math.round(clamp(num(f.count, DEFAULT_FILTERS.count), COUNT.min, COUNT.max)),
    openNow: typeof f.openNow === "boolean" ? f.openNow : DEFAULT_FILTERS.openNow,
  };
}

// ---------- places ----------

export interface PriceRange { start: number; end: number | null; currency: string }

/** One place from Google, reduced to what the picker uses. */
export interface Candidate {
  id: string;
  name: string;
  pos: LatLng;
  rating: number | null;
  ratingCount: number;
  price: PriceRange | null;
  /** Google's $–$$$$ level, shown when there is no range. */
  priceLevel: string | null;
  /** null when Google has no opening hours for it. */
  openNow: boolean | null;
  /** OPERATIONAL, CLOSED_TEMPORARILY, ... or null when unknown. */
  status: string | null;
  type: string;
  address: string;
  mapsUrl: string;
}

const R_EARTH = 6_371_000;
/** Straight-line distance in meters. */
export function distanceM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walking minutes for a straight-line distance (80 m a minute, about 4.8 km/h). */
export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 80));

export interface HoursPeriod { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } | null }

/** Whether a place is open at a moment, from Google's weekly opening periods
 *  (day 0 = Sunday, in the place's local time) and its offset from UTC.
 *  null when there are no hours to go on. */
export function isOpenAt(periods: HoursPeriod[] | null | undefined, utcOffsetMin: number | null | undefined, nowMs: number): boolean | null {
  if (!periods?.length || utcOffsetMin === null || utcOffsetMin === undefined) return null;
  const WEEK = 7 * 1440;
  // A single period that opens and never closes means open around the clock.
  if (periods.length === 1 && !periods[0].close) return true;
  const local = new Date(nowMs + utcOffsetMin * 60_000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const p of periods) {
    if (!p.close) continue;
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let c = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (c <= o) c += WEEK; // open across the end of the week (Saturday night into Sunday)
    if ((t >= o && t < c) || (t + WEEK >= o && t + WEEK < c)) return true;
  }
  return false;
}

/** The selected bands joined into continuous intervals ($10–20 and $20–30 become $10–30). */
function bandIntervals(bands: BandId[]): { min: number; max: number | null }[] {
  const sel = PRICE_BANDS.filter((b) => bands.includes(b.id));
  const out: { min: number; max: number | null }[] = [];
  for (const b of sel) {
    const last = out[out.length - 1];
    if (last && last.max !== null && last.max === b.min) last.max = b.max;
    else out.push({ min: b.min, max: b.max });
  }
  return out;
}

/** A price range fits the budget when it lies entirely inside the selected bands.
 *  A range with no upper end ("$100+") fits only a band with no upper end. */
export function priceFits(price: PriceRange, bands: BandId[]): boolean {
  if (!bands.length) return true;
  return bandIntervals(bands).some((iv) => {
    if (price.start < iv.min - 1e-9) return false;
    if (iv.max === null) return true;
    return price.end !== null && price.end <= iv.max + 1e-9;
  });
}

export type DropReason = "closedForGood" | "far" | "rating" | "budget" | "noPrice" | "closedNow";

export const DROP_LABEL: Record<DropReason, string> = {
  closedForGood: "closed by Google",
  far: "outside the radius",
  rating: "below the rating",
  budget: "over or under budget",
  noPrice: "no price range",
  closedNow: "closed now",
};

/** The first fixed filter a place fails, or null when it passes every one. */
export function dropReason(c: Candidate, f: LunchFilters, origin: LatLng): DropReason | null {
  if (c.status && c.status !== "OPERATIONAL") return "closedForGood";
  if (distanceM(origin, c.pos) > f.radiusM) return "far";
  if (f.minRating > 0 && (c.rating === null || c.rating < f.minRating - 1e-9)) return "rating";
  if (f.bands.length) {
    if (!c.price) { if (!f.allowNoPrice) return "noPrice"; }
    else if (!priceFits(c.price, f.bands)) return "budget";
  }
  if (f.openNow && c.openNow === false) return "closedNow";
  return null;
}

export interface Suggestion extends Candidate {
  rank: number;
  distanceM: number;
  walkMin: number;
  /** Rating pulled toward 4.2 when it rests on few reviews. */
  adjRating: number;
  score: number;
}

export interface RunSummary {
  found: number;
  matched: number;
  dropped: Partial<Record<DropReason, number>>;
}

/** A rating is pulled toward 4.2 (about the typical Google rating) as if it had
 *  30 extra ratings of 4.2, so a 4.9 from 6 reviews does not beat a 4.6 from 2,000. */
const PRIOR_RATING = 4.2;
const PRIOR_WEIGHT = 30;
/** Stars taken off at the edge of the radius; nearer places win close calls. */
const DISTANCE_PENALTY = 0.3;

/** Applies the fixed filters strictly, then ranks what is left:
 *  score = rating adjusted for review count − 0.3 × (distance / radius). */
export function pickLunch(cands: Candidate[], f: LunchFilters, origin: LatLng): { suggestions: Suggestion[]; summary: RunSummary } {
  const seen = new Set<string>();
  const unique = cands.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const dropped: RunSummary["dropped"] = {};
  const pass: Candidate[] = [];
  for (const c of unique) {
    const why = dropReason(c, f, origin);
    if (why) dropped[why] = (dropped[why] ?? 0) + 1;
    else pass.push(c);
  }
  const scored = pass.map((c) => {
    const d = distanceM(origin, c.pos);
    const v = c.rating === null ? 0 : c.ratingCount;
    const adj = (v * (c.rating ?? 0) + PRIOR_WEIGHT * PRIOR_RATING) / (v + PRIOR_WEIGHT);
    const score = adj - DISTANCE_PENALTY * (d / f.radiusM);
    return { ...c, rank: 0, distanceM: d, walkMin: walkMinutes(d), adjRating: adj, score };
  });
  scored.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM || a.name.localeCompare(b.name));
  const suggestions = scored.slice(0, f.count).map((s, i) => ({ ...s, rank: i + 1 }));
  return { suggestions, summary: { found: unique.length, matched: pass.length, dropped } };
}

// ---------- display ----------

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function fmtPrice(p: PriceRange): string {
  const sym = p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : "$";
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  return p.end === null ? `${sym}${n(p.start)}+` : `${sym}${n(p.start)}–${n(p.end)}`;
}

export const PRICE_LEVEL_LABEL: Record<string, string> = {
  FREE: "Free", INEXPENSIVE: "$", MODERATE: "$$", EXPENSIVE: "$$$", VERY_EXPENSIVE: "$$$$",
};

export function fmtBudget(bands: BandId[]): string {
  if (!bands.length) return "Any price";
  return bandIntervals(bands)
    .map((iv) => (iv.max === null ? `$${iv.min}+` : iv.min === 0 ? `Up to $${iv.max}` : `$${iv.min}–${iv.max}`))
    .join(", ");
}

/** The budget in words, for the hint under the price chips: "$30 or less", "$50–100, or $100 or more". */
export function budgetPhrase(bands: BandId[]): string {
  return bandIntervals(bands)
    .map((iv) => (iv.max === null ? `$${iv.min} or more` : iv.min === 0 ? `$${iv.max} or less` : `$${iv.min}–${iv.max}`))
    .join(", or ");
}
