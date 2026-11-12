// Every suggestion passes every fixed filter, and the ranking.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS, budgetPhrase, distanceM, dropReason, fmtBudget, fmtDistance, fmtPrice, isOpenAt, normalizeFilters, pickLunch, priceFits,
  randomPlace, randomSpot, teamScore,
  type Candidate, type LatLng, type LunchFilters, type PickOptions, type PlaceStat,
} from "../src/lib/lunch.ts";

const HOME: LatLng = { lat: 45.5017, lng: -73.5673 }; // Montréal
/** A point d meters north of HOME. */
const north = (d: number): LatLng => ({ lat: HOME.lat + d / 111_195, lng: HOME.lng });

function place(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id, name: id, pos: north(300), rating: 4.5, ratingCount: 500,
    price: { start: 10, end: 20, currency: "CAD" }, priceLevel: null, openNow: true, status: "OPERATIONAL",
    type: "Restaurant", address: "", mapsUrl: "", ...over,
  };
}

/** Seeded random numbers, so every run of the tests draws the same lists. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Every random draw equal: the list then follows the scores exactly. */
const FLAT: PickOptions = { rand: () => 0.5, today: "2026-11-11" };
const TODAY = "2026-11-11";
const stat = (over: Partial<PlaceStat> = {}): PlaceStat => ({
  shownToday: 0, shownDays: 0, lastShown: null, passedDays: 0, playedDays: 0, lastPlayed: null, wentDays: 0, lastWent: null, ...over,
});

const F: LunchFilters = { ...DEFAULT_FILTERS, bands: ["10-20", "20-30"], radiusM: 1000, minRating: 4.2, count: 5, openNow: true, allowNoPrice: false };

describe("team filters", () => {
  it("fills defaults and clamps stored values", () => {
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({})).toEqual(DEFAULT_FILTERS);
    const f = normalizeFilters({ radiusM: 99_999, minRating: 7, count: 0, bands: ["100+", "bogus", "1-10"] });
    expect(f.radiusM).toBe(5000);
    expect(f.minRating).toBe(4.9);
    expect(f.count).toBe(1);
    expect(f.bands).toEqual(["1-10", "100+"]);
  });
  it("keeps an empty budget as any price", () => {
    expect(normalizeFilters({ bands: [] }).bands).toEqual([]);
    expect(fmtBudget([])).toBe("Any price");
  });
});

describe("budget", () => {
  it("needs the whole Google range inside the selected bands", () => {
    expect(priceFits({ start: 10, end: 20, currency: "CAD" }, ["10-20"])).toBe(true);
    expect(priceFits({ start: 20, end: 30, currency: "CAD" }, ["10-20"])).toBe(false);
    expect(priceFits({ start: 15, end: 25, currency: "CAD" }, ["10-20"])).toBe(false);
  });
  it("joins neighbouring bands", () => {
    expect(priceFits({ start: 15, end: 25, currency: "CAD" }, ["10-20", "20-30"])).toBe(true);
    expect(priceFits({ start: 15, end: 25, currency: "CAD" }, ["10-20", "30-50"])).toBe(false);
    expect(fmtBudget(["1-10", "10-20", "50-100"])).toBe("Up to $20, $50–100");
    expect(budgetPhrase(["1-10", "10-20", "20-30"])).toBe("$30 or less");
    expect(budgetPhrase(["30-50", "50-100", "100+"])).toBe("$30 or more");
  });
  it("lets an open-ended range ($100+) through only the open-ended band", () => {
    expect(priceFits({ start: 100, end: null, currency: "CAD" }, ["50-100"])).toBe(false);
    expect(priceFits({ start: 100, end: null, currency: "CAD" }, ["100+"])).toBe(true);
    expect(priceFits({ start: 1, end: 10, currency: "CAD" }, ["1-10"])).toBe(true);
  });
  it("drops places with no price range unless allowed", () => {
    const c = place("x", { price: null });
    expect(dropReason(c, F, HOME)).toBe("noPrice");
    expect(dropReason(c, { ...F, allowNoPrice: true }, HOME)).toBeNull();
    expect(dropReason(c, { ...F, bands: [] }, HOME)).toBeNull();
  });
});

describe("opening hours", () => {
  // Mon–Fri 11:00–15:00 in Montréal (UTC−5 in November).
  const lunchOnly = [1, 2, 3, 4, 5].map((day) => ({ open: { day, hour: 11, minute: 0 }, close: { day, hour: 15, minute: 0 } }));
  const at = (iso: string) => Date.parse(iso);
  it("reads the place's local time from its UTC offset", () => {
    expect(isOpenAt(lunchOnly, -300, at("2026-11-09T17:00:00Z"))).toBe(true); // Monday noon
    expect(isOpenAt(lunchOnly, -300, at("2026-11-09T21:00:00Z"))).toBe(false); // Monday 4 pm
    expect(isOpenAt(lunchOnly, -300, at("2026-11-08T17:00:00Z"))).toBe(false); // Sunday noon
  });
  it("handles periods past midnight and across the end of the week", () => {
    const late = [{ open: { day: 6, hour: 18, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }];
    expect(isOpenAt(late, 0, at("2026-11-08T01:00:00Z"))).toBe(true); // Sunday 1 am
    expect(isOpenAt(late, 0, at("2026-11-07T19:00:00Z"))).toBe(true); // Saturday 7 pm
    expect(isOpenAt(late, 0, at("2026-11-08T03:00:00Z"))).toBe(false);
  });
  it("treats one period with no close as always open, and no hours as unknown", () => {
    expect(isOpenAt([{ open: { day: 0, hour: 0, minute: 0 } }], -300, Date.now())).toBe(true);
    expect(isOpenAt([], -300, Date.now())).toBeNull();
    expect(isOpenAt(lunchOnly, null, Date.now())).toBeNull();
  });
});

describe("picking", () => {
  it("never suggests a place that breaks a fixed filter", () => {
    const cands = [
      place("ok"),
      place("far", { pos: north(1500) }),
      place("low", { rating: 4.1 }),
      place("unrated", { rating: null, ratingCount: 0 }),
      place("pricey", { price: { start: 30, end: 50, currency: "CAD" } }),
      place("closed", { openNow: false }),
      place("gone", { status: "CLOSED_PERMANENTLY" }),
      place("hours-unknown", { openNow: null }),
    ];
    const { suggestions, summary } = pickLunch(cands, F, HOME, FLAT);
    expect(suggestions.map((s) => s.id).sort()).toEqual(["hours-unknown", "ok"]);
    expect(summary).toEqual({ found: 8, matched: 2, kept: 0, dropped: { far: 1, rating: 2, budget: 1, closedNow: 1, closedForGood: 1 } });
    for (const s of suggestions) {
      expect(distanceM(HOME, s.pos)).toBeLessThanOrEqual(F.radiusM);
      expect(s.rating!).toBeGreaterThanOrEqual(F.minRating);
    }
  });
  it("keeps closed places when open now is off", () => {
    expect(pickLunch([place("closed", { openNow: false })], { ...F, openNow: false }, HOME, FLAT).suggestions).toHaveLength(1);
  });
  it("returns at most the number asked for, ranked 1..n", () => {
    const cands = Array.from({ length: 12 }, (_, i) => place(`p${i}`, { rating: 4.3 + i * 0.05 }));
    const { suggestions } = pickLunch(cands, F, HOME, FLAT);
    expect(suggestions).toHaveLength(5);
    expect(suggestions.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(suggestions[0].id).toBe("p11");
  });
  it("trusts a rating more when it rests on more reviews", () => {
    const few = place("few", { rating: 4.9, ratingCount: 6 });
    const many = place("many", { rating: 4.6, ratingCount: 2400 });
    const avg = place("avg", { rating: 4.3, ratingCount: 300 });
    expect(pickLunch([few, many, avg], F, HOME, FLAT).suggestions[0].id).toBe("many");
  });
  it("lets the nearer place win a close call", () => {
    const near = place("near", { rating: 4.5, pos: north(100) });
    const edge = place("edge", { rating: 4.55, pos: north(950) });
    expect(pickLunch([edge, near], F, HOME, FLAT).suggestions[0].id).toBe("near");
  });
  it("counts a place found by two searches once", () => {
    const { summary } = pickLunch([place("a"), place("a"), place("b")], F, HOME, FLAT);
    expect(summary.found).toBe(2);
  });
});

describe("suggestions vary", () => {
  const twelve = () => Array.from({ length: 12 }, (_, i) => place(`p${i}`, { rating: 4.3 + i * 0.03, type: `Kind${i}` }));
  const ids = (o: PickOptions, cands = twelve(), f = F) => pickLunch(cands, f, HOME, { today: TODAY, ...o }).suggestions.map((s) => s.id);

  it("draws a different list on different runs, and the same list from the same random numbers", () => {
    const lists = new Set(Array.from({ length: 20 }, (_, i) => ids({ rand: seeded(i + 1) }).join(",")));
    expect(lists.size).toBeGreaterThan(10);
    expect(ids({ rand: seeded(7) })).toEqual(ids({ rand: seeded(7) }));
  });

  it("draws better-scored places more often", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) for (const id of ids({ rand: seeded(i + 100) })) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.get("p11")!).toBeGreaterThan(counts.get("p0")! * 1.5);
    // Even the lowest score still turns up now and then.
    expect(counts.get("p0")!).toBeGreaterThan(20);
  });

  it("never suggests a place on the never-again list", () => {
    for (let i = 0; i < 50; i++) expect(ids({ rand: seeded(i), banned: new Set(["p11", "p10"]) })).not.toContain("p11");
    const { summary } = pickLunch(twelve(), F, HOME, { ...FLAT, banned: new Set(["p11"]) });
    expect(summary.dropped.banned).toBe(1);
  });

  it("rarely suggests a place the team just went to", () => {
    const a = place("yesterday", { rating: 4.6, type: "A" });
    const b = place("other", { rating: 4.6, type: "B" });
    const stats = new Map([["yesterday", stat({ wentDays: 1, lastWent: "2026-11-10", playedDays: 1, lastPlayed: "2026-11-10", lastShown: "2026-11-10", shownDays: 1 })]]);
    let picked = 0;
    for (let i = 0; i < 500; i++) if (ids({ rand: seeded(i), stats }, [a, b], { ...F, count: 1 })[0] === "yesterday") picked++;
    expect(picked / 500).toBeLessThan(0.15);
  });

  it("lets a favourite come back once the last visit is a few weeks old", () => {
    const fav = place("fav", { rating: 4.6, type: "A" });
    const other = place("other", { rating: 4.6, type: "B" });
    const stats = new Map([
      ["fav", stat({ wentDays: 3, lastWent: "2026-10-14", playedDays: 4, lastPlayed: "2026-10-14", lastShown: "2026-10-14" })],
      ["other", stat({ shownDays: 0, lastShown: "2026-10-01" })],
    ]);
    expect(pickLunch([fav, other], { ...F, count: 1 }, HOME, { ...FLAT, stats }).suggestions[0].id).toBe("fav");
  });

  it("brings mostly new places when Filter is pressed again the same day", () => {
    const stats = new Map(["p11", "p10", "p9", "p8", "p7"].map((id) => [id, stat({ shownToday: 1, lastShown: null })]));
    let repeats = 0;
    for (let i = 0; i < 200; i++) repeats += ids({ rand: seeded(i), stats }).filter((id) => stats.has(id)).length;
    expect(repeats / 200).toBeLessThan(1.5); // of 5 places, fewer than 1.5 from the list before, on average
  });

  it("fades out places shown on many days but never chosen", () => {
    const a = place("skipped", { rating: 4.6, type: "A" });
    const b = place("unseen", { rating: 4.5, type: "B" });
    const stats = new Map([["skipped", stat({ shownDays: 5, passedDays: 5, lastShown: "2026-11-10" })]]);
    expect(pickLunch([a, b], { ...F, count: 1 }, HOME, { ...FLAT, stats }).suggestions[0].id).toBe("unseen");
  });

  it("takes a little off for each day a place was shown but not a contender, even a favourite", () => {
    const base = stat({ playedDays: 2, lastPlayed: "2026-10-20", lastShown: "2026-11-10", shownDays: 4 });
    const chosen = teamScore({ ...base, passedDays: 0 }, TODAY).delta;
    const passed2 = teamScore({ ...base, passedDays: 2 }, TODAY).delta;
    const passed9 = teamScore({ ...base, passedDays: 9 }, TODAY).delta;
    expect(chosen - passed2).toBeCloseTo(0.12);
    expect(chosen - passed9).toBeCloseTo(0.3); // capped
  });

  it("leaves out places marked Not today and places added by hand", () => {
    const { suggestions, summary } = pickLunch(twelve(), F, HOME, { ...FLAT, skipped: new Set(["p11"]), pinned: new Set(["p10"]) });
    expect(suggestions.map((s) => s.id)).not.toContain("p11");
    expect(suggestions.map((s) => s.id)).not.toContain("p10");
    expect(summary.dropped.notToday).toBe(1);
    // A contender marked Not today is not kept either.
    const first = pickLunch(twelve(), F, HOME, FLAT).suggestions;
    const again = pickLunch(twelve(), F, HOME, { ...FLAT, keep: [first[0]], skipped: new Set([first[0].id]) }).suggestions;
    expect(again.map((s) => s.id)).not.toContain(first[0].id);
  });

  it("picks a random place that passes the filters, never a banned or Not today one", () => {
    const cands = [...twelve(), place("far", { pos: north(1500) })];
    const banned = new Set(["p0", "p1"]);
    const skipped = new Set(["p2"]);
    const counts = new Map<string, number>();
    const rand = seeded(5);
    for (let i = 0; i < 900; i++) {
      const p = randomPlace(cands, F, HOME, { banned, skipped, rand })!;
      counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["p10", "p11", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
    for (const n of counts.values()) expect(n).toBeGreaterThan(60); // about 100 each: the same chance for all
    // Recent picks are left out until the rest have had a turn.
    const avoid = new Set(["p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"]);
    expect(randomPlace(cands, F, HOME, { banned, skipped, avoid, rand })!.id).toBe("p11");
    expect(randomPlace([], F, HOME)).toBeNull();
  });

  it("mixes kinds of food instead of filling the list with one", () => {
    const pizza = Array.from({ length: 6 }, (_, i) => place(`pizza${i}`, { rating: 4.6, type: "Pizza" }));
    const other = Array.from({ length: 6 }, (_, i) => place(`other${i}`, { rating: 4.5, type: `Kind${i}` }));
    const list = pickLunch([...pizza, ...other], { ...F, count: 4 }, HOME, FLAT).suggestions;
    expect(list.filter((s) => s.type === "Pizza").length).toBeLessThanOrEqual(2);
  });

  it("puts one place new for the team on a list of 4 or more", () => {
    const known = Array.from({ length: 8 }, (_, i) => place(`k${i}`, { rating: 4.7, type: `Kind${i}` }));
    const fresh = place("fresh", { rating: 4.2, ratingCount: 40, type: "Other" });
    const stats = new Map(known.map((k) => [k.id, stat({ playedDays: 2, lastPlayed: "2026-11-01", lastShown: "2026-11-01" })]));
    for (let i = 0; i < 30; i++) expect(ids({ rand: seeded(i), stats }, [...known, fresh])).toContain("fresh");
  });

  it("keeps today's contenders at the top and adds new places", () => {
    const first = pickLunch(twelve(), F, HOME, FLAT).suggestions;
    const keep = [first[2], first[4]];
    const again = pickLunch(twelve(), F, HOME, { ...FLAT, keep, stats: new Map(first.map((s) => [s.id, stat({ shownToday: 1 })])) }).suggestions;
    expect(again.slice(0, 2).map((s) => s.id)).toEqual([first[2].id, first[4].id]);
    expect(again).toHaveLength(F.count);
    expect(again.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    // Many contenders: still at least 3 new places.
    const many = pickLunch(twelve(), F, HOME, { ...FLAT, keep: first }).suggestions;
    expect(many).toHaveLength(F.count + 3);
    // A contender that was put on the never-again list, or no longer fits the filters, is dropped.
    const banned = pickLunch(twelve(), F, HOME, { ...FLAT, keep, banned: new Set([first[2].id]) }).suggestions;
    expect(banned.map((s) => s.id)).not.toContain(first[2].id);
    const tight = pickLunch(twelve(), { ...F, radiusM: 200 }, HOME, { ...FLAT, keep }).suggestions;
    expect(tight).toHaveLength(0);
  });

  it("explains each place with a label", () => {
    expect(teamScore(undefined, TODAY).tag?.text).toBe("New for the team");
    expect(teamScore(stat({ wentDays: 1, lastWent: "2026-11-11" }), TODAY).tag?.text).toBe("Went today");
    expect(teamScore(stat({ wentDays: 1, lastWent: "2026-11-10" }), TODAY).tag?.text).toBe("Went yesterday");
    expect(teamScore(stat({ wentDays: 2, lastWent: "2026-11-06" }), TODAY).tag?.text).toBe("Went 5 days ago");
    expect(teamScore(stat({ wentDays: 2, lastWent: "2026-10-01" }), TODAY).tag?.text).toBe("Went here 2 times");
    expect(teamScore(stat({ playedDays: 3, lastPlayed: "2026-11-01" }), TODAY).tag?.text).toBe("Contender 3 times before");
    expect(teamScore(stat({ shownDays: 2, lastShown: "2026-11-09" }), TODAY).tag).toBeUndefined();
  });

  it("searches around a spot inside half the radius", () => {
    const rand = seeded(3);
    for (let i = 0; i < 200; i++) expect(distanceM(HOME, randomSpot(HOME, 1000, rand))).toBeLessThanOrEqual(500.5);
  });
});

describe("display", () => {
  it("formats distance and price", () => {
    expect(fmtDistance(437)).toBe("440 m");
    expect(fmtDistance(1250)).toBe("1.3 km");
    expect(fmtPrice({ start: 10, end: 20, currency: "CAD" })).toBe("$10–20");
    expect(fmtPrice({ start: 100, end: null, currency: "CAD" })).toBe("$100+");
    expect(fmtPrice({ start: 20, end: 30, currency: "EUR" })).toBe("€20–30");
  });
});
