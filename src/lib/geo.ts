// Where searches start from: this device's location, an address typed in, or a
// spot tapped on the map. A chosen address or spot is remembered on this device,
// so a computer that never shares its location doesn't have to ask again.

import { create } from "zustand";
import type { LatLng } from "./lunch.ts";

export type Source = "device" | "address" | "map";

export interface Geo {
  status: "idle" | "locating" | "ok" | "error";
  pos: LatLng | null;
  accuracyM: number | null;
  at: number | null;
  /** True when the place was chosen (address or map), not read from the device. */
  manual: boolean;
  source: Source | null;
  /** The address or "Spot on the map" for a chosen place. */
  label: string;
  error: string;
}

export interface SavedPlace { pos: LatLng; label: string; source: "address" | "map" }

const SAVED = "mft-lunch-place";
const RECENT = "mft-lunch-recent";

function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const saved = read<SavedPlace>(SAVED);

export const useGeo = create<Geo>(() => saved
  ? { status: "ok", pos: saved.pos, accuracyM: null, at: Date.now(), manual: true, source: saved.source, label: saved.label, error: "" }
  : { status: "idle", pos: null, accuracyM: null, at: null, manual: false, source: null, label: "", error: "" });
const set = useGeo.setState;
const get = useGeo.getState;

function geoError(e: GeolocationPositionError): string {
  if (e.code === 1) return "This device doesn't share its location. Type an address or pick a spot on the map.";
  if (e.code === 3) return "Finding your location took too long. Try again, type an address, or pick a spot on the map.";
  return "Your location is not available right now. Type an address or pick a spot on the map.";
}

let locating: Promise<LatLng | null> | null = null;

/** Asks the device where it is. Returns null when it cannot. */
export function locate(): Promise<LatLng | null> {
  if (locating) return locating;
  if (!("geolocation" in navigator)) {
    set({ status: "error", error: "This browser cannot share its location. Type an address or pick a spot on the map." });
    return Promise.resolve(null);
  }
  set({ status: "locating", error: "" });
  locating = new Promise<LatLng | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        set({ status: "ok", pos, accuracyM: p.coords.accuracy ?? null, at: Date.now(), manual: false, source: "device", label: "", error: "" });
        resolve(pos);
      },
      (e) => {
        set((s) => ({ status: s.pos ? "ok" : "error", error: geoError(e) }));
        resolve(get().pos);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }).finally(() => { locating = null; });
  return locating;
}

/** Uses an address or a map spot, and remembers it on this device. */
export function choosePlace(pos: LatLng, label: string, source: "address" | "map") {
  set({ status: "ok", pos, accuracyM: null, at: Date.now(), manual: true, source, label, error: "" });
  write(SAVED, { pos, label, source });
  if (source === "address") {
    const recent = (read<SavedPlace[]>(RECENT) ?? []).filter((r) => r.label !== label);
    write(RECENT, [{ pos, label, source }, ...recent].slice(0, 4));
  }
}

/** Goes back to the device's own location and forgets the chosen place. */
export function switchToDevice(): Promise<LatLng | null> {
  write(SAVED, null);
  set({ status: "idle", pos: null, accuracyM: null, at: null, manual: false, source: null, label: "", error: "" });
  return locate();
}

export const recentPlaces = (): SavedPlace[] => read<SavedPlace[]>(RECENT) ?? [];

/** A location for a search: a chosen place as it is; the device's, refreshed when over 2 minutes old. */
export async function freshPosition(): Promise<LatLng | null> {
  const g = get();
  if (g.manual && g.pos) return g.pos;
  if (g.pos && g.at && Date.now() - g.at < 120_000) return g.pos;
  return locate();
}
