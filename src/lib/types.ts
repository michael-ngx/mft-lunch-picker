import type { LatLng, LunchFilters, RunSummary, Suggestion } from "./lunch.ts";

export interface Profile { id: string; email: string; display_name: string; role: "admin" | "member"; created_at: string }
export interface Team { id: string; name: string; filters: unknown; filters_updated_by: string | null; filters_updated_at: string | null; created_at: string }
export interface Membership { user_id: string; team_id: string; status: "pending" | "approved"; requested_at: string; decided_at: string | null; decided_by: string | null }
export interface TeamRun {
  id: number; team_id: string; day: string; run_at: string; run_by: string | null; run_by_name: string;
  origin: LatLng; filters: LunchFilters; suggestions: Suggestion[]; summary: RunSummary;
}
export interface AppConfig { google_maps_key: string; map_id: string; updated_at: string }
export interface TeamDay {
  team_id: string; day: string; contenders: string[]; pick: Suggestion | null;
  picked_by: string | null; picked_by_name: string; picked_at: string | null;
}
