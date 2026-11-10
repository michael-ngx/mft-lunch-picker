// Where this device is. Kept outside React so it survives page changes.

import { create } from "zustand";
import type { LatLng } from "./lunch.ts";

export interface Geo {
  status: "idle" | "locating" | "ok" | "error";
  pos: LatLng | null;
  accuracyM: number | null;
  at: number | null;
  /** Set by tapping the map, because the device location was unavailable. */
  manual: boolean;
  error: string;
}

export const useGeo = create<Geo>(() => ({ status: "idle", pos: null, accuracyM: null, at: null, manual: false, error: "" }));
const set = useGeo.setState;
const get = useGeo.getState;

function geoError(e: GeolocationPositionError): string {
  if (e.code === 1) return "Location is blocked for this site. Allow it in your browser's site settings, or tap the map to set where you are.";
  if (e.code === 3) return "Finding your location took too long. Try again, or tap the map to set where you are.";
  return "Your location is not available right now. Try again, or tap the map to set where you are.";
}

let locating: Promise<LatLng | null> | null = null;

/** Asks the device where it is. Returns null when it cannot. */
export function locate(): Promise<LatLng | null> {
  if (locating) return locating;
  if (!("geolocation" in navigator)) {
    set({ status: "error", error: "This browser cannot share its location. Tap the map to set where you are." });
    return Promise.resolve(null);
  }
  set({ status: "locating", error: "" });
  locating = new Promise<LatLng | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        set({ status: "ok", pos, accuracyM: p.coords.accuracy ?? null, at: Date.now(), manual: false, error: "" });
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

export function setManualPosition(pos: LatLng) {
  set({ status: "ok", pos, accuracyM: null, at: Date.now(), manual: true, error: "" });
}

/** A location for a search: refreshed when the last fix is over 2 minutes old. */
export async function freshPosition(): Promise<LatLng | null> {
  const g = get();
  if (g.manual && g.pos) return g.pos;
  if (g.pos && g.at && Date.now() - g.at < 120_000) return g.pos;
  return locate();
}
