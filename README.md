# MFT Lunch Picker

One shared list of lunch places a day for each team, from Google Maps, near where you are.

Live: https://mft-lunch.michael-ngx.com (also https://mft-lunch-picker.vercel.app, which some company networks block)

## How it works

- **Accounts.** People create an account with their name, email and password, then ask to join a team. They get in once an admin approves them. The first account ever created is the admin.
- **Teams.** Each person is in one team. The team starts as **MFT Platform**; the admin can add more in Admin.
- **Team filters.** Everyone in a team shares the fixed filters, set next to the map: budget (the per-person price ranges Google Maps shows; a place's whole range must fall inside the ones picked, with an option to also allow places that show no range), radius (the circle on the map follows the slider), minimum Google rating, number of suggestions, and open now. Changes save as you make them and show for teammates right away.
- **Where you search from.** "Searching around" at the top of the list: this device's location, an address typed in (Google suggestions), or a spot picked on the map. A typed address or map spot is remembered on that device, so a computer that never shares its location (company computers often don't) goes straight to it next time without asking. Recent addresses are one tap away.
- **Today's list.** **Filter** uses that spot, searches Google three ways (most popular nearby, closest nearby, and a Text Search for "lunch" at the minimum rating), drops every place that fails a filter, ranks the rest, and saves the list for the team. Everyone in the team sees the same list, in the same order, for the rest of the day (Montréal time). Filtering again asks first, then replaces the list for everyone.
- **The list** floats over the left side of the map (a bottom sheet on phones) and can be collapsed. Each place shows its rating, price, walk and a strip of up to 3 Google photos. Quick chips above the list (Contenders, Within 5 min, 4.5★ and up, Open, price) only change what you see; they never remove places from the team's list.
- **Contenders.** Tick places to put them forward. Contenders are shared by the team for the day, so everyone sees the same set and can add or remove places.
- **Let's choose** (the red button in the corner) takes the contenders to a game. **Spin the Wheel** is the first game: each contender gets an equal slice, the wheel picks one at random, and the result pops up with photos, details and a Google Maps link, with confetti. The pick is saved as **Today's pick** for the team and shows at the top of the list. More games can be added as cards on the game page (`src/pages/ChoosePage.tsx`).
- **Ranking.** The Google rating, pulled toward 4.2 when it rests on few reviews (as if it had 30 extra ratings of 4.2), minus up to 0.3 star for distance (0 at the search spot, 0.3 at the edge of the radius). In `src/lib/lunch.ts`, tested in `tests/lunch.test.ts`.
- **Admin** (`/admin`): approve or decline requests, see and remove members, add teams, and set the Google Maps key.

## Stack

- React + TypeScript + Vite, deployed on Vercel as a static site.
- Supabase (project `mft-lunch-picker`) for sign-in, data and live updates. Schema and access rules: `supabase/migrations/0001_init.sql`. Every table has row-level security: people see only their own team's data, only approved members can read the Google key, only the admin approves people or edits the key, and the database itself records who ran a search, who changed the filters and who approved whom.
- Google Maps JavaScript API and Places API (New), called from the browser of whoever presses Filter, with the key stored in the database (`app_config`).
- Contenders and Today's pick: table `team_days` (one row per team per day), changed only through the database functions `set_contender` and `save_pick` (`supabase/migrations/0002_contenders_and_pick.sql`), so simultaneous clicks don't overwrite each other.
- Address search uses Places Autocomplete (New) and a Place Details call for the chosen address (Essentials level, about 10,000 free a month each).
- Photos: Google bills each photo it serves (Place Details Photos: 1,000 free a month, then about $7 per 1,000). Each Filter fetches up to 3 photos for each place on the list and, where Google allows, stores the image's final address with the list, so teammates viewing the list don't add photo charges. With 8 places that is about 24 photo calls per Filter.

The Supabase URL and publishable key are in `src/lib/config.ts`. Both are public by design; row-level security decides what each person can see.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # filter and ranking rules
npm run typecheck
```

The local site uses the same Supabase project as the live one. For the map, the Google key's website restrictions need `http://localhost:5173/*`.

## Supabase settings set in its dashboard

- Authentication, Sign In / Providers, Email: **Confirm email off**. The admin approves everyone, and Supabase's built-in email sends only a few messages an hour.
- Authentication, URL Configuration: Site URL `https://mft-lunch.michael-ngx.com`.

## Contributing

1. Fork the repo (or create a branch if you were added as a collaborator) and make your change.
2. Run `npm run typecheck` and `npm test`.
3. Open a pull request into `main`. Michael reviews it; `main` only changes through approved pull requests, and every merge to `main` goes live.
4. Database changes: add a new SQL file in `supabase/migrations/` (for example `0002_…sql`) in your pull request. Michael applies it to the database when he merges. Contributors don't get database access.

Never commit secrets. The only key in this repo is the Supabase publishable key, which is public by design; anything else (secret keys, passwords, the Google Maps key) stays out of the code.
