// The picker: the team's list is the main part of the page, with the map beside
// it (above it on phones). Filter draws places that pass the team filters and
// saves them for the whole team. Places can also be added by hand (they stay
// until 9 AM), marked Not today (hidden until 9 AM) or Never again. Ticking places
// makes them Contenders; the red Let's choose button takes them to a game.
// Random pick shows one place from the area at random, for you only.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, CalendarX2, ChevronDown, Dices, ExternalLink, LocateFixed, MapPin, MapPinned, Minus, Plus, RotateCw, Shuffle, Star, Trash2, X } from "lucide-react";
import {
  COUNT, PRICE_BANDS, RADIUS, budgetPhrase, fmtBudget, fmtDistance, normalizeFilters, pickLunch, walkMinutes,
  type BandId, type LunchFilters,
} from "../lib/lunch.ts";
import { checkDay, dayKey, fetchPlaceStats, removeAdded, saveFilters, saveRun, setBan, setContender, skipToday, useApp, type Member } from "../lib/store.ts";
import { choosePlace, freshPosition, locate, switchToDevice, useGeo } from "../lib/geo.ts";
import { mapsKey, rememberPool, searchLunch, withPhotos } from "../lib/google.ts";
import { useTeamList, type ListPlace } from "../lib/list.ts";
import { LunchMap, type MapStatus } from "../components/LunchMap.tsx";
import { PhotoStrip } from "../components/Photos.tsx";
import { RatingLine, WalkLine, priceText } from "../components/Bits.tsx";
import { WhereBar } from "../components/WhereBar.tsx";
import { AddPlace } from "../components/AddPlace.tsx";
import { RandomPick } from "../components/RandomPick.tsx";
import type { SkippedPlace, Team, TeamRun } from "../lib/types.ts";
import { DEV_MAPS_KEY } from "../lib/config.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeFilters(a)) === JSON.stringify(normalizeFilters(b));
export const clock = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const MAP_PAD = { top: 24, right: 24, bottom: 24, left: 24 };

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

function applyView(list: ListPlace[], v: View, pool: Set<string>) {
  return list.filter((s) =>
    (!v.pool || pool.has(s.id)) &&
    (!v.near || s.walkMin <= 5) &&
    (!v.top || (s.rating ?? 0) >= 4.5) &&
    (!v.open || s.openNow === true) &&
    (!v.prices.length || v.prices.includes(priceText(s))));
}

type Toast = { text: ReactNode; undo?: () => void };

export function PickerPage() {
  const team = useApp((s) => s.team)!;
  const today = useApp((s) => s.today);
  const teamDay = useApp((s) => s.teamDay);
  const period = useApp((s) => s.teamPeriod);
  const config = useApp((s) => s.config);
  const members = useApp((s) => s.members);
  const profile = useApp((s) => s.profile)!;
  const geo = useGeo();
  const narrow = useNarrow();
  const navigate = useNavigate();
  const { all, added, run: runList, banned, skipped, addedIds } = useTeamList();
  const [filters, setFilters] = useTeamFilters(team);
  const [filtersOpen, setFiltersOpen] = useState(!today);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [view, setView] = useState<View>(NO_VIEW);
  const [listError, setListError] = useState("");
  const [hint, setHint] = useState(false);
  const [picking, setPicking] = useState(false);
  const [random, setRandom] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mapStatus, setMapStatus] = useState<{ s: MapStatus; error?: string }>({ s: "loading" });
  const mapRef = useRef<HTMLElement>(null);

  const apiKey = DEV_MAPS_KEY || config?.google_maps_key || "";
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
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }, [toast]);

  const stale = !!today && !same(today.filters, filters);
  const poolIds = useMemo(() => new Set(teamDay?.contenders ?? []), [teamDay?.contenders]);
  const pool = all.filter((s) => poolIds.has(s.id));
  const visible = useMemo(() => applyView(all, view, poolIds), [all, view, poolIds]);
  // Taps on the map set the location only in pick mode, or while no location is known.
  const tapToSet = picking || (geo.status === "error" && !geo.pos);
  // Editing (or no list yet): the circle is around you with the radius being edited.
  // Otherwise: around the spot today's search was run from, with that run's radius.
  const showRun = !!today && !filtersOpen;
  const center = showRun ? today!.origin : geo.pos;
  const radiusM = showRun ? today!.filters.radiusM : filters.radiusM;
  const fail = (e: unknown) => setListError(e instanceof Error ? e.message : String(e));

  const run = async () => {
    setRunError(""); setRunning(true);
    try {
      const origin = await freshPosition();
      if (!origin) throw new Error("Set where you are first: type an address or pick a spot on the map.");
      // The team's history makes the draw; without it the list is still drawn, just without the labels.
      const [found, stats] = await Promise.all([searchLunch(origin, filters), fetchPlaceStats().catch(() => null)]);
      rememberPool(origin, filters, found);
      const picked = pickLunch(found.candidates, filters, origin, {
        stats: stats ?? undefined, banned, skipped, pinned: addedIds, keep: runList.filter((s) => poolIds.has(s.id)), today: dayKey(),
      });
      const suggestions = stats ? picked.suggestions : picked.suggestions.map((s) => ({ ...s, tag: undefined }));
      const where = useGeo.getState();
      const label = where.manual ? where.label : "";
      await saveRun({ origin: { ...origin, label }, filters, suggestions: await withPhotos(suggestions, found.places), summary: { ...picked.summary, cuisine: found.cuisine } });
      setFiltersOpen(false);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string, on: boolean) => { setListError(""); void setContender(id, on).catch(fail); };
  const choose = () => (pool.length >= 2 ? navigate("/choose") : setHint(true));
  const drop = (s: ListPlace) => { if (selected === s.id) setSelected(null); };

  const notToday = (s: ListPlace) => {
    drop(s);
    const place = { id: s.id, name: s.name };
    setToast({ text: <><b>{s.name}</b> is hidden until 9 AM.</>, undo: () => void skipToday(place, false).catch(fail) });
    void skipToday(place, true).catch((e) => { setToast(null); fail(e); });
  };
  const ban = (s: ListPlace) => {
    drop(s);
    const place = { id: s.id, name: s.name, address: s.address };
    setToast({ text: <><b>{s.name}</b> won't be suggested again.</>, undo: () => void setBan(place, false).catch(fail) });
    void setBan(place, true).catch((e) => { setToast(null); fail(e); });
  };
  const remove = (s: ListPlace) => { drop(s); void removeAdded(s.id).catch(fail); };
  const pickOnMap = () => { setPicking(true); if (narrow) mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const randomOrigin = geo.pos ?? today?.origin ?? null;

  return (
    <main className="picker">
      <section className="panel" aria-label="Today's list">
        <div className="panel-inner">
          <header className="panel-head">
            <div className="panel-title">
              <h1>Lunch for {team.name}</h1>
              <span className="muted small">{all.length} place{all.length === 1 ? "" : "s"}{pool.length ? ` · ${pool.length} contender${pool.length === 1 ? "" : "s"}` : ""}</span>
            </div>
            <button className="btn quiet random-btn" onClick={() => setRandom(true)} disabled={!ready || !randomOrigin}>
              <Shuffle size={16} aria-hidden="true" />Random pick
            </button>
          </header>

          <div className="panel-top">
            <WhereBar geo={geo} ready={ready} onPickOnMap={pickOnMap} />
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
          </div>

          <button className="btn lp-run" onClick={() => void run()} disabled={!ready || running || !geo.pos}>
            {running ? "Searching" : "Filter"}
          </button>
          {ready && !geo.pos && geo.status !== "locating" && <p className="hint lp-center">Set where you are (above) before you filter.</p>}
          {runError && <div className="alert err">{runError}</div>}

          <AddPlace near={today?.origin ?? geo.pos} disabled={!ready}
            onAdded={(name) => setToast({ text: <><b>{name}</b> is on today's list until 9 AM.</> })} />
          {listError && <div className="alert err">{listError}</div>}

          <Results today={today} stale={stale} running={running} me={profile.id} all={all} added={added} visible={visible}
            view={view} setView={setView} poolIds={poolIds} selected={selected} onSelect={setSelected} onToggle={toggle}
            onNotToday={notToday} onBan={ban} onRemove={remove} onClearAdded={() => void removeAdded(null).catch(fail)} teamName={team.name} />

          <NotTodayList list={period?.skipped ?? []} me={profile.id} onBack={(x) => void skipToday({ id: x.id, name: x.name }, false).catch(fail)} />
        </div>
      </section>

      <section className="map-side" ref={mapRef}>
        {canMap ? (
          <>
            <LunchMap apiKey={apiKey} mapId={config?.map_id ?? ""} me={geo.pos} center={center} radiusM={radiusM} padding={MAP_PAD}
              suggestions={stale ? visible.filter((s) => addedIds.has(s.id)) : visible} selected={selected} onSelect={setSelected}
              onTap={tapToSet ? (pos) => { choosePlace(pos, "Spot on the map", "map"); setPicking(false); } : undefined}
              onStatus={(s, error) => setMapStatus({ s, error })} />
            {picking && (
              <div className="pick-banner" role="status">
                <MapPin size={16} aria-hidden="true" />Tap the map where you are
                <button className="btn quiet small" onClick={() => setPicking(false)}>Cancel</button>
              </div>
            )}
            {mapStatus.s !== "ready" && <MapNote status={mapStatus.s} error={mapStatus.error} admin={profile.role === "admin"} />}
            {ready && !picking && (
              <button className="map-btn locate" onClick={() => void switchToDevice()} disabled={geo.status === "locating"} aria-label="Use my device location">
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

      {all.length > 0 && (
        <div className="fab-wrap">
          {hint && <div className="fab-hint" role="status">Tick at least 2 places as contenders first.</div>}
          <button className={`fab${pool.length < 2 ? " dim" : ""}`} onClick={choose} aria-describedby="fab-count">
            <Dices size={22} aria-hidden="true" />
            <span>Let's choose</span>
            <span className="fab-count" id="fab-count" aria-label={`${pool.length} contenders`}>{pool.length}</span>
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="linkbtn" onClick={() => { const u = toast.undo!; setToast(null); u(); }}>Undo</button>}
          <button className="toast-x" onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} aria-hidden="true" /></button>
        </div>
      )}

      {random && randomOrigin && (
        <RandomPick origin={randomOrigin} filters={filters} banned={banned} skipped={skipped} onList={new Set(all.map((s) => s.id))}
          extra={period?.added ?? []} onClose={() => setRandom(false)} />
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
  today: TeamRun | null; stale: boolean; running: boolean; me: string; all: ListPlace[]; added: ListPlace[]; visible: ListPlace[];
  view: View; setView: (v: View) => void; poolIds: Set<string>; selected: string | null;
  onSelect: (id: string | null) => void; onToggle: (id: string, on: boolean) => void;
  onNotToday: (s: ListPlace) => void; onBan: (s: ListPlace) => void; onRemove: (s: ListPlace) => void; onClearAdded: () => void;
  teamName: string;
}) {
  const { today, stale, running, me, all, added, visible, view, setView, poolIds, selected, onSelect, onToggle, onNotToday, onBan, onRemove, onClearAdded, teamName } = props;
  const prices = [...new Set(all.map(priceText).filter(Boolean))].sort((a, b) => parseFloat(a.replace(/[^\d.]/g, "") || "0") - parseFloat(b.replace(/[^\d.]/g, "") || "0"));
  const filtered = view.pool || view.near || view.top || view.open || view.prices.length > 0;
  const chip = (on: boolean, label: string, flip: () => void) => <button key={label} aria-pressed={on} onClick={flip}>{label}</button>;
  const addedIds = new Set(added.map((a) => a.id));
  const shownAdded = visible.filter((s) => addedIds.has(s.id));
  const shownRun = visible.filter((s) => !addedIds.has(s.id));
  const card = (s: ListPlace) => (
    <PlaceCard key={s.id} s={s} on={s.id === selected} inPool={poolIds.has(s.id)} onSelect={onSelect} onToggle={onToggle}
      onNotToday={onNotToday} onBan={onBan} onRemove={onRemove} teamName={teamName} me={me} />
  );
  const by = today ? (today.run_by === me ? "you" : today.run_by_name || "a teammate") : "";

  return (
    <div className={`lp-results${running ? " stale" : ""}`}>
      {all.length > 0 && (
        <div className="qv" role="group" aria-label="Show only">
          {chip(view.pool, `Contenders (${all.filter((s) => poolIds.has(s.id)).length})`, () => setView({ ...view, pool: !view.pool }))}
          {chip(view.near, "Within 5 min", () => setView({ ...view, near: !view.near }))}
          {chip(view.top, "4.5★ and up", () => setView({ ...view, top: !view.top }))}
          {chip(view.open, "Open", () => setView({ ...view, open: !view.open }))}
          {prices.map((p) => chip(view.prices.includes(p), p, () => setView({ ...view, prices: view.prices.includes(p) ? view.prices.filter((x) => x !== p) : [...view.prices, p] })))}
        </div>
      )}
      {filtered && (
        <p className="qv-note small muted">Showing {visible.length} of {all.length}. These only change what you see. <button className="linkbtn" onClick={() => setView(NO_VIEW)}>Show all</button></p>
      )}

      {added.length > 0 && (
        <section className="lp-sec" aria-label="Added for today">
          <div className="lp-sechead">
            <span><b>Added for today</b><span className="muted small">Stays on the list through every Filter until 9 AM.</span></span>
            <button className="linkbtn small" onClick={onClearAdded}>Clear all</button>
          </div>
          {shownAdded.length > 0 && <ol className="pc-list">{shownAdded.map(card)}</ol>}
        </section>
      )}

      <section className="lp-sec" aria-label="Today's list">
        {today ? (
          <>
            <div className="lp-sechead lp-runhead">
              <span><b>Today's list</b>
                <span className="muted small">Found by {by} at {clock(today.run_at)}{today.origin.label ? `, around ${today.origin.label}` : today.run_by === me ? "" : ", from their location"}. Tick places to make them contenders. Filter again keeps the contenders and finds new places for the rest.</span>
              </span>
            </div>
            {stale && <div className="lp-stalenote">The team filters changed since this list was made. Press Filter to apply them.</div>}
            {today.suggestions.length === 0 ? (
              <p className="lp-idle">No place passed every filter. Try a larger radius, a wider budget or a lower minimum rating.</p>
            ) : (
              <ol className={`pc-list${stale ? " stale" : ""}`}>{shownRun.map(card)}</ol>
            )}
          </>
        ) : running ? (
          <div className="lp-idle"><span className="loading-dots"><i /><i /><i /></span> Searching Google Maps</div>
        ) : (
          <p className="lp-idle">No list yet today. Check the team filters, then press Filter. Everyone in your team will see the same list.</p>
        )}
      </section>
    </div>
  );
}

function PlaceCard({ s, on, inPool, onSelect, onToggle, onNotToday, onBan, onRemove, teamName, me }: {
  s: ListPlace; on: boolean; inPool: boolean; onSelect: (id: string | null) => void; onToggle: (id: string, on: boolean) => void;
  onNotToday: (s: ListPlace) => void; onBan: (s: ListPlace) => void; onRemove: (s: ListPlace) => void; teamName: string; me: string;
}) {
  const [asking, setAsking] = useState(false);
  const isAdded = s.addedByName !== undefined;
  return (
    <li id={`lp-${s.id}`} className={`pc${on ? " on" : ""}${inPool ? " pooled" : ""}${isAdded ? " added" : ""}`}>
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
      {asking ? (
        <div className="ban-ask" role="group" aria-label={`Never suggest ${s.name} again`}>
          <p>Never suggest <b>{s.name}</b> to {teamName} again? Anyone in the team can allow it again from History.</p>
          <div className="row">
            <button className="btn danger small" onClick={() => { setAsking(false); onBan(s); }}><Ban size={14} aria-hidden="true" />Never again</button>
            <button className="btn quiet small" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="pc-foot">
          {isAdded
            ? <span className="tag added">Added by {s.addedBy === me ? "you" : s.addedByName || "a teammate"}</span>
            : s.tag ? <span className={`tag ${s.tag.kind}`}>{s.tag.text}</span> : <span />}
          <span className="pc-acts">
            {isAdded
              ? <button className="act-btn" onClick={() => onRemove(s)}><Trash2 size={13} aria-hidden="true" />Remove</button>
              : <>
                <button className="act-btn" onClick={() => onNotToday(s)} title="Hide until 9 AM"><CalendarX2 size={13} aria-hidden="true" />Not today</button>
                <button className="act-btn ban" onClick={() => setAsking(true)}><Ban size={13} aria-hidden="true" />Never again</button>
              </>}
          </span>
        </div>
      )}
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

/** Places marked Not today, with a way to bring each back before 9 AM. */
function NotTodayList({ list, me, onBack }: { list: SkippedPlace[]; me: string; onBack: (x: SkippedPlace) => void }) {
  if (!list.length) return null;
  return (
    <details className="nt">
      <summary><CalendarX2 size={15} aria-hidden="true" />Not today ({list.length})<span className="muted small">Hidden until 9 AM</span></summary>
      <ul>
        {list.map((x) => (
          <li key={x.id}>
            <span><b>{x.name || "Unnamed place"}</b><span className="muted small">by {x.by === me ? "you" : x.byName || "a teammate"}</span></span>
            <button className="btn quiet small" onClick={() => onBack(x)}>Bring back</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
