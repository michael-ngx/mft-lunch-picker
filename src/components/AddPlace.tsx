// Search Google for a place by name and add it to today's list for the team.
// Added places stay on the list through every Filter until 9 AM.
import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { resolvePlace, suggestPlaces, type AddressHit } from "../lib/google.ts";
import { addPlace } from "../lib/store.ts";
import { fmtDistance, type LatLng } from "../lib/lunch.ts";

type Hit = AddressHit & { distanceM: number | null };

export function AddPlace({ near, disabled, onAdded }: { near: LatLng | null; disabled: boolean; onAdded: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 || disabled) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      suggestPlaces(text, near).then((h) => { if (n === seq.current) { setHits(h); setActive(0); setError(""); } })
        .catch((e) => { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (h: Hit) => {
    setBusy(true); setError("");
    try {
      const c = await resolvePlace(h);
      await addPlace(c);
      setQ(""); setHits([]);
      onAdded(c.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); void pick(hits[active]); }
    else if (e.key === "Escape") { setHits([]); }
  };

  return (
    <section className="addp">
      <label className="addr-box">
        <Plus size={17} aria-hidden="true" />
        <input className="addr-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} disabled={disabled || busy}
          placeholder={disabled ? "The map has to load first" : busy ? "Adding…" : "Add a place to today's list"} aria-label="Add a place to today's list"
          role="combobox" aria-expanded={hits.length > 0} aria-controls="addp-list" aria-autocomplete="list" autoComplete="off" />
        <Search size={15} aria-hidden="true" />
      </label>
      {error && <p className="where-err">{error}</p>}
      {hits.length > 0 && (
        <ul className="addr-list" id="addp-list" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => void pick(h)}>
                <b>{h.main}</b>
                <span className="muted small">{[h.distanceM !== null ? fmtDistance(h.distanceM) : "", h.secondary].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
          <li className="addr-credit muted small" aria-hidden="true">Suggestions from Google</li>
        </ul>
      )}
    </section>
  );
}
