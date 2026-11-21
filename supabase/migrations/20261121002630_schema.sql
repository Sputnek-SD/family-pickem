-- Family pick'em schema.
-- Tables live in `private`, which is not exposed by the Data API.
-- The browser talks only to the security-definer functions in `public`.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

create table private.teams (
  id text primary key,
  name text not null unique,
  short_name text not null,
  location text not null,
  color text not null,
  logo text not null
);

create table private.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  first_name text not null,
  last_name text not null,
  kind text not null check (kind in ('regular', 'occasional')),
  active boolean not null default true,
  token_hash text unique,
  created_at timestamptz not null default now()
);

create table private.secrets (
  name text primary key,
  token_hash text
);

insert into private.secrets (name, token_hash) values ('admin', null);

create table private.app_settings (
  id int primary key default 1 check (id = 1),
  allow_test_clock boolean not null default false,
  frozen_at timestamptz
);

insert into private.app_settings (id) values (1);

create table private.seasons (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  name text not null,
  status text not null check (status in ('active', 'archived')),
  lock_mode text not null default 'deadline' check (lock_mode in ('deadline', 'kickoff')),
  lock_weekday int not null default 4 check (lock_weekday between 1 and 7),
  lock_time time not null default time '17:10',
  lock_timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index seasons_one_active on private.seasons (status) where status = 'active';

create table private.weeks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references private.seasons (id) on delete cascade,
  season_type int not null check (season_type in (2, 3)),
  week_number int not null check (week_number between 1 and 23),
  label text not null,
  lock_at timestamptz,
  scheduled_open_at timestamptz,
  mnf_total int check (mnf_total is null or (mnf_total between 0 and 150)),
  mnf_source text check (mnf_source is null or mnf_source in ('sheet', 'admin', 'scores')),
  unique (season_id, season_type, week_number)
);

create table private.games (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references private.weeks (id) on delete cascade,
  slot int not null,
  espn_id text,
  kickoff timestamptz,
  kickoff_estimated boolean not null default false,
  away_id text not null references private.teams (id),
  home_id text not null references private.teams (id),
  away_score int,
  home_score int,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'excluded')),
  is_tie boolean not null default false,
  winner_team_id text references private.teams (id),
  is_mnf boolean not null default false,
  neutral boolean not null default false,
  result_source text check (result_source is null or result_source in ('sheet', 'admin', 'espn')),
  unique (week_id, slot),
  check (away_id <> home_id),
  check (
    (status = 'final' and is_tie and winner_team_id is null)
    or (
      status = 'final' and not is_tie and winner_team_id is not null
      and (winner_team_id = away_id or winner_team_id = home_id)
    )
    or (status <> 'final' and not is_tie and winner_team_id is null)
  )
);

create unique index games_espn_id on private.games (espn_id) where espn_id is not null;

create table private.entries (
  player_id uuid not null references private.players (id),
  week_id uuid not null references private.weeks (id) on delete cascade,
  mnf_guess int check (mnf_guess is null or (mnf_guess between 0 and 150)),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (player_id, week_id)
);

create table private.picks (
  player_id uuid not null references private.players (id),
  game_id uuid not null references private.games (id) on delete cascade,
  team_id text not null references private.teams (id),
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id)
);

create table private.week_wins (
  week_id uuid not null references private.weeks (id) on delete cascade,
  player_id uuid not null references private.players (id),
  primary key (week_id, player_id)
);

create table private.audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  note text,
  payload jsonb not null default '{}'::jsonb
);

create table private.sync_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb
);

alter table private.teams enable row level security;
alter table private.teams force row level security;
alter table private.players enable row level security;
alter table private.players force row level security;
alter table private.secrets enable row level security;
alter table private.secrets force row level security;
alter table private.app_settings enable row level security;
alter table private.app_settings force row level security;
alter table private.seasons enable row level security;
alter table private.seasons force row level security;
alter table private.weeks enable row level security;
alter table private.weeks force row level security;
alter table private.games enable row level security;
alter table private.games force row level security;
alter table private.entries enable row level security;
alter table private.entries force row level security;
alter table private.picks enable row level security;
alter table private.picks force row level security;
alter table private.week_wins enable row level security;
alter table private.week_wins force row level security;
alter table private.audit enable row level security;
alter table private.audit force row level security;
alter table private.sync_log enable row level security;
alter table private.sync_log force row level security;

revoke all on all tables in schema private from public, anon, authenticated, service_role;

insert into private.teams (id, name, short_name, location, color, logo) values
  ('ARI', 'Arizona Cardinals', 'Cardinals', 'Arizona', '#97233F', 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png'),
  ('ATL', 'Atlanta Falcons', 'Falcons', 'Atlanta', '#A71930', 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png'),
  ('BAL', 'Baltimore Ravens', 'Ravens', 'Baltimore', '#241773', 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png'),
  ('BUF', 'Buffalo Bills', 'Bills', 'Buffalo', '#00338D', 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png'),
  ('CAR', 'Carolina Panthers', 'Panthers', 'Carolina', '#0085CA', 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png'),
  ('CHI', 'Chicago Bears', 'Bears', 'Chicago', '#0B162A', 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png'),
  ('CIN', 'Cincinnati Bengals', 'Bengals', 'Cincinnati', '#FB4F14', 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png'),
  ('CLE', 'Cleveland Browns', 'Browns', 'Cleveland', '#311D00', 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png'),
  ('DAL', 'Dallas Cowboys', 'Cowboys', 'Dallas', '#003594', 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png'),
  ('DEN', 'Denver Broncos', 'Broncos', 'Denver', '#FB4F14', 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png'),
  ('DET', 'Detroit Lions', 'Lions', 'Detroit', '#0076B6', 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png'),
  ('GB', 'Green Bay Packers', 'Packers', 'Green Bay', '#203731', 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png'),
  ('HOU', 'Houston Texans', 'Texans', 'Houston', '#03202F', 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png'),
  ('IND', 'Indianapolis Colts', 'Colts', 'Indianapolis', '#002C5F', 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png'),
  ('JAX', 'Jacksonville Jaguars', 'Jaguars', 'Jacksonville', '#006778', 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png'),
  ('KC', 'Kansas City Chiefs', 'Chiefs', 'Kansas City', '#E31837', 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'),
  ('LV', 'Las Vegas Raiders', 'Raiders', 'Las Vegas', '#000000', 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png'),
  ('LAC', 'Los Angeles Chargers', 'Chargers', 'Los Angeles', '#0080C6', 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png'),
  ('LAR', 'Los Angeles Rams', 'Rams', 'Los Angeles', '#003594', 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png'),
  ('MIA', 'Miami Dolphins', 'Dolphins', 'Miami', '#008E97', 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png'),
  ('MIN', 'Minnesota Vikings', 'Vikings', 'Minnesota', '#4F2683', 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png'),
  ('NE', 'New England Patriots', 'Patriots', 'New England', '#002244', 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png'),
  ('NO', 'New Orleans Saints', 'Saints', 'New Orleans', '#D3BC8D', 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png'),
  ('NYG', 'New York Giants', 'Giants', 'New York', '#0B2265', 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png'),
  ('NYJ', 'New York Jets', 'Jets', 'New York', '#125740', 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png'),
  ('PHI', 'Philadelphia Eagles', 'Eagles', 'Philadelphia', '#004C54', 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png'),
  ('PIT', 'Pittsburgh Steelers', 'Steelers', 'Pittsburgh', '#FFB612', 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png'),
  ('SEA', 'Seattle Seahawks', 'Seahawks', 'Seattle', '#002244', 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png'),
  ('SF', 'San Francisco 49ers', '49ers', 'San Francisco', '#AA0000', 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png'),
  ('TB', 'Tampa Bay Buccaneers', 'Buccaneers', 'Tampa Bay', '#D50A0A', 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png'),
  ('TEN', 'Tennessee Titans', 'Titans', 'Tennessee', '#0C2340', 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png'),
  ('WSH', 'Washington Commanders', 'Commanders', 'Washington', '#5A1414', 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');

insert into private.players (full_name, first_name, last_name, kind) values
  ('Brad Lipetzky', 'Brad', 'Lipetzky', 'regular'),
  ('Tiffany Lipetzky', 'Tiffany', 'Lipetzky', 'regular'),
  ('Timothy Lipetzky', 'Timothy', 'Lipetzky', 'regular'),
  ('Tyler Lipetzky', 'Tyler', 'Lipetzky', 'regular'),
  ('Vicki Jess', 'Vicki', 'Jess', 'regular'),
  ('Dan Spurlock', 'Dan', 'Spurlock', 'regular'),
  ('Jennifer Spurlock', 'Jennifer', 'Spurlock', 'regular'),
  ('Toby Spurlock', 'Toby', 'Spurlock', 'regular'),
  ('Adam Jess', 'Adam', 'Jess', 'regular'),
  ('Chelsea Jess', 'Chelsea', 'Jess', 'regular'),
  ('Tyler Spurlock', 'Tyler', 'Spurlock', 'occasional'),
  ('Addison Jess', 'Addison', 'Jess', 'occasional'),
  ('Ashton Jess', 'Ashton', 'Jess', 'occasional'),
  ('Jim Jess', 'Jim', 'Jess', 'occasional');
