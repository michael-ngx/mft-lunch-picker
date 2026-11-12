// Random pick: one place from around the search spot, chosen at random among
// those that pass the team filters (never a never-again or Not today place).
// Only you see it; it changes nothing for the team unless you add it to the list.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Plus, Shuffle, X } from "lucide-react";
import { areaPool, withPhotos } from "../lib/google.ts";
import { addPlace } from "../lib/store.ts";
import { asSuggestion, randomPlace, type Candidate, type LatLng, type LunchFilters, type Suggestion } from "../lib/lunch.ts";
import { PhotoStrip } from "./Photos.tsx";
import { RatingLine, WalkLine } from "./Bits.tsx";

// Photos already fetched in this visit, by place id.
const photoCache = new Map<string, Suggestion["photos"]>();

export function RandomPick({ origin, filters, banned, skipped, onList, extra, onClose }: {
  origin: LatLng; filters: LunchFilters; banned: Set<string>; skipped: Set<string>;
  /** Places already on today's list. */
  onList: Set<string>;
  /** Places added by hand, which can be picked too. */
  extra: Candidate[];
  onClose: () => void;
}) {
  const [place, setPlace] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<"no" | "adding" | "yes">("no");
  const avoid = useRef(new Set<string>());
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const pick = useCallback(async () => {
    setBusy(true); setError(""); setAdded("no");
    try {
      const pool = await areaPool(origin, filters);
      const c = randomPlace(pool.candidates, filters, origin, { banned, skipped, avoid: avoid.current, extra });
      if (!c) { setPlace(null); setError("No place around passes the team filters. Try a larger radius or a wider budget."); return; }
      avoid.current.add(c.id);
      let photos = c.photos?.length ? c.photos : photoCache.get(c.id);
      if (!photos) {
        photos = (await withPhotos([c], pool.places))[0].photos ?? [];
        photoCache.set(c.id, photos);
      }
      setPlace(asSuggestion({ ...c, photos }, origin));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [origin, filters, banned, skipped, extra]);

  useEffect(() => { void pick(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const add = async () => {
    if (!place) return;
    setAdded("adding");
    try {
      const { rank: _r, distanceM: _d, walkMin: _w, adjRating: _a, score: _s, tag: _t, ...c } = place;
      await addPlace(c);
      setAdded("yes");
    } catch (e) {
      setAdded("no");
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const already = !!place && onList.has(place.id);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rp-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
        {place ? <PhotoStrip key={place.id} photos={place.photos} label={place.name} size="lg" /> : <div className="rp-blank">{busy && <span className="loading-dots"><i /><i /><i /></span>}</div>}
        <div className="modal-body">
          <p className="eyebrow">Random pick</p>
          {place ? (
            <>
              <h2 id="rp-title">{place.name}</h2>
              <RatingLine s={place} />
              <WalkLine s={place} />
              {place.address && <p className="muted small">{place.address}</p>}
            </>
          ) : <h2 id="rp-title">{busy ? "Picking…" : "Nothing to pick"}</h2>}
          {error && <div className="alert err">{error}</div>}
          <div className="modal-actions">
            <button className="btn" onClick={() => void pick()} disabled={busy}><Shuffle size={15} aria-hidden="true" />{busy ? "Picking…" : "Pick another"}</button>
            {place && (already || added === "yes"
              ? <span className="rp-added"><Check size={15} aria-hidden="true" />On today's list</span>
              : <button className="btn quiet" onClick={() => void add()} disabled={busy || added === "adding"}><Plus size={15} aria-hidden="true" />Add to today's list</button>)}
            {place?.mapsUrl && <a href={place.mapsUrl} target="_blank" rel="noreferrer" className="btn quiet">Google Maps<ExternalLink size={14} aria-hidden="true" /></a>}
          </div>
          <p className="muted small">From places around the search spot that pass the team filters, each with the same chance. Only you see this pick.</p>
        </div>
      </div>
    </div>
  );
}
