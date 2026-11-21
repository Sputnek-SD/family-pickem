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

You need the database password for the project (Dashboard → Project Settings → Database). You do **not** put that password, the secret key, or any player link in this repo.

1. In the Supabase dashboard, open **Database → Extensions** and enable **pg_cron** and **pg_net**. The schedule migration also tries to enable them. If it cannot, enable them here and run step 2 again.
2. From this repo, with the Supabase CLI logged in and linked to the project:

   ```bash
   supabase db push
   ```

   That applies three migrations, in order:

   - `supabase/migrations/20261121002630_schema.sql` — tables, the 32 teams, the roster
   - `supabase/migrations/20261121002631_functions.sql` — scoring, the lock, and the functions the website calls
   - `supabase/migrations/20261121002632_schedule.sql` — the score-sync jobs

   Do **not** run `supabase/seed.sql` on the hosted project. It only turns on a test clock for local development.

3. Deploy the score function:

   ```bash
   supabase functions deploy sync-nfl
   ```

   `verify_jwt` is off for this function. It accepts the project’s secret key instead, and it uses that key only on the server.

4. In the dashboard SQL editor, store two Vault secrets. Use the project’s **secret** key, never the publishable key:

   ```sql
   select vault.create_secret('https://yqbepfcgyzrvsicvxukb.supabase.co', 'project_url');
   select vault.create_secret('YOUR_SECRET_KEY', 'secret_key');
   ```

5. Confirm the jobs exist:

   ```sql
   select jobname, schedule from cron.job;
   ```

   You should see `sync-nfl-game-window` (every 10 minutes Thursday through Monday, UTC) and `sync-nfl-offdays` (every 6 hours on Tuesday and Wednesday, UTC). Tuesday morning Pacific is covered by the off-day job, so the next week opens even if a game is stuck. If the list is empty, run the schedule migration again after the extensions and the secrets are in place. The job does nothing until both secrets exist.

   The function reads ESPN’s public scoreboard. If ESPN is down it keeps the last good scores and tries again on the next run. It will not overwrite a result that came from the 2026 sheet or from Brad.

6. Load the 2026 season (weeks 1–11). This checks itself against the standings export and stops if anything does not match:

   ```bash
   DATABASE_URL='postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres' npm run import
   ```

7. Print the private links. This writes the hashes into the database and prints the links on your machine. It does not save the links in git.

   ```bash
   APP_URL='https://YOUR_PAGES_SITE' npm run tokens
   ```

   Send each person only their own link. Send Brad the admin link too. To replace a lost link, run `npm run tokens -- --rotate`.

## GitHub Pages

Pushing to `main` runs `.github/workflows/pages.yml`, which builds the site and publishes it. In the repo settings, set **Pages → Source** to **GitHub Actions** once. The site uses the public Supabase URL and the publishable key. Those are meant to be public. Row Level Security and the token checks are what keep picks private.

Players open the site, then open their private link once. Add to Home Screen works on iPhone and Android.

## How Brad starts a new season

On the admin page, under **New season**, type the year and confirm. The roster stays. The finished season is archived, with its champion (or co-champions, if the season total is tied). The new season starts empty and the score sync fills the schedule. All-time records appear once a second season exists.

From that same page Brad can correct a result, mark a game postponed or excluded, fix someone’s pick (a note is required), add or rename or deactivate a player, and change the lock. Every change is listed under Recent changes. A brand-new player still needs a link from the token script.

## Checks

```bash
npm test                 # scoring, the 2026 sheet, themes
npm run test:integration # lock, ties, postponed games, a new season, against local Postgres
npm run test:e2e         # phone and desktop, against the local API
```

Locally that is `supabase start`, then `npm run import` and `npm run tokens -- --write-local`. The integration and browser tests expect the local API at `http://127.0.0.1:54321` and Postgres at port `54322`.
