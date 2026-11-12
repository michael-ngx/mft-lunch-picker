# MFT Lunch Picker

One shared list of lunch places a day for each team, from Google Maps, near where you are.

Live: https://mft-lunch.michael-ngx.com (also https://mft-lunch-picker.vercel.app, which some company networks block)

## How it works

- **Accounts.** People create an account with their name, email and password, then ask to join a team. They get in once an admin approves them. The first account ever created is the admin.
- **Teams.** Each person is in one team. The team starts as **MFT Platform**; the admin can add more in Admin.
- **Team filters.** Everyone in a team shares the fixed filters, set next to the map: budget (the per-person price ranges Google Maps shows; a place's whole range must fall inside the ones picked, with an option to also allow places that show no range), radius (the circle on the map follows the slider), minimum Google rating, number of suggestions, and open now. Changes save as you make them and show for teammates right away.
- **Where you search from.** "Searching around" at the top of the list: this device's location, an address typed in (Google suggestions), or a spot picked on the map. A typed address or map spot is remembered on that device, so a computer that never shares its location (company computers often don't) goes straight to it next time without asking. Recent addresses are one tap away.
- **Today's list.** **Filter** uses that spot, searches Google four ways (most popular in the radius, closest to a random spot inside the radius, a Text Search for "lunch", and a Text Search for one cuisine that changes each time), drops every place that fails a filter, draws the list (see below) and saves it for the team. Everyone in the team sees the same list, in the same order, for the rest of the day (Montréal time). Pressing Filter again replaces the list for everyone straight away: today's contenders stay at the top and the rest are new places.
- **The list** is the main part of the page, with the map beside it (above it on phones). Each place shows its rating, price, walk and a strip of up to 3 Google photos, with the same number as its pin on the map. Quick chips above the list (Contenders, Within 5 min, 4.5★ and up, Open, price) only change what you see; they never remove places from the team's list.
- **Contenders.** Tick places to put them forward. Contenders are shared by the team for the day, so everyone sees the same set and can add or remove places.
- **Add a place.** Search Google by name and add a place to today's list for the team. Added places come first, have their own pin colour, ignore the team filters and stay through every Filter until 9 AM, when the list of added places empties. **Remove** takes one off; **Clear all** takes them all off.
- **Not today.** Each place has a **Not today** button: it leaves the list for everyone and Filter and Random pick leave it out until 9 AM. It can be undone right away, and the **Not today** list under the places brings any of them back.
- **Random pick** (top of the list): one place from around the search spot, chosen at random among those that pass the team filters and are not on the never-again or Not today lists, each with the same chance. **Pick another** shows a different place until every place has had a turn. Only you see it; **Add to today's list** puts it on the team's list. It reuses the last search's places, so it costs nothing extra after a Filter.
- **Never again.** Each place on the list has a **Never again** button. Anyone in the team can use it; the place leaves the list for everyone and is never suggested to the team again. It can be undone right away, and anyone can allow the place again from History.
- **Let's choose** (the red button in the corner) takes the contenders to a game. **Spin the Wheel** is the first game: each contender gets an equal slice, the wheel picks one at random, and the result pops up with photos, details and a Google Maps link, with confetti. Each spin logs the game's contenders in the team's history. The person who spun can press **We're going here today** in the result to log that place as where the team went; spinning again and pressing it on another result changes it. More games can be added as cards on the game page (`src/pages/ChoosePage.tsx`).
- **History** (`/history`, for everyone in the team): every day a game was played, with its contenders, the wheel's last result, where the team went and who set it; the team's most chosen places; and the never-again list.
- **How suggestions are chosen** (`src/lib/lunch.ts`, tested in `tests/lunch.test.ts`). Every place that passes the filters gets a score in stars:
  - its Google rating, pulled toward 4.2 when it rests on few reviews (as if it had 30 extra ratings of 4.2);
  - minus up to 0.3 for distance (0 at the search spot, 0.3 at the edge of the radius);
  - plus 0.25 if it is new for the team (not shown in the last year and never a contender);
  - minus up to 0.8 if the team went there recently (0.8 the same day, about half that 4 days later, almost nothing after 3 weeks);
  - plus 0.06 for each day it was a contender or the team went there (up to 4 days);
  - minus 0.06 for each earlier day in the last 3 weeks it was shown but was not a contender in that day's game (up to 0.3);
  - minus 0.3 for each list today that already showed it (up to 0.6), so Filter again brings new places.

  The list is then drawn at random, one place at a time, with higher scores more likely: a place scoring 0.25 more is about 2.7 times as likely to be drawn first. Each place of the same kind (Ramen, Pizza, ...) already drawn takes 0.15 off the others of that kind. A list of 4 or more always includes a place new for the team when there is one. Each place shows a label explaining it: "New for the team", "Went 5 days ago", "Contender 3 times before". The numbers are in `TUNING` in `src/lib/lunch.ts`.
- **Admin** (`/admin`): approve or decline requests, see and remove members, add teams, and set the Google Maps key.

## Stack

- React + TypeScript + Vite, deployed on Vercel as a static site.
- Supabase (project `mft-lunch-picker`) for sign-in, data and live updates. Schema and access rules: `supabase/migrations/0001_init.sql`. Every table has row-level security: people see only their own team's data, only approved members can read the Google key, only the admin approves people or edits the key, and the database itself records who ran a search, who changed the filters and who approved whom.
- Google Maps JavaScript API and Places API (New), called from the browser of whoever presses Filter, with the key stored in the database (`app_config`). In Google Cloud, limit the key to the live addresses and to those two APIs.
- Contenders and the game result: table `team_days` (one row per team per day), changed only through the database functions `set_contender` and `save_pick` (`supabase/migrations/0002_contenders_and_pick.sql`), so simultaneous clicks don't overwrite each other.
- History and never again (`supabase/migrations/0003_history_and_never_again.sql`): `log_game` adds a game's contenders and the player to the day; `confirm_went` sets where the team went, and only accepts someone who played that day and a place from that day's games; `team_bans` holds the never-again list, changed through `set_ban`; `place_stats` returns each place's history with the team for the suggestions.
- Added places and Not today (`supabase/migrations/0005_added_places_and_not_today.sql`): table `team_periods`, one row per team per lunch period (9 AM to 9 AM Montréal time), changed through `add_place`, `remove_added` and `skip_today`.
- Address search uses Places Autocomplete (New) and a Place Details call for the chosen address (Essentials level, about 10,000 free a month each).
- Adding a place by name uses Places Autocomplete and one Place Details call (Enterprise level: 1,000 free a month) plus its photos.
- Searches: each Filter makes 2 Nearby Searches and 2 Text Searches. Asking for ratings, prices and hours makes them Enterprise-level calls: 1,000 free a month for each of the two, then about $35 per 1,000. That covers about 500 Filters a month.
- Photos: Google bills each photo it serves (Place Details Photos: 1,000 free a month, then about $7 per 1,000). Each Filter fetches up to 3 photos for each place on the list and, where Google allows, stores the image's final address with the list, so teammates viewing the list don't add photo charges. With 8 places that is about 24 photo calls per Filter; contenders kept from the list before keep their photos and cost nothing.

The Supabase URL and publishable key are in `src/lib/config.ts`. Both are public by design; row-level security decides what each person can see.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # filter rules and how suggestions are drawn
npm run typecheck
```

The local site uses the same Supabase project as the live one, so you sign in with your normal account (an admin approves you as usual).

The team's Google Maps key only works on the live addresses, not on `localhost`. For the map and search on your own computer, create your own key in Google Cloud (Maps JavaScript API and Places API (New), restricted to `http://localhost:5173/*`; Google's free monthly allowance covers development) and put it in `.env.local`:

```sh
echo "VITE_GOOGLE_MAPS_KEY=your-key" > .env.local
```

The live build ignores this setting.

## Supabase settings set in its dashboard

- Authentication, Sign In / Providers, Email: **Confirm email off**. The admin approves everyone, and Supabase's built-in email sends only a few messages an hour.
- Authentication, URL Configuration: Site URL `https://mft-lunch.michael-ngx.com`.

## Contributing

1. Fork the repo (or create a branch if you were added as a collaborator) and make your change.
2. Run `npm run typecheck` and `npm test`.
3. Open a pull request into `main`. Michael reviews it; `main` only changes through approved pull requests, and every merge to `main` goes live.
4. Database changes: add a new SQL file in `supabase/migrations/` (for example `0006_…sql`) in your pull request. Michael applies it to the database when he merges. Contributors don't get database access.

Never commit secrets. The only key in this repo is the Supabase publishable key, which is public by design; anything else (secret keys, passwords, the Google Maps key) stays out of the code.
