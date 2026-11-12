import type { Candidate, LatLng, LunchFilters, PlaceRef, RunSummary, Suggestion } from "./lunch.ts";

export interface Profile { id: string; email: string; display_name: string; role: "admin" | "member"; created_at: string }
export interface Team { id: string; name: string; filters: unknown; filters_updated_by: string | null; filters_updated_at: string | null; created_at: string }
export interface Membership { user_id: string; team_id: string; status: "pending" | "approved"; requested_at: string; decided_at: string | null; decided_by: string | null }
export interface TeamRun {
  id: number; team_id: string; day: string; run_at: string; run_by: string | null; run_by_name: string;
  /** label: the address or map spot it was searched from; empty for a device location. */
  origin: LatLng & { label?: string }; filters: LunchFilters; suggestions: Suggestion[]; summary: RunSummary;
}
export interface AppConfig { google_maps_key: string; map_id: string; updated_at: string }
export interface TeamDay {
  team_id: string; day: string; contenders: string[];
  /** The last game's result. */
  pick: Suggestion | null; picked_by: string | null; picked_by_name: string; picked_at: string | null;
  /** The contenders of every game played that day, and who played. */
  played: PlaceRef[]; players: string[]; played_at: string | null;
  /** Where the team went, set with "We're going here today". */
  went: PlaceRef | null; went_by: string | null; went_by_name: string; went_at: string | null;
}
/** A place added to the list by hand, until 9 AM. */
export interface AddedPlace extends Candidate { addedBy: string | null; addedByName: string; addedAt: string }
/** A place marked Not today, until 9 AM. */
export interface SkippedPlace { id: string; name: string; by: string | null; byName: string; at: string }
/** A team's added and Not today places for one lunch period (9 AM to 9 AM). */
export interface TeamPeriod { team_id: string; period: string; added: AddedPlace[]; skipped: SkippedPlace[] }
/** A place on the team's never-again list. */
export interface Ban {
  team_id: string; place_id: string; name: string; address: string;
  banned_by: string | null; banned_by_name: string; banned_at: string;
}
