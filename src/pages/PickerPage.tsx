// The picker: the team's fixed filters with the map beside them, Run, and the
// team's shared list for today. Everyone in the team sees the same list; a new
// Run replaces it for everyone.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink, LocateFixed, MapPinned, Minus, Plus, RotateCw, Star } from "lucide-react";
import {
  COUNT, DROP_LABEL, PRICE_BANDS, PRICE_LEVEL_LABEL, RADIUS, budgetPhrase, fmtBudget, fmtDistance, fmtPrice, normalizeFilters, pickLunch, walkMinutes,
  type BandId, type DropReason, type LunchFilters, type Suggestion,
} from "../lib/lunch.ts";
import { checkDay, saveFilters, saveRun, useApp, type Member } from "../lib/store.ts";
import { freshPosition, locate, setManualPosition, useGeo, type Geo } from "../lib/geo.ts";
import { mapsKey, searchLunch } from "../lib/google.ts";
import { LunchMap, type MapStatus } from "../components/LunchMap.tsx";
import type { Team, TeamRun } from "../lib/types.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeFilters(a)) === JSON.stringify(normalizeFilters(b));
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The team's filters as edited here, saved shortly after each change. */
function useTeamFilters(team: Team): [LunchFilters, (f: LunchFilters) => void] {
  const saved = normalizeFilters(team.filters);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const sent = useRef(savedKey);
  // Take a teammate's change, but not the echo of our own save.
  useEffect(() => {
    if (savedKey !== sent.current) { sent.current = savedKey; setDraft(JSON.parse(savedKey)); }
  }, [savedKey]);
  useEffect(() => {
    if (JSON.stringify(draft) === savedKey) return;
    const t = setTimeout(() => { sent.current = JSON.stringify(draft); void saveFilters(draft).catch(() => {}); }, 600);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  return [draft, setDraft];
}

export function PickerPage() {
  const team = useApp((s) => s.team)!;
  const today = useApp((s) => s.today);
  const config = useApp((s) => s.config);
  const members = useApp((s) => s.members);
  const profile = useApp((s) => s.profile)!;
  const geo = useGeo();
  const [filters, setFilters] = useTeamFilters(team);
  const [open, setOpen] = useState(!today);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [mapStatus, setMapStatus] = useState<{ s: MapStatus; error?: string }>({ s: "loading" });

  const apiKey = config?.google_maps_key ?? "";
  const keyChanged = !!mapsKey() && !!apiKey && mapsKey() !== apiKey;
  const canMap = !!apiKey && !keyChanged;
  const ready = canMap && mapStatus.s === "ready";

  useEffect(() => { if (useGeo.getState().status === "idle") void locate(); }, []);
  useEffect(() => { const t = setInterval(checkDay, 60_000); return () => clearInterval(t); }, []);
  // A new list (yours or a teammate's): fold the filters away, clear the selection.
  useEffect(() => { setSelected(null); if (today) setOpen(false); }, [today?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selected) document.getElementById(`lp-${selected}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const stale = !!today && !same(today.filters, filters);
  const tapToSet = geo.status === "error" || geo.manual;
  // Editing (or no list yet): the circle is around you with the radius being edited.
  // Otherwise: around the spot today's search was run from, with that run's radius.
  const showRun = !!today && !open;
  const center = showRun ? today!.origin : geo.pos;
  const radiusM = showRun ? today!.filters.radiusM : filters.radiusM;

  const run = async () => {
    setConfirm(false); setRunError(""); setRunning(true);
    try {
      const origin = await freshPosition();
      if (!origin) throw new Error("Your location is needed first. Allow location for this site, or tap the map to set where you are.");
      const cands = await searchLunch(origin, filters);
      const { suggestions, summary } = pickLunch(cands, filters, origin);
      await saveRun({ origin, filters, suggestions, summary });
      setOpen(false);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="picker">
      <div className="lp-layout">
        <section className="lp-mapwrap">
          {canMap ? (
            <>
              <LunchMap apiKey={apiKey} mapId={config?.map_id ?? ""} me={geo.pos} center={center} radiusM={radiusM}
                suggestions={today && !stale ? today.suggestions : []} selected={selected} onSelect={setSelected}
                onTap={tapToSet ? setManualPosition : undefined} onStatus={(s, error) => setMapStatus({ s, error })} />
              {mapStatus.s !== "ready" && <MapNote status={mapStatus.s} error={mapStatus.error} admin={profile.role === "admin"} />}
              {ready && (
                <button className="lp-locate" onClick={() => void locate()} disabled={geo.status === "locating"} aria-label="Use my current location">
                  <LocateFixed size={18} aria-hidden="true" />
                </button>
              )}
            </>
          ) : keyChanged ? (
            <div className="lp-mapempty"><MapPinned size={28} aria-hidden="true" /><p>The Google Maps key changed. Reload the page to use it.</p>
              <button className="btn quiet" onClick={() => location.reload()}><RotateCw size={16} aria-hidden="true" />Reload</button></div>
          ) : (
            <div className="lp-mapempty"><MapPinned size={28} aria-hidden="true" />
              {profile.role === "admin"
                ? <><p>Add the Google Maps key to see the map and search for lunch.</p><Link to="/admin" className="btn">Open Admin</Link></>
                : <p>The map appears once an admin adds the Google Maps key.</p>}
            </div>
          )}
        </section>

        <aside className="lp-panel">
          <div className="lp-head">
            <h1>Lunch for {team.name}</h1>
            <LocationLine geo={geo} tapToSet={tapToSet && ready} />
          </div>

          <section className={`lp-filters${open ? " open" : ""}`}>
            <button className="lp-filters-head" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span className="lp-filters-title">Team filters</span>
              {!open && <span className="lp-filters-sum">{summary(filters)}</span>}
              <ChevronDown size={18} aria-hidden="true" className="lp-chev" />
            </button>
            {open && <>
              <FilterForm f={filters} onChange={setFilters} />
              <FiltersBy team={team} members={members} me={profile.id} />
            </>}
          </section>

          {confirm ? (
            <div className="lp-confirm">
              <p>This replaces today's list for everyone in {team.name}.</p>
              <div className="row">
                <button className="btn" onClick={() => void run()}>Run again</button>
                <button className="btn quiet" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn lp-run" onClick={() => (today ? setConfirm(true) : void run())} disabled={!ready || running || !geo.pos}>
              {running ? "Searching" : today ? "Run again" : "Run"}
            </button>
          )}
          {ready && !geo.pos && geo.status !== "locating" && <p className="hint lp-center">Your location is needed before you can run a search.</p>}
          {runError && <div className="alert err">{runError}</div>}

          <Results today={today} stale={stale} running={running} selected={selected} onSelect={setSelected} me={profile.id} />
        </aside>
      </div>
    </main>
  );
}

function summary(f: LunchFilters): string {
  return [
    fmtBudget(f.bands),
    fmtDistance(f.radiusM),
    f.minRating ? `${f.minRating.toFixed(1)}★+` : "any rating",
    `${f.count} result${f.count === 1 ? "" : "s"}`,
    f.openNow ? "open now" : "",
  ].filter(Boolean).join(" · ");
}

function FiltersBy({ team, members, me }: { team: Team; members: Member[]; me: string }) {
  if (!team.filters_updated_at) return <p className="hint lp-by">Shared by everyone in {team.name}. Changes save as you make them.</p>;
  const who = team.filters_updated_by === me ? "you" : members.find((m) => m.id === team.filters_updated_by)?.display_name || "a teammate";
  return <p className="hint lp-by">Shared by everyone in {team.name}. Last changed by {who} at {clock(team.filters_updated_at)}.</p>;
}

function MapNote({ status, error, admin }: { status: MapStatus; error?: string; admin: boolean }) {
  if (status === "loading") return <div className="lp-mapnote"><span className="loading-dots"><i /><i /><i /></span></div>;
  return (
    <div className="lp-mapnote err">
      <p>{status === "auth"
        ? "Google refused the Maps key on this site. Check that Maps JavaScript API is enabled for the key and that this address is in its website restrictions."
        : error || "The map could not load."}</p>
      {admin && <Link to="/admin" className="btn quiet small">Open Admin</Link>}
    </div>
  );
}

function LocationLine({ geo, tapToSet }: { geo: Geo; tapToSet: boolean }) {
  let text = "";
  if (geo.status === "locating") text = "Finding your location…";
  else if (geo.pos && geo.manual) text = "Using the spot you tapped on the map.";
  else if (geo.pos) text = `Using your location${geo.accuracyM ? ` (within ${fmtDistance(geo.accuracyM)})` : ""}${geo.at ? `, updated at ${clock(geo.at)}` : ""}.`;
  else if (geo.status !== "error") text = "Waiting for your location…";
  return (
    <div className="lp-loc">
      {text && <span>{text}</span>}
      {geo.error && <span className="lp-locerr">{geo.error}</span>}
      {tapToSet && !geo.error && geo.manual && <span className="hint">Tap the map again to move it.</span>}
      {geo.status !== "locating" && (geo.error || geo.manual) && <button className="linkbtn small" onClick={() => void locate()}>Try my location again</button>}
    </div>
  );
}

function FilterForm({ f, onChange }: { f: LunchFilters; onChange: (f: LunchFilters) => void }) {
  const toggleBand = (id: BandId) => onChange({ ...f, bands: f.bands.includes(id) ? f.bands.filter((b) => b !== id) : [...f.bands, id] });
  return (
    <div className="lp-form">
      <fieldset className="field">
        <legend className="label">Budget per person</legend>
        <div className="lp-chips">
          <button aria-pressed={f.bands.length === 0} onClick={() => onChange({ ...f, bands: [] })}>Any</button>
          {PRICE_BANDS.map((b) => <button key={b.id} aria-pressed={f.bands.includes(b.id)} onClick={() => toggleBand(b.id)}>{b.label}</button>)}
        </div>
        <span className="hint">{f.bands.length ? `Only places whose price range on Google is ${budgetPhrase(f.bands)}.` : "Any price, including places with no price range on Google."}</span>
        {f.bands.length > 0 && (
          <label className="check small"><input type="checkbox" checked={f.allowNoPrice} onChange={(e) => onChange({ ...f, allowNoPrice: e.target.checked })} />
            Also show places with no price range on Google</label>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor="lp-radius" className="lp-lab">Radius <b>{fmtDistance(f.radiusM)}</b><span className="muted">about {walkMinutes(f.radiusM)} min walk</span></label>
        <input id="lp-radius" type="range" className="lp-range" min={RADIUS.min} max={RADIUS.max} step={RADIUS.step} value={f.radiusM}
          onChange={(e) => onChange({ ...f, radiusM: Number(e.target.value) })} />
      </div>

      <div className="field">
        <label htmlFor="lp-rating" className="lp-lab">Minimum rating <b>{f.minRating ? <>{f.minRating.toFixed(1)}<Star size={13} aria-hidden="true" className="lp-star" /> and up</> : "Any"}</b></label>
        <input id="lp-rating" type="range" className="lp-range" min={0} max={4.9} step={0.1} value={f.minRating}
          onChange={(e) => onChange({ ...f, minRating: Number(e.target.value) })} />
        <span className="hint">Google Maps rating. Places with no rating are left out when a minimum is set.</span>
      </div>

      <div className="field">
        <span className="label" id="lp-count-l">Number of suggestions</span>
        <div className="lp-stepper" role="group" aria-labelledby="lp-count-l">
          <button className="btn quiet icon" aria-label="Fewer" disabled={f.count <= COUNT.min} onClick={() => onChange({ ...f, count: f.count - 1 })}><Minus size={16} aria-hidden="true" /></button>
          <span className="num" aria-live="polite">{f.count}</span>
          <button className="btn quiet icon" aria-label="More" disabled={f.count >= COUNT.max} onClick={() => onChange({ ...f, count: f.count + 1 })}><Plus size={16} aria-hidden="true" /></button>
        </div>
      </div>

      <label className="check"><input type="checkbox" checked={f.openNow} onChange={(e) => onChange({ ...f, openNow: e.target.checked })} />Open now only</label>
    </div>
  );
}

function Results({ today, stale, running, selected, onSelect, me }: {
  today: TeamRun | null; stale: boolean; running: boolean; selected: string | null; onSelect: (id: string | null) => void; me: string;
}) {
  if (!today) {
    if (running) return <div className="lp-idle"><span className="loading-dots"><i /><i /><i /></span> Searching Google Maps</div>;
    return <p className="lp-idle">No list yet today. Check the team filters, then press Run. Everyone in your team will see the same list.</p>;
  }
  const s = today.summary;
  const dropped = (Object.entries(s.dropped) as [DropReason, number][]).sort((a, b) => b[1] - a[1]);
  const by = today.run_by === me ? "you" : today.run_by_name || "a teammate";
  return (
    <div className={`lp-results${stale || running ? " stale" : ""}`}>
      <div className="lp-runhead">
        <b>Today's list</b>
        <span className="muted small">Run by {by} at {clock(today.run_at)}{today.run_by === me ? "" : ", from their location"}.</span>
      </div>
      {stale && <div className="lp-stalenote">The team filters changed since this run. Press Run again to apply them.</div>}
      <p className="lp-sum">
        <b>{today.suggestions.length}</b> of {s.found} place{s.found === 1 ? "" : "s"} found nearby{today.suggestions.length < s.matched ? ` (${s.matched} matched)` : ""}.
        {dropped.length > 0 && <span className="muted"> Left out: {dropped.map(([k, n]) => `${n} ${DROP_LABEL[k]}`).join(", ")}.</span>}
      </p>
      {today.suggestions.length === 0 ? (
        <p className="lp-idle">No place passed every filter. Try a larger radius, a wider budget or a lower minimum rating.</p>
      ) : (
        <ol className="lp-list">
          {today.suggestions.map((x) => <Item key={x.id} s={x} on={x.id === selected} onSelect={onSelect} />)}
        </ol>
      )}
    </div>
  );
}

function Item({ s, on, onSelect }: { s: Suggestion; on: boolean; onSelect: (id: string | null) => void }) {
  return (
    <li id={`lp-${s.id}`} className={`lp-item${on ? " on" : ""}`}>
      <button className="lp-itembtn" onClick={() => onSelect(on ? null : s.id)} aria-pressed={on}>
        <span className="lp-rank">{s.rank}</span>
        <span className="lp-body">
          <span className="lp-row1">
            <span className="lp-name">{s.name}</span>
            {s.rating !== null && <span className="lp-rating"><Star size={13} aria-hidden="true" className="lp-star" />{s.rating.toFixed(1)}<span className="muted"> ({s.ratingCount.toLocaleString("en-CA")})</span></span>}
          </span>
          <span className="lp-meta">{[s.type, fmtDistance(s.distanceM), `about ${s.walkMin} min walk`].filter(Boolean).join(" · ")}</span>
          <span className="lp-tags">
            {s.price ? <span className="chip">{fmtPrice(s.price)}</span> : s.priceLevel && PRICE_LEVEL_LABEL[s.priceLevel] ? <span className="chip">{PRICE_LEVEL_LABEL[s.priceLevel]}</span> : <span className="chip">No price range</span>}
            {s.openNow === true ? <span className="badge ok">Open at search time</span> : s.openNow === false ? <span className="badge neutral">Closed at search time</span> : <span className="chip">Hours not listed</span>}
          </span>
        </span>
      </button>
      {on && (
        <div className="lp-more">
          {s.address && <span className="small muted">{s.address}</span>}
          {s.mapsUrl && <a href={s.mapsUrl} target="_blank" rel="noreferrer" className="lp-link">Open in Google Maps<ExternalLink size={14} aria-hidden="true" /></a>}
        </div>
      )}
    </li>
  );
}
