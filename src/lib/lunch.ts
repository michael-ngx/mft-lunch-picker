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

/** A Google photo of a place, with the author credit Google requires next to it. */
export interface PlacePhoto { uri: string; author: string; authorUri: string }

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
  /** Up to 3 photos; missing on lists saved before photos were added. */
  photos?: PlacePhoto[];
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

export type DropReason = "closedForGood" | "far" | "rating" | "budget" | "noPrice" | "closedNow" | "banned";

export const DROP_LABEL: Record<DropReason, string> = {
  closedForGood: "closed by Google",
  far: "outside the radius",
  rating: "below the rating",
  budget: "over or under budget",
  noPrice: "no price range",
  closedNow: "closed now",
  banned: "on the never-again list",
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

/** Why a place is on the list, shown as a small label on its card. */
export interface PlaceTag { kind: "new" | "liked" | "went"; text: string }

export interface Suggestion extends Candidate {
  rank: number;
  distanceM: number;
  walkMin: number;
  /** Rating pulled toward 4.2 when it rests on few reviews. */
  adjRating: number;
  score: number;
  tag?: PlaceTag;
}

export interface RunSummary {
  found: number;
  matched: number;
  dropped: Partial<Record<DropReason, number>>;
  /** Contenders carried over from the list before. */
  kept?: number;
  /** The extra cuisine searched this time. */
  cuisine?: string;
}

/** A place as the history keeps it: what a card shows, with one photo. */
export type PlaceRef = Pick<Suggestion, "id" | "name" | "address" | "rating" | "ratingCount" | "price" | "priceLevel" | "type" | "mapsUrl" | "distanceM" | "walkMin"> & { photos?: PlacePhoto[] };

export const toRef = (s: Suggestion | PlaceRef): PlaceRef => ({
  id: s.id, name: s.name, address: s.address, rating: s.rating, ratingCount: s.ratingCount, price: s.price, priceLevel: s.priceLevel,
  type: s.type, mapsUrl: s.mapsUrl, distanceM: Math.round(s.distanceM), walkMin: s.walkMin, photos: s.photos?.slice(0, 1),
});

/** A place's history with the team, from the database (place_stats). Dates are YYYY-MM-DD. */
export interface PlaceStat {
  /** Lists made today that showed it. */
  shownToday: number;
  /** Earlier days in the last 3 weeks whose lists showed it. */
  shownDays: number;
  lastShown: string | null;
  /** Days it was a contender in a game that was played. */
  playedDays: number;
  lastPlayed: string | null;
  /** Days the team went there. */
  wentDays: number;
  lastWent: string | null;
}

/** The numbers behind the suggestions. Scores are in stars, so each number reads
 *  as "worth this much rating". */
export const TUNING = {
  /** A rating counts as if it had 30 extra ratings of 4.2 (about the typical Google
   *  rating), so a 4.9 from 6 reviews does not beat a 4.6 from 2,000. */
  priorRating: 4.2,
  priorWeight: 30,
  /** Taken off at the edge of the radius; nearer places win close calls. */
  distance: 0.3,
  /** Never shown to the team and never played. */
  newBonus: 0.25,
  /** Taken off right after the team went there; halves about every 4 days. */
  wentPenalty: 0.8,
  wentDecayDays: 6,
  /** Per day it was a contender or the team went there, up to 4 such days. */
  likedStep: 0.06,
  likedMaxDays: 4,
  /** Per earlier day it was shown without ever being a contender. */
  skippedStep: 0.07,
  skippedMax: 0.35,
  /** Per list today that already showed it, so Filter again brings new places. */
  shownTodayStep: 0.3,
  shownTodayMax: 0.6,
  /** Per place of the same kind (Ramen, Pizza, ...) already on the list. */
  sameKind: 0.15,
  /** How random the draw is. Lower follows the scores more closely; at 0.25,
   *  a place scoring 0.25 more is about 2.7 times as likely to be drawn first. */
  temperature: 0.25,
  /** Lists with at least this many places get one place new for the team when there is one. */
  discoveryFrom: 4,
  /** Filter again keeps today's contenders and adds at least this many new places. */
  minFresh: 3,
} as const;

const DAY_MS = 86_400_000;
/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The team part of a place's score, and the label that explains it. */
export function teamScore(stat: PlaceStat | undefined, today: string): { delta: number; tag?: PlaceTag; isNew: boolean } {
  if (!stat || (!stat.shownToday && !stat.lastShown && !stat.playedDays && !stat.wentDays)) {
    return { delta: TUNING.newBonus, tag: { kind: "new", text: "New for the team" }, isNew: true };
  }
  let delta = 0;
  let tag: PlaceTag | undefined;
  const liked = stat.playedDays + stat.wentDays;
  if (liked > 0) delta += TUNING.likedStep * Math.min(liked, TUNING.likedMaxDays);
  else delta -= Math.min(TUNING.skippedStep * stat.shownDays, TUNING.skippedMax);
  delta -= Math.min(TUNING.shownTodayStep * stat.shownToday, TUNING.shownTodayMax);
  if (stat.lastWent) {
    const ago = Math.max(0, daysBetween(stat.lastWent, today));
    delta -= TUNING.wentPenalty * Math.exp(-ago / TUNING.wentDecayDays);
    if (ago <= 14) tag = { kind: "went", text: ago === 0 ? "Went today" : ago === 1 ? "Went yesterday" : `Went ${ago} days ago` };
    else tag = { kind: "liked", text: `Went here ${times(stat.wentDays)}` };
  } else if (stat.playedDays > 0) {
    tag = { kind: "liked", text: `Contender ${times(stat.playedDays)} before` };
  }
  return { delta, tag, isNew: false };
}

export interface PickOptions {
  /** Each place's history with the team, by place id. Missing places count as new. */
  stats?: Map<string, PlaceStat>;
  /** Places on the team's never-again list. */
  banned?: Set<string>;
  /** Today's contenders from the list before; kept at the top of the new list. */
  keep?: Suggestion[];
  /** Today, YYYY-MM-DD, to count days since the team went somewhere. */
  today?: string;
  /** Random numbers in [0, 1); fixed in tests. */
  rand?: () => number;
}

/** A draw from the Gumbel distribution. Adding it to score / temperature and taking
 *  the largest is the same as drawing places one by one, each with a chance in
 *  proportion to exp(score / temperature). */
function gumbel(rand: () => number): number {
  const u = Math.min(Math.max(rand(), 1e-12), 1 - 1e-12);
  return -Math.log(-Math.log(u));
}

/** Applies the fixed filters strictly, then draws the list:
 *  1. Every place that passes gets a score: its rating (adjusted for review count),
 *     less a little for distance, plus or minus its history with the team (new for
 *     the team, recently visited, often a contender, often shown and skipped,
 *     already shown today).
 *  2. Places are drawn one at a time at random, better scores being more likely;
 *     each place of the same kind already drawn makes the next one less likely.
 *  3. With 4 or more places, one is new for the team when there is one.
 *  Today's contenders from the list before stay at the top. */
export function pickLunch(cands: Candidate[], f: LunchFilters, origin: LatLng, opts: PickOptions = {}): { suggestions: Suggestion[]; summary: RunSummary } {
  const rand = opts.rand ?? Math.random;
  const banned = opts.banned ?? new Set<string>();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const unique = cands.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const fresh = new Map(unique.map((c) => [c.id, c]));

  const measure = (c: Candidate) => {
    const d = distanceM(origin, c.pos);
    const v = c.rating === null ? 0 : c.ratingCount;
    const adj = (v * (c.rating ?? 0) + TUNING.priorWeight * TUNING.priorRating) / (v + TUNING.priorWeight);
    return { d, adj, base: adj - TUNING.distance * (d / f.radiusM) };
  };

  // Today's contenders that still pass, with Google's latest details when found again.
  const kept: Suggestion[] = [];
  for (const k of opts.keep ?? []) {
    if (banned.has(k.id) || kept.some((x) => x.id === k.id)) continue;
    const now = fresh.get(k.id);
    const c: Candidate = now ? { ...now, photos: now.photos?.length ? now.photos : k.photos } : k;
    if (dropReason(c, f, origin)) continue;
    const { d, adj, base } = measure(c);
    kept.push({ ...c, rank: 0, distanceM: d, walkMin: walkMinutes(d), adjRating: adj, score: base, tag: k.tag });
  }
  const keptIds = new Set(kept.map((k) => k.id));

  const dropped: RunSummary["dropped"] = {};
  const pool: (Suggestion & { key: number; isNew: boolean })[] = [];
  for (const c of unique) {
    if (keptIds.has(c.id)) continue;
    const why = banned.has(c.id) ? "banned" : dropReason(c, f, origin);
    if (why) { dropped[why] = (dropped[why] ?? 0) + 1; continue; }
    const { d, adj, base } = measure(c);
    const team = teamScore(opts.stats?.get(c.id), today);
    const score = base + team.delta;
    pool.push({
      ...c, rank: 0, distanceM: d, walkMin: walkMinutes(d), adjRating: adj, score, tag: team.tag,
      isNew: team.isNew, key: gumbel(rand),
    });
  }
  // A fixed order before drawing, so the same random numbers give the same list.
  pool.sort((a, b) => a.id.localeCompare(b.id));

  const want = Math.min(pool.length, Math.max(f.count - kept.length, Math.min(f.count, TUNING.minFresh)));
  const drawn: typeof pool = [];
  const kinds = new Map<string, number>();
  for (const k of kept) kinds.set(k.type, (kinds.get(k.type) ?? 0) + 1);
  const left = new Set(pool);
  const value = (p: (typeof pool)[number]) => (p.score - TUNING.sameKind * (kinds.get(p.type) ?? 0)) / TUNING.temperature + p.key;
  while (drawn.length < want) {
    let best: (typeof pool)[number] | null = null;
    for (const p of left) if (!best || value(p) > value(best)) best = p;
    if (!best) break;
    drawn.push(best);
    left.delete(best);
    kinds.set(best.type, (kinds.get(best.type) ?? 0) + 1);
  }
  // One place new for the team, when the draw found none and there is one left.
  if (drawn.length >= TUNING.discoveryFrom && !drawn.some((p) => p.isNew)) {
    let pick: (typeof pool)[number] | null = null;
    for (const p of left) if (p.isNew && (!pick || p.score / TUNING.temperature + p.key > pick.score / TUNING.temperature + pick.key)) pick = p;
    if (pick) drawn[drawn.length - 1] = pick;
  }

  const suggestions = [...kept, ...drawn.map(({ key: _k, isNew: _n, ...s }) => s)].map((s, i) => ({ ...s, rank: i + 1 }));
  return { suggestions, summary: { found: unique.length, matched: pool.length + kept.length, dropped, kept: kept.length } };
}

/** A random spot at most half the radius from the center: the second search looks
 *  around it, so each Filter reaches a different part of the area. */
export function randomSpot(center: LatLng, radiusM: number, rand: () => number = Math.random): LatLng {
  const r = (radiusM / 2) * Math.sqrt(rand());
  const a = 2 * Math.PI * rand();
  const dLat = (r * Math.cos(a)) / 111_195;
  const dLng = (r * Math.sin(a)) / (111_195 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

/** Each Filter also searches one of these, so places a general search misses turn up. */
export const CUISINES = [
  "ramen", "pho", "banh mi", "sushi", "poke", "korean", "thai", "indian", "dumplings", "chinese",
  "shawarma", "falafel", "mediterranean", "greek", "tacos", "burrito", "burger", "pizza", "sandwich",
  "salad", "bagel", "vegetarian", "noodles", "bibimbap", "curry", "middle eastern", "portuguese chicken", "deli",
] as const;
export const pickCuisine = (rand: () => number = Math.random) => CUISINES[Math.floor(rand() * CUISINES.length) % CUISINES.length];

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
