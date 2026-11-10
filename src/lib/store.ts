// Who is signed in, their team, the team's filters and today's shared list.
// Live updates come from Supabase Realtime, so a teammate's Run or an approval
// shows up without a reload.

import { create } from "zustand";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { must, supabase } from "./supabase.ts";
import { TEAM_TZ } from "./config.ts";
import type { AppConfig, Membership, Profile, Team, TeamRun } from "./types.ts";
import type { LatLng, LunchFilters, RunSummary, Suggestion } from "./lunch.ts";

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
  /** Admin only: requests waiting for approval. */
  pending: number;
}

export const useApp = create<State>(() => ({
  status: "loading", session: null, profile: null, membership: null, teams: [], team: null, members: [], config: null, today: null, todayKey: "", pending: 0,
}));
const set = useApp.setState;
const get = useApp.getState;

/** Today's date in Montréal, YYYY-MM-DD. */
export const dayKey = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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
  if (t && get().todayKey && get().todayKey !== dayKey()) void loadToday(t.id);
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
  if (team) await Promise.all([loadToday(team.id), loadMembers(team.id)]);
  else set({ today: null, members: [] });
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
      set({ status: "signedOut", profile: null, membership: null, team: null, members: [], config: null, today: null });
    } else if (session.user.id !== prev || event === "SIGNED_IN") {
      // Supabase calls this inside its auth lock; load outside it.
      setTimeout(() => void loadAll().catch(() => set({ status: "ready" })), 0);
    }
  });
  // Coming back to the tab: catch up on anything missed while it slept.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !get().session) return;
    const t = get().team;
    if (t && get().todayKey !== dayKey()) void loadToday(t.id);
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

export async function saveRun(run: { origin: LatLng; filters: LunchFilters; suggestions: Suggestion[]; summary: RunSummary }) {
  const t = get().team;
  if (!t) throw new Error("You need to be in a team to run a search.");
  const row = must(await supabase.from("team_runs").insert({ team_id: t.id, ...run }).select("*").single()) as TeamRun;
  set({ today: row, todayKey: row.day });
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
