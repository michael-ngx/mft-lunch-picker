// Google Maps for the lunch picker: loading the Maps JavaScript API with the key
// from Settings, and searching nearby places with the Places API (New).

import { isOpenAt, pickCuisine, randomSpot, type Candidate, type HoursPeriod, type LatLng, type LunchFilters, type PlacePhoto } from "./lunch.ts";

declare global {
  interface Window {
    __hubMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loading: Promise<void> | null = null;
let loadedKey = "";
let authFailed = false;
const authListeners = new Set<() => void>();

/** The key the page loaded Maps with. Maps cannot switch keys without a reload. */
export const mapsKey = () => loadedKey;
export const mapsAuthFailed = () => authFailed;
export function onAuthFailure(fn: () => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/** Loads the Maps JavaScript API once per page. */
export function loadMaps(key: string): Promise<void> {
  if (loading) return loading;
  loadedKey = key;
  loading = new Promise<void>((resolve, reject) => {
    // Google calls this when the key is refused (wrong key, API not enabled, site not allowed).
    window.gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((fn) => fn());
    };
    window.__hubMapsReady = () => resolve();
    const s = document.createElement("script");
    const q = new URLSearchParams({ key, v: "weekly", loading: "async", callback: "__hubMapsReady", libraries: "maps,marker,places" });
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Could not load Google Maps. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

// Places of these types are searched; "restaurant" covers every kind of restaurant.
const TYPES = ["restaurant", "fast_food_restaurant", "sandwich_shop", "meal_takeaway"];
const FIELDS = [
  "id", "displayName", "location", "rating", "userRatingCount", "priceLevel", "priceRange",
  "regularOpeningHours", "utcOffsetMinutes", "businessStatus", "primaryTypeDisplayName", "shortFormattedAddress", "googleMapsURI", "photos",
];
const PHOTOS_PER_PLACE = 3;

const money = (m: google.maps.places.Money | null | undefined) => (m ? m.units + m.nanos / 1e9 : null);

/** Photo links for a place. Google bills each load of a photo link; when possible the
 *  link is swapped once, here, for the image's final address, which loads for free,
 *  so teammates opening the shared list don't add to the bill. */
async function photosOf(p: google.maps.places.Place): Promise<PlacePhoto[]> {
  const list = (p.photos ?? []).slice(0, PHOTOS_PER_PLACE);
  return Promise.all(list.map(async (ph) => {
    const author = ph.authorAttributions?.[0];
    let uri = ph.getURI({ maxWidth: 640, maxHeight: 480 });
    try {
      const u = new URL(uri);
      if (u.hostname === "places.googleapis.com" && u.pathname.endsWith("/media")) {
        u.searchParams.set("skipHttpRedirect", "true");
        const res = await fetch(u.toString());
        if (res.ok) {
          const j = (await res.json()) as { photoUri?: string };
          if (j.photoUri) uri = j.photoUri;
        }
      }
    } catch { /* keep the photo link as it is */ }
    return { uri, author: author?.displayName ?? "", authorUri: author?.uri ?? "" };
  }));
}

function toCandidate(p: google.maps.places.Place, now: number): Candidate | null {
  const loc = p.location;
  if (!loc) return null;
  const pr = p.priceRange;
  const start = money(pr?.startPrice);
  const periods = p.regularOpeningHours?.periods?.map((x): HoursPeriod => ({
    open: { day: x.open.day, hour: x.open.hour, minute: x.open.minute },
    close: x.close ? { day: x.close.day, hour: x.close.hour, minute: x.close.minute } : null,
  }));
  return {
    id: p.id,
    name: p.displayName ?? "Unnamed place",
    pos: { lat: loc.lat(), lng: loc.lng() },
    rating: typeof p.rating === "number" ? p.rating : null,
    ratingCount: p.userRatingCount ?? 0,
    price: pr && start !== null ? { start, end: money(pr.endPrice), currency: pr.startPrice.currencyCode } : null,
    priceLevel: p.priceLevel ?? null,
    openNow: isOpenAt(periods, p.utcOffsetMinutes, now),
    status: p.businessStatus ?? null,
    type: p.primaryTypeDisplayName ?? "",
    address: p.shortFormattedAddress ?? "",
    mapsUrl: p.googleMapsURI ?? "",
  };
}

/** A box around the circle, for Text Search (which takes only a rectangle). */
function boundsAround(c: LatLng, radiusM: number): google.maps.LatLngBoundsLiteral {
  const dLat = radiusM / 111_195;
  const dLng = radiusM / (111_195 * Math.cos((c.lat * Math.PI) / 180));
  return { north: c.lat + dLat, south: c.lat - dLat, east: c.lng + dLng, west: c.lng - dLng };
}

/** Four searches around the location, merged. Each returns at most 20 places,
 *  and the fixed filters are applied afterwards.
 *  1. The most popular places in the whole radius.
 *  2. The closest places to a random spot inside the radius, so each Filter
 *     reaches a different part of the area.
 *  3. Google's best matches for "lunch" at the minimum rating.
 *  4. One cuisine, different each time (ramen, tacos, pho, ...). */
export interface SearchResult { candidates: Candidate[]; places: Map<string, google.maps.places.Place>; cuisine: string }

export async function searchLunch(origin: LatLng, f: LunchFilters, rand: () => number = Math.random): Promise<SearchResult> {
  const { Place } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  const spot = randomSpot(origin, f.radiusM, rand);
  const cuisine = pickCuisine(rand);
  const text = (textQuery: string) => Place.searchByText({
    fields: FIELDS, textQuery, locationRestriction: boundsAround(origin, f.radiusM), maxResultCount: 20,
    // Google rounds the minimum up to the next 0.5, so ask for the 0.5 below and filter exactly here.
    ...(f.minRating > 0 ? { minRating: Math.floor(f.minRating * 2) / 2 } : {}),
    ...(f.openNow ? { isOpenNow: true } : {}),
  });
  const searches: Promise<{ places: google.maps.places.Place[] }>[] = [
    Place.searchNearby({ fields: FIELDS, locationRestriction: { center: origin, radius: f.radiusM }, includedTypes: TYPES, maxResultCount: 20, rankPreference: "POPULARITY" }),
    Place.searchNearby({ fields: FIELDS, locationRestriction: { center: spot, radius: f.radiusM / 2 }, includedTypes: TYPES, maxResultCount: 20, rankPreference: "DISTANCE" }),
    text("lunch"),
    text(`${cuisine} restaurant`),
  ];
  const settled = await Promise.allSettled(searches);
  const ok = settled.filter((r): r is PromiseFulfilledResult<{ places: google.maps.places.Place[] }> => r.status === "fulfilled");
  if (!ok.length) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(explain(first?.reason));
  }
  const now = Date.now();
  const places = new Map<string, google.maps.places.Place>();
  for (const r of ok) for (const p of r.value.places) if (!places.has(p.id)) places.set(p.id, p);
  const candidates = [...places.values()].map((p) => toCandidate(p, now)).filter((c): c is Candidate => !!c);
  return { candidates, places, cuisine };
}

// The places found by the last search, so Random pick can draw from them without
// searching again. Kept for 20 minutes for the same spot and filters.
let pool: { key: string; at: number; result: SearchResult } | null = null;
const poolKey = (o: LatLng, f: LunchFilters) => [o.lat.toFixed(4), o.lng.toFixed(4), f.radiusM, f.minRating, f.openNow].join("|");
export function rememberPool(origin: LatLng, f: LunchFilters, result: SearchResult) {
  pool = { key: poolKey(origin, f), at: Date.now(), result };
}
/** The places around a spot: the last search's when it is recent and for the same spot and filters, else a new search. */
export async function areaPool(origin: LatLng, f: LunchFilters): Promise<SearchResult> {
  if (pool && pool.key === poolKey(origin, f) && Date.now() - pool.at < 20 * 60_000) return pool.result;
  const result = await searchLunch(origin, f);
  rememberPool(origin, f, result);
  return result;
}

/** Adds photos to the places that made the list (only those, to keep Google costs
 *  down). Places that already have photos, such as kept contenders, keep them. */
export async function withPhotos<T extends Candidate>(list: T[], places: SearchResult["places"]): Promise<T[]> {
  return Promise.all(list.map(async (s) => {
    if (s.photos?.length) return s;
    const place = places.get(s.id);
    const photos = place ? await photosOf(place).catch(() => [] as PlacePhoto[]) : [];
    return { ...s, photos };
  }));
}

// ---------- address search ----------

export interface AddressHit { id: string; main: string; secondary: string; prediction: google.maps.places.PlacePrediction }

const MONTREAL: LatLng = { lat: 45.5017, lng: -73.5673 };
// One session per search: suggestions while typing, then the details of the chosen one.
let session: google.maps.places.AutocompleteSessionToken | null = null;

/** Google's address suggestions for what has been typed, closest to `near` first. */
export async function suggestAddresses(input: string, near: LatLng | null): Promise<AddressHit[]> {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  if (!session) session = new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input, sessionToken: session, locationBias: { center: near ?? MONTREAL, radius: 30_000 },
  });
  return suggestions
    .map((x) => x.placePrediction)
    .filter((p): p is google.maps.places.PlacePrediction => !!p)
    .map((p) => ({ id: p.placeId, main: p.mainText?.text ?? p.text.text, secondary: p.secondaryText?.text ?? "", prediction: p }));
}

// A separate session for searching places to add to the list.
let placeSession: google.maps.places.AutocompleteSessionToken | null = null;

/** Google's suggestions for a place name, closest to `near` first, with their distance from it. */
export async function suggestPlaces(input: string, near: LatLng | null): Promise<(AddressHit & { distanceM: number | null })[]> {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  if (!placeSession) placeSession = new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input, sessionToken: placeSession, locationBias: { center: near ?? MONTREAL, radius: 5_000 }, ...(near ? { origin: near } : {}),
  });
  return suggestions
    .map((x) => x.placePrediction)
    .filter((p): p is google.maps.places.PlacePrediction => !!p)
    .map((p) => ({ id: p.placeId, main: p.mainText?.text ?? p.text.text, secondary: p.secondaryText?.text ?? "", prediction: p, distanceM: p.distanceMeters ?? null }));
}

/** The details and photos of a chosen place, ready to add to the list. */
export async function resolvePlace(hit: AddressHit): Promise<Candidate> {
  const place = hit.prediction.toPlace();
  await place.fetchFields({ fields: FIELDS });
  placeSession = null;
  const c = toCandidate(place, Date.now());
  if (!c) throw new Error("Google has no position for that place. Try another one.");
  const photos = await photosOf(place).catch(() => [] as PlacePhoto[]);
  return { ...c, photos };
}

/** The position and a short label for a chosen suggestion. */
export async function resolveAddress(hit: AddressHit): Promise<{ pos: LatLng; label: string }> {
  const place = hit.prediction.toPlace();
  await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
  session = null;
  if (!place.location) throw new Error("Google has no position for that address. Try another one.");
  return { pos: { lat: place.location.lat(), lng: place.location.lng() }, label: hit.main || place.formattedAddress || place.displayName || "Chosen address" };
}

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  if (/PERMISSION_DENIED|not authorized|API_KEY|has not been used|disabled/i.test(msg))
    return `Google refused the search. Check that Places API (New) is enabled for your key and allowed in its API restrictions. (${msg})`;
  return `The search failed: ${msg}`;
}
