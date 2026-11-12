// The team's list as everyone sees it: places added by hand first, then the
// latest Filter's places, without never-again and Not today places, numbered
// 1, 2, 3... in that order (the same numbers as the pins on the map).
import { useMemo } from "react";
import { useApp } from "./store.ts";
import { useGeo } from "./geo.ts";
import { asSuggestion, type Suggestion } from "./lunch.ts";

export interface ListPlace extends Suggestion {
  /** Set for places added by hand. */
  addedBy?: string | null;
  addedByName?: string;
}

export function useTeamList() {
  const today = useApp((s) => s.today);
  const bans = useApp((s) => s.bans);
  const period = useApp((s) => s.teamPeriod);
  const geoPos = useGeo((s) => s.pos);
  return useMemo(() => {
    const banned = new Set(bans.map((b) => b.place_id));
    const skipped = new Set((period?.skipped ?? []).map((x) => x.id));
    const origin = today?.origin ?? geoPos ?? null;
    const added: ListPlace[] = (period?.added ?? [])
      .filter((a) => !banned.has(a.id) && !skipped.has(a.id))
      .map((a) => ({ ...asSuggestion(a, origin), addedBy: a.addedBy, addedByName: a.addedByName }));
    const addedIds = new Set(added.map((a) => a.id));
    const run: ListPlace[] = (today?.suggestions ?? []).filter((s) => !banned.has(s.id) && !skipped.has(s.id) && !addedIds.has(s.id));
    const all = [...added, ...run].map((s, i) => ({ ...s, rank: i + 1 }));
    return { all, added: all.slice(0, added.length), run: all.slice(added.length), banned, skipped, addedIds };
  }, [today, bans, period, geoPos]);
}
