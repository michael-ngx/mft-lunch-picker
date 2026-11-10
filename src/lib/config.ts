// The Supabase project. Both values are public by design (they ship in the page);
// the database's row-level security decides what each signed-in person can see.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://awrtogmfyfraagmhljnw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_xorDZ3y3tuXl7db-7_DMBA_UUKXyPsV";

/** Team days follow Montréal time. */
export const TEAM_TZ = "America/Toronto";

/** For development on your own computer only: your own Google Maps key, from .env.local.
 *  The team's key works only on the live site, so local copies need their own. Ignored in
 *  the live build. */
export const DEV_MAPS_KEY: string = import.meta.env.DEV ? (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "") : "";
