// The picker: a full-screen map with the team's list floating on the left (a
// bottom sheet on phones). Filter finds places that pass the team filters and
// saves one list for the whole team; ticking places makes them Contenders; the
// red Let's choose button takes the Contenders to a game.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Dices, ExternalLink, List, LocateFixed, MapPinned, Minus, PartyPopper, Plus, RotateCw, Star, X } from "lucide-react";
import {
  COUNT, PRICE_BANDS, RADIUS, budgetPhrase, fmtBudget, fmtDistance, normalizeFilters, pickLunch, walkMinutes,
  type BandId, type LunchFilters, type Suggestion,
} from "../lib/lunch.ts";
import { checkDay, saveFilters, saveRun, setContender, useApp, type Member } from "../lib/store.ts";
import { freshPosition, locate, setManualPosition, useGeo, type Geo } from "../lib/geo.ts";
import { mapsKey, searchLunch, withPhotos } from "../lib/google.ts";
import { LunchMap, type MapStatus } from "../components/LunchMap.tsx";
import { PhotoStrip } from "../components/Photos.tsx";
import { RatingLine, WalkLine, priceText } from "../components/Bits.tsx";
import type { Team, TeamDay, TeamRun } from "../lib/types.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeFilters(a)) === JSON.stringify(normalizeFilters(b));
export const clock = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function useNarrow() {
  const q = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

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

// ---------- view-only quick filters ----------

type View = { pool: boolean; near: boolean; top: boolean; open: boolean; prices: string[] };
const NO_VIEW: View = { pool: false, near: false, top: false, open: false, prices: [] };

function applyView(list: Suggestion[], v: View, pool: Set<string>) {
  return list.filter((s) =>
    (!v.pool || pool.has(s.id)) &&
    (!v.near || s.walkMin <= 5) &&
    (!v.top || (s.rating ?? 0) >= 4.5) &&
    (!v.open || s.openNow === true) &&
    (!v.prices.length || v.prices.includes(priceText(s))));
}

export function PickerPage() {
  const team = useApp((s) => s.team)!;
  const today = useApp((s) => s.today);
  const teamDay = useApp((s) => s.teamDay);
  const config = useApp((s) => s.config);
  const members = useApp((s) => s.members);
  const profile = useApp((s) => s.profile)!;
  const geo = useGeo();
  const narrow = useNarrow();
  const navigate = useNavigate();
  const [filters, setFilters] = useTeamFilters(team);
  const [filtersOpen, setFiltersOpen] = useState(!today);
  const [listOpen, setListOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<View>(NO_VIEW);
  const [poolError, setPoolError] = useState("");
  const [hint, setHint] = useState(false);
  const [mapStatus, setMapStatus] = useState<{ s: MapStatus; error?: string }>({ s: "loading" });

  const apiKey = config?.google_maps_key ?? "";
  const keyChanged = !!mapsKey() && !!apiKey && mapsKey() !== apiKey;
  const canMap = !!apiKey && !keyChanged;
  const ready = canMap && mapStatus.s === "ready";

  useEffect(() => { if (useGeo.getState().status === "idle") void locate(); }, []);
  useEffect(() => { const t = setInterval(checkDay, 60_000); return () => clearInterval(t); }, []);
  // A new list (yours or a teammate's): fold the filters away, clear the selection and view.
  useEffect(() => { setSelected(null); setView(NO_VIEW); if (today) setFiltersOpen(false); }, [today?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selected) document.getElementById(`lp-${selected}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(false), 3500); return () => clearTimeout(t); }, [hint]);

  const stale = !!today && !same(today.filters, filters);
  const poolIds = useMemo(() => new Set(teamDay?.contenders ?? []), [teamDay?.contenders]);
  const list = today?.suggestions ?? [];
  const pool = list.filter((s) => poolIds.has(s.id));
  const visible = applyView(list, view, poolIds);
  const tapToSet = geo.status === "error" || geo.manual;
  // Editing (or no list yet): the circle is around you with the radius being edited.
  // Otherwise: around the spot today's search was run from, with that run's radius.
  const showRun = !!today && !filtersOpen;
  const center = showRun ? today!.origin : geo.pos;
  const radiusM = showRun ? today!.filters.radiusM : filters.radiusM;
  const padding = useMemo(() => narrow
    ? { top: 24, right: 24, left: 24, bottom: listOpen ? Math.round(innerHeight * 0.55) : 90 }
    : { top: 28, right: 80, bottom: 28, left: listOpen ? 460 : 28 }, [narrow, listOpen]);

  const run = async () => {
    setConfirm(false); setRunError(""); setRunning(true);
    try {
      const origin = await freshPosition();
      if (!origin) throw new Error("Your location is needed first. Allow location for this site, or tap the map to set where you are.");
      const { candidates, places } = await searchLunch(origin, filters);
      const { suggestions, summary } = pickLunch(candidates, filters, origin);
      await saveRun({ origin, filters, suggestions: await withPhotos(suggestions, places), summary });
      setFiltersOpen(false); setListOpen(true);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    setPoolError("");
    void setContender(id, on).catch((e) => setPoolError(e instanceof Error ? e.message : String(e)));
  };

  const choose = () => (pool.length >= 2 ? navigate("/choose") : setHint(true));

  return (
    <main className="picker">
      <section className="map-full">
        {canMap ? (
          <>
            <LunchMap apiKey={apiKey} mapId={config?.map_id ?? ""} me={geo.pos} center={center} radiusM={radiusM} padding={padding}
              suggestions={today && !stale ? visible : []} selected={selected} onSelect={(id) => { setSelected(id); setListOpen(true); }}
              onTap={tapToSet ? setManualPosition : undefined} onStatus={(s, error) => setMapStatus({ s, error })} />
            {mapStatus.s !== "ready" && <MapNote status={mapStatus.s} error={mapStatus.error} admin={profile.role === "admin"} />}
            {ready && (
              <button className="map-btn locate" onClick={() => void locate()} disabled={geo.status === "locating"} aria-label="Use my current location">
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

      <aside className={`sheet${listOpen ? "" : " closed"}`} aria-label="Today's list">
        <header className="sheet-head">
          <button className="sheet-grab" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen} aria-label={listOpen ? "Hide the list" : "Show the list"}>
            <span className="sheet-title">
              <b>Lunch for {team.name}</b>
              {today && <span className="muted small">{list.length} place{list.length === 1 ? "" : "s"}{pool.length ? ` · ${pool.length} contender${pool.length === 1 ? "" : "s"}` : ""}</span>}
            </span>
            {narrow ? (listOpen ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronUp size={20} aria-hidden="true" />) : <ChevronLeft size={20} aria-hidden="true" />}
          </button>
        </header>

        <div className="sheet-body">
          <LocationLine geo={geo} tapToSet={tapToSet && ready} />
          <TodaysPick day={teamDay} me={profile.id} />

          <section className={`lp-filters${filtersOpen ? " open" : ""}`}>
            <button className="lp-filters-head" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
              <span className="lp-filters-title">Team filters</span>
              {!filtersOpen && <span className="lp-filters-sum">{summary(filters)}</span>}
              <ChevronDown size={18} aria-hidden="true" className="lp-chev" />
            </button>
            {filtersOpen && <>
              <FilterForm f={filters} onChange={setFilters} />
              <FiltersBy team={team} members={members} me={profile.id} />
            </>}
          </section>

          {confirm ? (
            <div className="lp-confirm">
              <p>This replaces today's list for everyone in {team.name}. Contenders that aren't on the new list drop out.</p>
              <div className="row">
                <button className="btn" onClick={() => void run()}>Filter again</button>
                <button className="btn quiet" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn lp-run" onClick={() => (today ? setConfirm(true) : void run())} disabled={!ready || running || !geo.pos}>
              {running ? "Searching" : "Filter"}
            </button>
          )}
          {ready && !geo.pos && geo.status !== "locating" && <p className="hint lp-center">Your location is needed before you can filter.</p>}
          {runError && <div className="alert err">{runError}</div>}

          <Results today={today} stale={stale} running={running} me={profile.id} list={list} visible={visible} view={view} setView={setView}
            poolIds={poolIds} selected={selected} onSelect={setSelected} onToggle={toggle} poolError={poolError} />
        </div>
      </aside>

      {!listOpen && !narrow && (
        <button className="sheet-tab" onClick={() => setListOpen(true)}><List size={17} aria-hidden="true" />Show list<ChevronRight size={16} aria-hidden="true" /></button>
      )}

      {today && (
        <div className={`fab-wrap${narrow && !listOpen ? " raised" : ""}`}>
          {hint && <div className="fab-hint" role="status">Tick at least 2 places as contenders first.</div>}
          <button className={`fab${pool.length < 2 ? " dim" : ""}`} onClick={choose} aria-describedby="fab-count">
            <Dices size={22} aria-hidden="true" />
            <span>Let's choose</span>
            <span className="fab-count" id="fab-count" aria-label={`${pool.length} contenders`}>{pool.length}</span>
          </button>
        </div>
      )}
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

function TodaysPick({ day, me }: { day: TeamDay | null; me: string }) {
  if (!day?.pick) return null;
  const p = day.pick;
  const by = day.picked_by === me ? "you" : day.picked_by_name || "a teammate";
  const photo = p.photos?.[0];
  return (
    <section className="tp" aria-label="Today's pick">
      <div className="tp-label"><PartyPopper size={16} aria-hidden="true" />Today's pick</div>
      <div className="tp-row">
        {photo ? <img src={photo.uri} alt="" className="tp-img" /> : <span className="tp-img blank" />}
        <span className="tp-info">
          <b>{p.name}</b>
          <RatingLine s={p} />
          <span className="muted small">Picked by {by}{day.picked_at ? ` at ${clock(day.picked_at)}` : ""}</span>
        </span>
      </div>
      <div className="tp-actions">
        {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="btn small">Open in Google Maps<ExternalLink size={14} aria-hidden="true" /></a>}
        <Link to="/choose" className="btn quiet small">Play again</Link>
      </div>
    </section>
  );
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

/** Shown only when something needs attention: location blocked, or a spot set by tapping the map. */
function LocationLine({ geo, tapToSet }: { geo: Geo; tapToSet: boolean }) {
  if (!geo.error && !geo.manual) return null;
  return (
    <div className="lp-loc">
      {geo.manual && !geo.error && <span>Using the spot you tapped on the map.{tapToSet && " Tap again to move it."}</span>}
      {geo.error && <span className="lp-locerr">{geo.error}</span>}
      {geo.status !== "locating" && <button className="linkbtn small" onClick={() => void locate()}>Try my location again</button>}
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
        <label htmlFor="lp-rating" className="lp-lab">Minimum rating <b>{f.minRating ? <>{f.minRating.toFixed(1)}<Star size={13} aria-hidden="true" className="star" /> and up</> : "Any"}</b></label>
        <input id="lp-rating" type="range" className="lp-range" min={0} max={4.9} step={0.1} value={f.minRating}
          onChange={(e) => onChange({ ...f, minRating: Number(e.target.value) })} />
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

function Results(props: {
  today: TeamRun | null; stale: boolean; running: boolean; me: string; list: Suggestion[]; visible: Suggestion[];
  view: View; setView: (v: View) => void; poolIds: Set<string>; selected: string | null;
  onSelect: (id: string | null) => void; onToggle: (id: string, on: boolean) => void; poolError: string;
}) {
  const { today, stale, running, me, list, visible, view, setView, poolIds, selected, onSelect, onToggle, poolError } = props;
  if (!today) {
    if (running) return <div className="lp-idle"><span className="loading-dots"><i /><i /><i /></span> Searching Google Maps</div>;
    return <p className="lp-idle">No list yet today. Check the team filters, then press Filter. Everyone in your team will see the same list.</p>;
  }
  const by = today.run_by === me ? "you" : today.run_by_name || "a teammate";
  const prices = [...new Set(list.map(priceText).filter(Boolean))].sort((a, b) => parseFloat(a.replace(/[^\d.]/g, "") || "0") - parseFloat(b.replace(/[^\d.]/g, "") || "0"));
  const filtered = view.pool || view.near || view.top || view.open || view.prices.length > 0;
  const chip = (on: boolean, label: string, flip: () => void) => <button key={label} aria-pressed={on} onClick={flip}>{label}</button>;
  return (
    <div className={`lp-results${stale || running ? " stale" : ""}`}>
      <div className="lp-runhead">
        <b>Today's list</b>
        <span className="muted small">Found by {by} at {clock(today.run_at)}{today.run_by === me ? "" : ", from their location"}. Tick places to make them contenders.</span>
      </div>
      {stale && <div className="lp-stalenote">The team filters changed since this list was made. Press Filter to apply them.</div>}
      {list.length > 0 && (
        <div className="qv" role="group" aria-label="Show only">
          {chip(view.pool, `Contenders (${list.filter((s) => poolIds.has(s.id)).length})`, () => setView({ ...view, pool: !view.pool }))}
          {chip(view.near, "Within 5 min", () => setView({ ...view, near: !view.near }))}
          {chip(view.top, "4.5★ and up", () => setView({ ...view, top: !view.top }))}
          {chip(view.open, "Open", () => setView({ ...view, open: !view.open }))}
          {prices.map((p) => chip(view.prices.includes(p), p, () => setView({ ...view, prices: view.prices.includes(p) ? view.prices.filter((x) => x !== p) : [...view.prices, p] })))}
        </div>
      )}
      {filtered && (
        <p className="qv-note small muted">Showing {visible.length} of {list.length}. These only change what you see. <button className="linkbtn" onClick={() => setView(NO_VIEW)}>Show all</button></p>
      )}
      {poolError && <div className="alert err">{poolError}</div>}
      {list.length === 0 ? (
        <p className="lp-idle">No place passed every filter. Try a larger radius, a wider budget or a lower minimum rating.</p>
      ) : (
        <ol className="pc-list">
          {visible.map((s) => <PlaceCard key={s.id} s={s} on={s.id === selected} inPool={poolIds.has(s.id)} onSelect={onSelect} onToggle={onToggle} />)}
        </ol>
      )}
    </div>
  );
}

function PlaceCard({ s, on, inPool, onSelect, onToggle }: {
  s: Suggestion; on: boolean; inPool: boolean; onSelect: (id: string | null) => void; onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <li id={`lp-${s.id}`} className={`pc${on ? " on" : ""}${inPool ? " pooled" : ""}`}>
      <div className="pc-top">
        <button className="pc-main" onClick={() => onSelect(on ? null : s.id)} aria-pressed={on}>
          <span className="pc-rank">{s.rank}</span>
          <span className="pc-info">
            <span className="pc-name">{s.name}</span>
            <RatingLine s={s} />
            <WalkLine s={s} />
            <span className={s.openNow === true ? "ok-text" : "muted"}>{s.openNow === true ? "Open at search time" : s.openNow === false ? "Closed at search time" : "Hours not listed"}</span>
          </span>
        </button>
        <label className={`pool-check${inPool ? " on" : ""}`}>
          <input type="checkbox" checked={inPool} onChange={(e) => onToggle(s.id, e.target.checked)} aria-label={`${s.name} as a contender`} />
          <span aria-hidden="true">{inPool ? "Contender" : "Add"}</span>
        </label>
      </div>
      <PhotoStrip photos={s.photos} label={s.name} />
      {on && (
        <div className="pc-more">
          {s.address && <span className="small muted">{s.address}</span>}
          {s.mapsUrl && <a href={s.mapsUrl} target="_blank" rel="noreferrer" className="lp-link">Open in Google Maps<ExternalLink size={14} aria-hidden="true" /></a>}
          <button className="linkbtn small" onClick={() => onSelect(null)}><X size={13} aria-hidden="true" /> Close</button>
        </div>
      )}
    </li>
  );
}
