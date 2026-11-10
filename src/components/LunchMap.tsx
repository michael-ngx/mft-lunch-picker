// The Google map: your position, the search circle (follows the radius slider
// while you edit it), and one numbered pin per suggestion.
import { useEffect, useRef, useState } from "react";
import { loadMaps, mapsAuthFailed, onAuthFailure } from "../lib/google.ts";
import type { LatLng, Suggestion } from "../lib/lunch.ts";

const MONTREAL: LatLng = { lat: 45.5017, lng: -73.5673 };
const ACCENT = "#1d4ed8";

interface Gm {
  map: google.maps.Map;
  circle: google.maps.Circle;
  me: google.maps.marker.AdvancedMarkerElement;
  Marker: typeof google.maps.marker.AdvancedMarkerElement;
  pins: Map<string, google.maps.marker.AdvancedMarkerElement>;
}

export type MapStatus = "loading" | "ready" | "error" | "auth";

interface Props {
  apiKey: string;
  mapId: string;
  /** This device's position (the dot). */
  me: LatLng | null;
  /** Center of the search circle: your position, or where today's search was run from. */
  center: LatLng | null;
  radiusM: number;
  suggestions: Suggestion[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** When set, tapping the map calls this with the tapped spot. */
  onTap?: (pos: LatLng) => void;
  onStatus?: (s: MapStatus, error?: string) => void;
  /** Space covered by the floating list, kept clear when the map fits the circle. */
  padding?: { top: number; right: number; bottom: number; left: number };
}

function el(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

const NO_PAD = { top: 28, right: 28, bottom: 28, left: 28 };

export function LunchMap({ apiKey, mapId, me, center, radiusM, suggestions, selected, onSelect, onTap, onStatus, padding = NO_PAD }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const gm = useRef<Gm | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ me, center, radiusM, onSelect, onTap, onStatus, padding });
  latest.current = { me, center, radiusM, onSelect, onTap, onStatus, padding };

  // Load Google Maps and create the map once.
  useEffect(() => {
    let live = true;
    const report = (s: MapStatus, e?: string) => latest.current.onStatus?.(s, e);
    const off = onAuthFailure(() => { if (live) report("auth"); });
    if (mapsAuthFailed()) { report("auth"); return off; }
    report("loading");
    (async () => {
      await loadMaps(apiKey);
      const { Map, Circle } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
      const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
      if (!live || !box.current) return;
      const start = latest.current.center ?? latest.current.me ?? MONTREAL;
      const map = new Map(box.current, {
        center: start, zoom: 15, mapId: mapId || "DEMO_MAP_ID",
        disableDefaultUI: true, zoomControl: true, fullscreenControl: false, clickableIcons: false, gestureHandling: "greedy",
        // The bottom-right corner holds the Let's choose button.
        zoomControlOptions: { position: google.maps.ControlPosition?.RIGHT_CENTER },
      });
      const circle = new Circle({
        map: latest.current.center ? map : null, center: start, radius: latest.current.radiusM, clickable: false,
        strokeColor: ACCENT, strokeOpacity: 0.9, strokeWeight: 2, fillColor: ACCENT, fillOpacity: 0.07,
      });
      const meDot = new AdvancedMarkerElement({ map: latest.current.me ? map : null, position: latest.current.me ?? start, content: el("lp-me"), zIndex: 1000, title: "You are here" });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (e.latLng && latest.current.onTap) latest.current.onTap({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      gm.current = { map, circle, me: meDot, Marker: AdvancedMarkerElement, pins: new globalThis.Map() };
      if (latest.current.center) map.fitBounds(circle.getBounds()!, latest.current.padding);
      setReady(true);
      report("ready");
    })().catch((e) => { if (live) report("error", e instanceof Error ? e.message : String(e)); });
    return () => {
      live = false;
      off();
      gm.current?.pins.forEach((p) => (p.map = null));
      gm.current = null;
      setReady(false);
    };
  }, [apiKey, mapId]);

  // Your position.
  useEffect(() => {
    const g = gm.current;
    if (!g) return;
    if (me) { g.me.position = me; g.me.map = g.map; } else g.me.map = null;
  }, [ready, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // The circle; the view follows it while you edit the radius.
  useEffect(() => {
    const g = gm.current;
    if (!g) return;
    if (!center) { g.circle.setMap(null); return; }
    g.circle.setCenter(center);
    g.circle.setRadius(radiusM);
    g.circle.setMap(g.map);
    const t = setTimeout(() => { const b = g.circle.getBounds(); if (b) g.map.fitBounds(b, latest.current.padding); }, 90);
    return () => clearTimeout(t);
  }, [ready, center?.lat, center?.lng, radiusM, padding.left, padding.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  // One numbered pin per suggestion.
  useEffect(() => {
    const g = gm.current;
    if (!g) return;
    g.pins.forEach((p) => (p.map = null));
    g.pins.clear();
    for (const s of suggestions) {
      const pin = new g.Marker({ map: g.map, position: s.pos, content: el("lp-pin", String(s.rank)), title: `${s.rank}. ${s.name}`, zIndex: 100 - s.rank, gmpClickable: true });
      pin.addEventListener("gmp-click", () => latest.current.onSelect(s.id));
      g.pins.set(s.id, pin);
    }
  }, [ready, suggestions]);

  // The selected pin stands out and comes into view.
  useEffect(() => {
    const g = gm.current;
    if (!g) return;
    g.pins.forEach((p, id) => {
      const on = id === selected;
      (p.content as HTMLElement | null)?.classList.toggle("on", on);
      const s = suggestions.find((x) => x.id === id);
      p.zIndex = on ? 999 : 100 - (s?.rank ?? 50);
    });
    const s = suggestions.find((x) => x.id === selected);
    if (s && !g.map.getBounds()?.contains(s.pos)) g.map.panTo(s.pos);
  }, [ready, selected, suggestions]);

  return <div ref={box} className={`lp-map${onTap ? " tap" : ""}`} role="application" aria-label="Map of lunch suggestions" />;
}
