# Family NFL Pick'em

This is the family’s straight-up NFL pool. Each week you tap a winner for every game and guess the Monday night point total. One correct pick is one point. Nothing to install: it runs in the phone browser, and it can be added to the home screen.

This copy does not talk to the old Google Form or Sheet.

## How a week works

- Picks can be changed until the lock. The last save counts.
- By default every game locks together at **Thursday 5:10 PM Pacific**, five minutes before Thursday Night Football. Brad can switch a season to “each game locks at kickoff” from the admin page. The database enforces the lock. A late save is rejected.
- A missed week scores 0 and that person is left off that week.
- A tie game is a result, and nobody gets the point.
- A game with no result is left out until a result is entered. The week cannot be awarded while one is still open. Brad can mark a game excluded so it does not count and does not hold the week up.
- The week is awarded only when every game that counts is final **and** the Monday night total is filled in. High score wins. If several people share the high score, the closest Monday guess wins. If they are still tied, each of them gets a weekly win.
- Season total is the sum of weekly correct picks. If two people finish the year on the same total, they are shown as tied. There is no season tiebreak.
- Before the lock, picks stay private. After the lock, everyone can see who picked whom. The “still need picks” line only shows names.
- The look changes on its own for Halloween week, Thanksgiving week, Christmas week, New Year’s, the playoffs, and the Super Bowl.
- No emails, texts, or push notifications.

## Players

Regulars always show in the standings. Occasional players (Tyler Spurlock, Addison, Ashton, Jim) show only after they have entered a week. Two Tylers are labeled Tyler L. and Tyler S. only when both appear in the same list.

There are no passwords. Each person gets a private link. Opening it remembers them on that phone. Brad also gets an admin link. Links are secrets. The database stores only a hash of each token.

## What you do in Supabase, in order

You do not need the database password or the project secret key. Apply the SQL with the management connection, then deploy the function. Do not run `supabase/seed.sql` on the hosted project. It only turns on a test clock for local development.

1. Enable the **pg_cron** and **pg_net** extensions.
2. Apply the migrations in filename order. If the earlier ones are already on the project, apply only the files that are not:
   - `supabase/migrations/20261121002630_schema.sql` — tables, the 32 teams, the roster
   - `supabase/migrations/20261121002631_functions.sql` — scoring, the lock, and the functions the website calls
   - `supabase/migrations/20261121002632_schedule.sql` — the score-sync jobs
   - `supabase/migrations/20261121010617_live_qa_fixes.sql` — admin hand-back, pregame scores, Monday-night sync
   - `supabase/migrations/20261121015647_faster_game_day_sync.sql` — 90-second claim throttle and the 2-minute game-day jobs

   The jobs call `https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl` with the public publishable key. There is no Vault secret.
3. Deploy the score function: `supabase functions deploy sync-nfl`. Do not set any function secrets. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the function writes with those. The publishable key is not a JWT, so the platform JWT check is off and the function checks the key itself. A second call within 90 seconds, counting claimed rows only, does not hit ESPN.
4. Confirm the jobs:

   ```sql
   select jobname, schedule from cron.job;
   ```

   You should see `sync-nfl-game-window` `*/10 * * * 0,1,4,5,6`, `sync-nfl-offdays` `20 */6 * * 2,3`, `sync-nfl-fast-evenings` `*/2 0-6 * * 0,1,2,5,6`, `sync-nfl-fast-sunday` `*/2 13-23 * * 0`, and `sync-nfl-fast-daytime` `*/2 16-23 * * 4,5,6`. There is no `sync-nfl-monday-night` job. If the list is empty, the extensions were not on yet: enable them and run the schedule migration again. If ESPN is down, the last good scores stay and the next run tries again. A result from the sheet or from Brad is not overwritten.
5. Build the 2026 import and run that file in the SQL tool:

   ```bash
   npm run import:sql > import.sql
   ```

   The last query lists mismatches with the sheet. No rows means it matches. `import.sql` is gitignored.
6. Build the links, then run only the hash file:

   ```bash
   APP_URL='https://YOUR_PAGES_SITE' npm run tokens:sql
   ```

   The command prints two paths and not the links. The text file has the links. The SQL file has only hashes. Run the SQL file, then open the text file and send each person their own link. Do not commit either file.

## GitHub Pages

Pushing to `main` runs `.github/workflows/pages.yml`, which builds the site and publishes it. GitHub Pages has to be switched on once by hand under Settings → Pages → GitHub Actions; the workflow token cannot turn it on. The site uses the public Supabase URL and the publishable key. Those are meant to be public. Row Level Security and the token checks are what keep picks private.

Players open the site, then open their private link once. Add to Home Screen works on iPhone and Android.

## How Brad starts a new season

On the admin page, under **New season**, type the year and confirm. The roster stays. The finished season is archived, with its champion (or co-champions, if the season total is tied). The new season starts empty and the score sync fills the schedule. All-time records appear once a second season exists.

From that same page Brad can correct a result, mark a game postponed or excluded, fix someone’s pick (a note is required), add or rename or deactivate a player, and change the lock. Every change is listed under Recent changes. A brand-new player still needs a link from `npm run tokens:sql`.

## Checks

```bash
npm test                 # scoring, the 2026 sheet, themes
npm run test:integration # lock, ties, postponed games, a new season, against local Postgres
npm run test:e2e         # phone and desktop, against the local API
```

Locally that is `supabase start`, then `npm run import` and `npm run tokens -- --write-local`. The integration and browser tests expect the local API at `http://127.0.0.1:54321` and Postgres at port `54322`.
