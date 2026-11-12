// Who is signed in, their team, the team's filters and today's shared list.
// Live updates come from Supabase Realtime, so a teammate's Run or an approval
// shows up without a reload.

import { create } from "zustand";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { must, supabase } from "./supabase.ts";
import { TEAM_TZ } from "./config.ts";
import type { AddedPlace, AppConfig, Ban, Membership, Profile, Team, TeamDay, TeamPeriod, TeamRun } from "./types.ts";
import { toRef, type Candidate, type LatLng, type LunchFilters, type PlaceRef, type PlaceStat, type RunSummary, type Suggestion } from "./lunch.ts";

export interface Member extends Profile { status: Membership["status"] }

interface State {
  status: "loading" | "signedOut" | "ready";
  session: Session | null;
  profile: Profile | null;
  membership: Membership | null;
  teams: Team[];
  /** The team you are approved in. */
  team: Team | null;
  members: Member[];
  config: AppConfig | null;
  today: TeamRun | null;
  todayKey: string;
  /** Today's contenders and the game's pick, shared by the team. */
  teamDay: TeamDay | null;
  /** The team's never-again list. */
  bans: Ban[];
  /** Places added by hand and places marked Not today, until 9 AM. */
  teamPeriod: TeamPeriod | null;
  periodKey: string;
  /** Goes up whenever any of the team's days changes, so the History page reloads. */
  dayRev: number;
  /** Admin only: requests waiting for approval. */
  pending: number;
}

export const useApp = create<State>(() => ({
  status: "loading", session: null, profile: null, membership: null, teams: [], team: null, members: [], config: null, today: null, todayKey: "", teamDay: null, bans: [], teamPeriod: null, periodKey: "", dayRev: 0, pending: 0,
}));
const set = useApp.setState;
const get = useApp.getState;

/** Today's date in Montréal, YYYY-MM-DD. */
export const dayKey = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The lunch period: from 9 AM Montréal time to 9 AM the next day, named by its first day. */
export const periodKey = (d = new Date()) => dayKey(new Date(d.getTime() - 9 * 3_600_000));

export const isAdmin = () => get().profile?.role === "admin";

let channels: RealtimeChannel[] = [];
function unsubscribe() {
  channels.forEach((c) => void supabase.removeChannel(c));
  channels = [];
}

async function loadPending() {
  const { count } = await supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("status", "pending");
  set({ pending: count ?? 0 });
}

/** Reloads today's list when the date has changed (for a page left open overnight). */
export function checkDay() {
  const t = get().team;
  if (t && get().todayKey && get().todayKey !== dayKey()) { void loadToday(t.id); void loadTeamDay(t.id); }
  if (t && get().periodKey && get().periodKey !== periodKey()) void loadPeriod(t.id);
}

async function loadPeriod(teamId: string) {
  const key = periodKey();
  const row = must(await supabase.from("team_periods").select("*").eq("team_id", teamId).eq("period", key).maybeSingle());
  set({ teamPeriod: (row as TeamPeriod | null) ?? null, periodKey: key });
}

async function loadTeamDay(teamId: string) {
  const row = must(await supabase.from("team_days").select("*").eq("team_id", teamId).eq("day", dayKey()).maybeSingle());
  set({ teamDay: (row as TeamDay | null) ?? null });
}

async function loadBans(teamId: string) {
  const rows = must(await supabase.from("team_bans").select("*").eq("team_id", teamId).is("lifted_at", null).order("banned_at", { ascending: false }));
  set({ bans: (rows ?? []) as Ban[] });
}

async function loadToday(teamId: string) {
  const key = dayKey();
  const rows = must(await supabase.from("team_runs").select("*").eq("team_id", teamId).eq("day", key).order("run_at", { ascending: false }).limit(1));
  set({ today: ((rows ?? [])[0] as TeamRun | undefined) ?? null, todayKey: key });
}

async function loadMembers(teamId: string) {
  const ms = must(await supabase.from("memberships").select("user_id, status").eq("team_id", teamId).eq("status", "approved")) as Pick<Membership, "user_id" | "status">[];
  const ids = ms.map((m) => m.user_id);
  const ps = ids.length ? (must(await supabase.from("profiles").select("*").in("id", ids)) as Profile[]) : [];
  set({ members: ps.map((p) => ({ ...p, status: "approved" as const })).sort((a, b) => a.display_name.localeCompare(b.display_name)) });
}

/** Loads everything for the signed-in person and listens for changes. */
export async function loadAll() {
  const session = get().session;
  if (!session) return;
  const uid = session.user.id;
  const [profile, memberships, teams] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).maybeSingle().then(must),
    supabase.from("memberships").select("*").eq("user_id", uid).then(must),
    supabase.from("teams").select("*").order("name").then(must),
  ]);
  const membership = ((memberships as Membership[])[0]) ?? null;
  const team = membership?.status === "approved" ? (teams as Team[]).find((t) => t.id === membership.team_id) ?? null : null;
  set({ profile: profile as Profile | null, membership, teams: teams as Team[], team });
  if (team || (profile as Profile | null)?.role === "admin") {
    const cfg = must(await supabase.from("app_config").select("google_maps_key, map_id, updated_at").maybeSingle());
    set({ config: cfg as AppConfig | null });
  } else set({ config: null });
  if (team) await Promise.all([loadToday(team.id), loadMembers(team.id), loadTeamDay(team.id), loadBans(team.id), loadPeriod(team.id)]);
  else set({ today: null, members: [], teamDay: null, bans: [], teamPeriod: null });
  const admin = (profile as Profile | null)?.role === "admin";
  if (admin) await loadPending();
  set({ status: "ready" });
  listen(uid, team?.id ?? null, admin);
}

/** Admin page: reload after any change to requests or members. */
export const onAdminChange = (fn: () => void) => { adminListeners.add(fn); return () => void adminListeners.delete(fn); };
const adminListeners = new Set<() => void>();

function listen(uid: string, teamId: string | null, admin: boolean) {
  unsubscribe();
  // Your own request: approval, removal.
  channels.push(
    supabase.channel(`me:${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${uid}` }, () => void loadAll())
      .subscribe(),
  );
  if (admin) {
    channels.push(
      supabase.channel("admin")
        .on("postgres_changes", { event: "*", schema: "public", table: "memberships" }, () => { void loadPending(); adminListeners.forEach((f) => f()); })
        .subscribe(),
    );
  }
  if (!teamId) return;
  channels.push(
    supabase.channel(`team:${teamId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_runs", filter: `team_id=eq.${teamId}` }, () => void loadToday(teamId))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "teams", filter: `id=eq.${teamId}` }, (p) => {
        const t = p.new as Team;
        set((s) => ({ team: s.team && s.team.id === t.id ? { ...s.team, ...t } : s.team }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `team_id=eq.${teamId}` }, () => void loadMembers(teamId))
      .on("postgres_changes", { event: "*", schema: "public", table: "team_days", filter: `team_id=eq.${teamId}` }, () => {
        set((s) => ({ dayRev: s.dayRev + 1 }));
        void loadTeamDay(teamId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_bans", filter: `team_id=eq.${teamId}` }, () => void loadBans(teamId))
      .on("postgres_changes", { event: "*", schema: "public", table: "team_periods", filter: `team_id=eq.${teamId}` }, () => void loadPeriod(teamId))
      .subscribe(),
  );
}

/** Starts the session: restores a saved sign-in and follows sign-in changes. */
export function boot() {
  supabase.auth.onAuthStateChange((event, session) => {
    const prev = get().session?.user.id;
    set({ session });
    if (!session) {
      unsubscribe();
      set({ status: "signedOut", profile: null, membership: null, team: null, members: [], config: null, today: null, teamDay: null, bans: [], teamPeriod: null });
    } else if (session.user.id !== prev || event === "SIGNED_IN") {
      // Supabase calls this inside its auth lock; load outside it.
      setTimeout(() => void loadAll().catch(() => set({ status: "ready" })), 0);
    }
  });
  // Coming back to the tab: catch up on anything missed while it slept.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !get().session) return;
    void loadAll().catch(() => {});
  });
}

// ---------- actions ----------

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "That email and password don't match an account." : error.message);
}

/** Returns true when the account still needs its email confirmed. */
export async function signUp(name: string, email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: location.origin } });
  if (error) throw new Error(error.message);
  return !data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function requestJoin(teamId: string) {
  const uid = get().session!.user.id;
  must(await supabase.from("memberships").insert({ user_id: uid, team_id: teamId, status: isAdmin() ? "approved" : "pending" }));
  await loadAll();
}

export async function leaveTeam() {
  const uid = get().session!.user.id;
  must(await supabase.from("memberships").delete().eq("user_id", uid));
  await loadAll();
}

export async function saveFilters(filters: LunchFilters) {
  const t = get().team;
  if (!t) return;
  const row = must(await supabase.from("teams").update({ filters }).eq("id", t.id).select("*").single()) as Team;
  set({ team: row });
}

export async function saveRun(run: { origin: LatLng & { label?: string }; filters: LunchFilters; suggestions: Suggestion[]; summary: RunSummary }) {
  const t = get().team;
  if (!t) throw new Error("You need to be in a team to run a search.");
  const row = must(await supabase.from("team_runs").insert({ team_id: t.id, ...run }).select("*").single()) as TeamRun;
  set({ today: row, todayKey: row.day });
}

const emptyDay = (teamId: string): TeamDay => ({
  team_id: teamId, day: dayKey(), contenders: [], pick: null, picked_by: null, picked_by_name: "", picked_at: null,
  played: [], players: [], played_at: null, went: null, went_by: null, went_by_name: "", went_at: null,
});

/** Adds or removes a place from today's contenders. Shows the change at once, then
 *  takes the team's list back from the database. */
export async function setContender(placeId: string, on: boolean) {
  const t = get().team;
  if (!t) return;
  const cur = get().teamDay;
  const base: TeamDay = cur ?? emptyDay(t.id);
  const optimistic = on ? (base.contenders.includes(placeId) ? base.contenders : [...base.contenders, placeId]) : base.contenders.filter((x) => x !== placeId);
  set({ teamDay: { ...base, contenders: optimistic } });
  try {
    const contenders = must(await supabase.rpc("set_contender", { p_place: placeId, p_on: on })) as string[];
    set((s) => ({ teamDay: s.teamDay ? { ...s.teamDay, contenders } : s.teamDay }));
  } catch (e) {
    set({ teamDay: cur });
    throw e;
  }
}

/** Saves the place a game picked as the team's pick for today. */
export async function savePick(pick: Suggestion) {
  const t = get().team;
  if (!t) return;
  must(await supabase.rpc("save_pick", { p_pick: pick }));
  await loadTeamDay(t.id);
}

/** Logs a game being played with these contenders. Only players can then set
 *  where the team is going. */
export async function logGame(places: Suggestion[]) {
  must(await supabase.rpc("log_game", { p_places: places.map(toRef) }));
}

/** Sets where the team is going today (null clears it). */
export async function confirmWent(place: Suggestion | PlaceRef | null) {
  const t = get().team;
  if (!t) return;
  must(await supabase.rpc("confirm_went", { p_place: place ? toRef(place) : null }));
  await loadTeamDay(t.id);
}

/** Puts a place on (or takes it off) the team's never-again list. Shows the change at once. */
export async function setBan(place: { id: string; name: string; address: string }, on: boolean) {
  const t = get().team;
  if (!t) return;
  const before = { bans: get().bans, teamDay: get().teamDay };
  const me = get().profile;
  set((s) => ({
    bans: on
      ? [{ team_id: t.id, place_id: place.id, name: place.name, address: place.address, banned_by: me?.id ?? null, banned_by_name: me?.display_name ?? "", banned_at: new Date().toISOString() }, ...s.bans.filter((b) => b.place_id !== place.id)]
      : s.bans.filter((b) => b.place_id !== place.id),
    teamDay: on && s.teamDay ? { ...s.teamDay, contenders: s.teamDay.contenders.filter((x) => x !== place.id) } : s.teamDay,
  }));
  try {
    must(await supabase.rpc("set_ban", { p_place: place.id, p_name: place.name, p_address: place.address, p_on: on }));
    await loadBans(t.id);
  } catch (e) {
    set(before);
    throw e;
  }
}

const emptyPeriod = (teamId: string): TeamPeriod => ({ team_id: teamId, period: periodKey(), added: [], skipped: [] });

/** Runs a change to this period's places: shows it at once, then takes the team's lists back from the database. */
async function changePeriod(local: (p: TeamPeriod, d: TeamDay | null) => { p: TeamPeriod; d?: TeamDay | null }, rpc: () => Promise<unknown>) {
  const t = get().team;
  if (!t) return;
  const before = { teamPeriod: get().teamPeriod, teamDay: get().teamDay };
  const next = local(get().teamPeriod ?? emptyPeriod(t.id), get().teamDay);
  set({ teamPeriod: next.p, ...(next.d !== undefined ? { teamDay: next.d } : {}) });
  try {
    await rpc();
    await loadPeriod(t.id);
  } catch (e) {
    set(before);
    throw e;
  }
}

/** Adds a place to today's list for the team; it stays through every Filter until 9 AM. */
export function addPlace(c: Candidate) {
  const me = get().profile;
  const entry: AddedPlace = { ...c, addedBy: me?.id ?? null, addedByName: me?.display_name ?? "", addedAt: new Date().toISOString() };
  return changePeriod(
    (p) => ({ p: { ...p, added: p.added.some((a) => a.id === c.id) ? p.added : [...p.added, entry], skipped: p.skipped.filter((x) => x.id !== c.id) } }),
    async () => must(await supabase.rpc("add_place", { p_place: c })),
  );
}

/** Takes a place off the added places, or all of them with null. */
export function removeAdded(id: string | null) {
  return changePeriod(
    (p) => ({ p: { ...p, added: id === null ? [] : p.added.filter((a) => a.id !== id) } }),
    async () => must(await supabase.rpc("remove_added", { p_place: id })),
  );
}

/** Marks a place Not today until 9 AM (or brings it back). It also stops being an added place or a contender. */
export function skipToday(place: { id: string; name: string }, on: boolean) {
  const me = get().profile;
  return changePeriod(
    (p, d) => on
      ? {
        p: { ...p, added: p.added.filter((a) => a.id !== place.id), skipped: p.skipped.some((x) => x.id === place.id) ? p.skipped : [...p.skipped, { id: place.id, name: place.name, by: me?.id ?? null, byName: me?.display_name ?? "", at: new Date().toISOString() }] },
        d: d ? { ...d, contenders: d.contenders.filter((x) => x !== place.id) } : d,
      }
      : { p: { ...p, skipped: p.skipped.filter((x) => x.id !== place.id) } },
    async () => must(await supabase.rpc("skip_today", { p_place: place.id, p_name: place.name, p_on: on })),
  );
}

/** The team's played days, newest first. */
export async function loadHistory(): Promise<TeamDay[]> {
  const t = get().team;
  if (!t) return [];
  const rows = must(await supabase.from("team_days").select("*").eq("team_id", t.id).not("played_at", "is", null).order("day", { ascending: false }).limit(120));
  return (rows ?? []) as TeamDay[];
}

interface StatRow { place_id: string; shown_today: number; shown_days: number; last_shown: string | null; passed_days: number; played_days: number; last_played: string | null; went_days: number; last_went: string | null }

/** Each place's history with the team, for the suggestions. */
export async function fetchPlaceStats(): Promise<Map<string, PlaceStat>> {
  const rows = (must(await supabase.rpc("place_stats")) ?? []) as StatRow[];
  return new Map(rows.map((r) => [r.place_id, {
    shownToday: r.shown_today, shownDays: r.shown_days, lastShown: r.last_shown, passedDays: r.passed_days ?? 0,
    playedDays: r.played_days, lastPlayed: r.last_played, wentDays: r.went_days, lastWent: r.last_went,
  }]));
}

export async function saveName(name: string) {
  const uid = get().session!.user.id;
  const row = must(await supabase.from("profiles").update({ display_name: name.trim().slice(0, 60) }).eq("id", uid).select("*").single()) as Profile;
  set({ profile: row });
}

// ---------- admin ----------

export async function saveConfig(google_maps_key: string, map_id: string) {
  const row = must(await supabase.from("app_config").update({ google_maps_key, map_id, updated_at: new Date().toISOString() }).eq("id", 1).select("google_maps_key, map_id, updated_at").single()) as AppConfig;
  set({ config: row });
}

export async function approve(userId: string) {
  must(await supabase.from("memberships").update({ status: "approved" }).eq("user_id", userId));
  await loadPending();
  if (userId === get().session?.user.id) await loadAll();
}

export async function removeMembership(userId: string) {
  must(await supabase.from("memberships").delete().eq("user_id", userId));
  await loadPending();
  if (userId === get().session?.user.id) await loadAll();
}

export async function createTeam(name: string) {
  must(await supabase.from("teams").insert({ name: name.trim() }));
  await loadAll();
}
