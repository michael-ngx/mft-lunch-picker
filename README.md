# MFT Lunch Picker

One shared list of lunch places a day for each team, from Google Maps, near where you are.

Live: https://mft-lunch-picker.vercel.app

## How it works

- **Accounts.** People create an account with their name, email and password, then ask to join a team. They get in once an admin approves them. The first account ever created is the admin.
- **Teams.** Each person is in one team. The team starts as **MFT Platform**; the admin can add more in Admin.
- **Team filters.** Everyone in a team shares the fixed filters, set next to the map: budget (the per-person price ranges Google Maps shows; a place's whole range must fall inside the ones picked, with an option to also allow places that show no range), radius (the circle on the map follows the slider), minimum Google rating, number of suggestions, and open now. Changes save as you make them and show for teammates right away.
- **Today's list.** **Run** uses your current location, searches Google three ways (most popular nearby, closest nearby, and a Text Search for "lunch" at the minimum rating), drops every place that fails a filter, ranks the rest, and saves the list for the team. Everyone in the team sees the same list, in the same order, for the rest of the day (Montréal time). Running again asks first, then replaces the list for everyone.
- **Ranking.** The Google rating, pulled toward 4.2 when it rests on few reviews (as if it had 30 extra ratings of 4.2), minus up to 0.3 star for distance (0 at the search spot, 0.3 at the edge of the radius). In `src/lib/lunch.ts`, tested in `tests/lunch.test.ts`.
- **Admin** (`/admin`): approve or decline requests, see and remove members, add teams, and set the Google Maps key.

## Stack

- React + TypeScript + Vite, deployed on Vercel as a static site.
- Supabase (project `mft-lunch-picker`) for sign-in, data and live updates. Schema and access rules: `supabase/migrations/0001_init.sql`. Every table has row-level security: people see only their own team's data, only approved members can read the Google key, only the admin approves people or edits the key, and the database itself records who ran a search, who changed the filters and who approved whom.
- Google Maps JavaScript API and Places API (New), called from the browser of whoever presses Run, with the key stored in the database (`app_config`).

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
- Authentication, URL Configuration: Site URL `https://mft-lunch-picker.vercel.app`.

## Contributing

1. Fork the repo (or create a branch if you were added as a collaborator) and make your change.
2. Run `npm run typecheck` and `npm test`.
3. Open a pull request into `main`. Michael reviews it; `main` only changes through approved pull requests, and every merge to `main` goes live.
4. Database changes: add a new SQL file in `supabase/migrations/` (for example `0002_…sql`) in your pull request. Michael applies it to the database when he merges. Contributors don't get database access.

Never commit secrets. The only key in this repo is the Supabase publishable key, which is public by design; anything else (secret keys, passwords, the Google Maps key) stays out of the code.
