// Where searches start from, and how to change it: type an address (Google
// suggestions), pick a spot on the map, or use this device's location.
import { useEffect, useRef, useState } from "react";
import { Clock, LocateFixed, MapPin, MousePointerClick, Search } from "lucide-react";
import { choosePlace, recentPlaces, switchToDevice, type Geo } from "../lib/geo.ts";
import { resolveAddress, suggestAddresses, type AddressHit } from "../lib/google.ts";
import { fmtDistance } from "../lib/lunch.ts";

export function WhereBar({ geo, ready, onPickOnMap }: { geo: Geo; ready: boolean; onPickOnMap: () => void }) {
  const [open, setOpen] = useState(false);
  // Location blocked and nothing chosen yet: open straight away.
  useEffect(() => { if (geo.status === "error" && !geo.pos) setOpen(true); }, [geo.status, geo.pos]);

  const label = geo.status === "locating" && !geo.manual ? "Finding your location…"
    : geo.source === "device" && geo.pos ? `Your location${geo.accuracyM ? ` (within ${fmtDistance(geo.accuracyM)})` : ""}`
    : geo.pos ? geo.label || "Chosen spot"
    : "Not set yet";

  return (
    <section className={`where${open ? " open" : ""}${!geo.pos ? " missing" : ""}`}>
      <button className="where-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MapPin size={18} aria-hidden="true" className="where-pin" />
        <span className="where-text"><span className="muted small">Searching around</span><b>{label}</b></span>
        <span className="where-change">{open ? "Close" : "Change"}</span>
      </button>
      {open && (
        <div className="where-body">
          {geo.error && !geo.manual && <p className="where-err">{geo.error}</p>}
          <AddressSearch near={geo.pos} disabled={!ready} onPicked={() => setOpen(false)} />
          <div className="where-actions">
            <button className="btn quiet small" disabled={!ready} onClick={() => { setOpen(false); onPickOnMap(); }}>
              <MousePointerClick size={15} aria-hidden="true" />Pick on the map
            </button>
            <button className="btn quiet small" disabled={geo.status === "locating"} onClick={() => { setOpen(false); void switchToDevice(); }}>
              <LocateFixed size={15} aria-hidden="true" />Use my device location
            </button>
          </div>
          <p className="hint">A typed address or map spot is remembered on this device.</p>
        </div>
      )}
    </section>
  );
}

function AddressSearch({ near, disabled, onPicked }: { near: Geo["pos"]; disabled: boolean; onPicked: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const recent = recentPlaces();

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3 || disabled) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      suggestAddresses(text, near).then((h) => { if (n === seq.current) { setHits(h); setActive(0); setError(""); } })
        .catch((e) => { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (h: AddressHit) => {
    setBusy(true); setError("");
    try {
      const { pos, label } = await resolveAddress(h);
      choosePlace(pos, label, "address");
      setQ(""); setHits([]);
      onPicked();
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
    <div className="addr">
      <label className="addr-box">
        <Search size={16} aria-hidden="true" />
        <input className="addr-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} disabled={disabled || busy}
          placeholder={disabled ? "The map has to load first" : "Type an address, e.g. your office"} aria-label="Address"
          role="combobox" aria-expanded={hits.length > 0} aria-controls="addr-list" aria-autocomplete="list" autoComplete="off" />
      </label>
      {error && <p className="where-err">{error}</p>}
      {hits.length > 0 && (
        <ul className="addr-list" id="addr-list" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => void pick(h)}>
                <b>{h.main}</b>{h.secondary && <span className="muted small">{h.secondary}</span>}
              </button>
            </li>
          ))}
          <li className="addr-credit muted small" aria-hidden="true">Suggestions from Google</li>
        </ul>
      )}
      {!q && recent.length > 0 && (
        <ul className="addr-list recent" aria-label="Recent addresses">
          {recent.map((r) => (
            <li key={r.label}>
              <button onClick={() => { choosePlace(r.pos, r.label, "address"); onPicked(); }}>
                <Clock size={14} aria-hidden="true" /><b>{r.label}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
