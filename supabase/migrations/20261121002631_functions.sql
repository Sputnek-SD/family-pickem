-- Scoring, lock enforcement, and the API the website calls.
-- Helpers stay in `private`. Public wrappers are the only functions granted to the browser.

create or replace function private.app_now()
returns timestamptz
language sql
stable
as $$
  select coalesce((select frozen_at from private.app_settings where id = 1), now());
$$;

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
as $$
  select case
    when p_token is null or length(p_token) < 20 then null
    else encode(extensions.digest(p_token, 'sha256'), 'hex')
  end;
$$;

create or replace function private.player_from_token(p_token text)
returns uuid
language sql
stable
as $$
  select id from private.players
  where token_hash is not null
    and token_hash = private.token_hash(p_token)
    and active;
$$;

create or replace function private.admin_ok(p_token text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from private.secrets
    where name = 'admin'
      and token_hash is not null
      and token_hash = private.token_hash(p_token)
  );
$$;

create or replace function private.require_admin(p_token text)
returns void
language plpgsql
as $$
begin
  if not private.admin_ok(p_token) then
    raise exception 'Admin link required' using errcode = '28000';
  end if;
end;
$$;

create or replace function private.require_note(p_note text)
returns text
language plpgsql
as $$
begin
  if p_note is null or length(trim(p_note)) < 3 then
    raise exception 'Add a short note so this change is logged';
  end if;
  return trim(p_note);
end;
$$;

create or replace function private.audit(p_action text, p_note text, p_payload jsonb)
returns void
language plpgsql
as $$
begin
  insert into private.audit (action, note, payload)
  values (p_action, p_note, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function private.week_label(p_type int, p_num int)
returns text
language sql
immutable
as $$
  select case
    when p_type = 2 then 'Week ' || p_num
    when p_type = 3 and p_num = 1 then 'Wild Card'
    when p_type = 3 and p_num = 2 then 'Divisional'
    when p_type = 3 and p_num = 3 then 'Conference Championships'
    when p_type = 3 and p_num = 4 then 'Super Bowl'
    else 'Playoffs ' || p_num
  end;
$$;

create or replace function private.game_locked(p_game uuid)
returns boolean
language sql
stable
as $$
  select case s.lock_mode
    when 'kickoff' then private.app_now() >= coalesce(g.kickoff, w.lock_at)
    else w.lock_at is not null and private.app_now() >= w.lock_at
  end
  from private.games g
  join private.weeks w on w.id = g.week_id
  join private.seasons s on s.id = w.season_id
  where g.id = p_game;
$$;

create or replace function private.guess_locked(p_week uuid)
returns boolean
language sql
stable
as $$
  select case s.lock_mode
    when 'kickoff' then private.app_now() >= coalesce(
      (select g.kickoff from private.games g
        where g.week_id = w.id and g.is_mnf
        order by g.kickoff desc nulls last limit 1),
      w.lock_at)
    else w.lock_at is not null and private.app_now() >= w.lock_at
  end
  from private.weeks w
  join private.seasons s on s.id = w.season_id
  where w.id = p_week;
$$;

create or replace function private.week_games_done(p_week uuid)
returns boolean
language sql
stable
as $$
  select exists (
      select 1 from private.games g
      where g.week_id = p_week and g.status <> 'excluded'
    )
    and not exists (
      select 1 from private.games g
      where g.week_id = p_week and g.status not in ('final', 'excluded')
    );
$$;

create or replace function private.week_complete(p_week uuid)
returns boolean
language sql
stable
as $$
  select w.mnf_total is not null and private.week_games_done(w.id)
  from private.weeks w
  where w.id = p_week;
$$;

create or replace function private.scores_visible(p_week uuid)
returns boolean
language sql
stable
as $$
  select case s.lock_mode
    when 'kickoff' then exists (
      select 1 from private.games g
      where g.week_id = w.id and private.game_locked(g.id)
    )
    else w.lock_at is not null and private.app_now() >= w.lock_at
  end
  from private.weeks w
  join private.seasons s on s.id = w.season_id
  where w.id = p_week;
$$;

create or replace function private.entry_correct(p_player uuid, p_week uuid)
returns int
language sql
stable
as $$
  select count(*)::int
  from private.picks pk
  join private.games g on g.id = pk.game_id
  where pk.player_id = p_player
    and g.week_id = p_week
    and g.status = 'final'
    and g.is_tie = false
    and pk.team_id = g.winner_team_id;
$$;

create or replace function private.award_week(p_week uuid)
returns void
language plpgsql
as $$
begin
  delete from private.week_wins where week_id = p_week;
  if not coalesce(private.week_complete(p_week), false) then
    return;
  end if;

  insert into private.week_wins (week_id, player_id)
  with scored as (
    select e.player_id,
           private.entry_correct(e.player_id, e.week_id) as correct,
           case
             when e.mnf_guess is not null and w.mnf_total is not null
               then abs(e.mnf_guess - w.mnf_total)
           end as diff
    from private.entries e
    join private.weeks w on w.id = e.week_id
    where e.week_id = p_week
  ),
  mx as (select max(correct) as m from scored),
  elig as (
    select * from scored
    where correct = (select m from mx) and diff is not null
  )
  select p_week, player_id
  from elig
  where diff = (select min(diff) from elig);
end;
$$;

create or replace function private.slate_sunday(p_week uuid)
returns date
language sql
stable
as $$
  with days as (
    select (g.kickoff at time zone 'America/Los_Angeles')::date as d, count(*) as n
    from private.games g
    where g.week_id = p_week and g.kickoff is not null and g.status <> 'excluded'
    group by 1
  ),
  sundays as (
    select d, n from days where extract(dow from d) = 0
  )
  select d from sundays order by n desc, d desc limit 1;
$$;

create or replace function private.recompute_week_times(p_week uuid)
returns void
language plpgsql
as $$
declare
  w private.weeks%rowtype;
  s private.seasons%rowtype;
  v_sunday date;
  v_lock_date date;
  v_open date;
  v_prev uuid;
  v_lock timestamptz;
  v_open_at timestamptz;
begin
  select * into w from private.weeks where id = p_week;
  select * into s from private.seasons where id = w.season_id;
  v_sunday := private.slate_sunday(p_week);
  if v_sunday is null then
    select (min(kickoff) at time zone 'America/Los_Angeles')::date
      into v_sunday
    from private.games
    where week_id = p_week and kickoff is not null;
    if v_sunday is not null and extract(dow from v_sunday) <> 0 then
      v_sunday := v_sunday + ((7 - extract(dow from v_sunday)::int) % 7);
    end if;
  end if;

  if v_sunday is not null then
    v_lock_date := v_sunday - (7 - s.lock_weekday);
    v_lock := (v_lock_date::timestamp + s.lock_time) at time zone s.lock_timezone;
  end if;

  select id into v_prev
  from private.weeks
  where season_id = w.season_id
    and (season_type, week_number) < (w.season_type, w.week_number)
  order by season_type desc, week_number desc
  limit 1;

  if v_prev is null then
    if v_lock_date is not null then
      v_open := v_lock_date - 2;
      v_open_at := (v_open::timestamp + time '08:00') at time zone s.lock_timezone;
    end if;
  else
    v_sunday := private.slate_sunday(v_prev);
    if v_sunday is not null then
      v_open := v_sunday + 2;
      v_open_at := (v_open::timestamp + time '08:00') at time zone s.lock_timezone;
    end if;
  end if;

  update private.weeks
    set lock_at = coalesce(v_lock, lock_at),
        scheduled_open_at = coalesce(v_open_at, scheduled_open_at)
  where id = p_week;
end;
$$;

create or replace function private.week_released(p_week uuid)
returns boolean
language plpgsql
stable
as $$
declare
  w private.weeks%rowtype;
  v_prev uuid;
begin
  select * into w from private.weeks where id = p_week;
  if not found then return false; end if;
  select id into v_prev
  from private.weeks
  where season_id = w.season_id
    and (season_type, week_number) < (w.season_type, w.week_number)
  order by season_type desc, week_number desc
  limit 1;
  if v_prev is null then return true; end if;
  if w.scheduled_open_at is not null and private.app_now() >= w.scheduled_open_at then
    return true;
  end if;
  return coalesce(private.week_games_done(v_prev), false);
end;
$$;

create or replace function private.current_week_id(p_season uuid)
returns uuid
language sql
stable
as $$
  select w.id
  from private.weeks w
  where w.season_id = p_season
    and private.week_released(w.id)
  order by (not coalesce(private.week_complete(w.id), false)) desc,
           w.season_type desc,
           w.week_number desc
  limit 1;
$$;

create or replace function private.team_json(p_id text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'short_name', t.short_name,
    'location', t.location,
    'color', t.color,
    'logo', t.logo
  )
  from private.teams t
  where t.id = p_id;
$$;

create or replace function private.pick_team_ok()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from private.games g
    where g.id = new.game_id and new.team_id in (g.away_id, g.home_id)
  ) then
    raise exception 'Pick must be one of the two teams playing';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_pick_lock()
returns trigger
language plpgsql
as $$
declare
  v_week uuid;
begin
  if coalesce(current_setting('private.bypass_lock', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id then
    return new;
  end if;
  select week_id into v_week from private.games where id = new.game_id;
  if coalesce(private.week_complete(v_week), false) or coalesce(private.game_locked(new.game_id), false) then
    raise exception 'Picks are locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_guess_lock()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('private.bypass_lock', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.mnf_guess is not distinct from old.mnf_guess then
    return new;
  end if;
  if coalesce(private.week_complete(new.week_id), false) or coalesce(private.guess_locked(new.week_id), false) then
    raise exception 'Picks are locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists picks_team_ok on private.picks;
create trigger picks_team_ok before insert or update on private.picks
for each row execute function private.pick_team_ok();

drop trigger if exists picks_lock on private.picks;
create trigger picks_lock before insert or update on private.picks
for each row execute function private.enforce_pick_lock();

drop trigger if exists entries_lock on private.entries;
create trigger entries_lock before insert or update on private.entries
for each row execute function private.enforce_guess_lock();

create or replace function private.game_json(p_game uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', g.id,
    'week_id', g.week_id,
    'slot', g.slot,
    'kickoff', g.kickoff,
    'status', g.status,
    'is_tie', g.is_tie,
    'is_mnf', g.is_mnf,
    'neutral', g.neutral,
    'away_score', g.away_score,
    'home_score', g.home_score,
    'winner_team_id', g.winner_team_id,
    'locked', private.game_locked(g.id),
    'result_source', g.result_source,
    'away', private.team_json(g.away_id),
    'home', private.team_json(g.home_id)
  )
  from private.games g
  where g.id = p_game;
$$;

create or replace function private.season_player_total(p_player uuid, p_season uuid)
returns int
language sql
stable
as $$
  select coalesce(sum(private.entry_correct(e.player_id, e.week_id)), 0)::int
  from private.entries e
  join private.weeks w on w.id = e.week_id
  where e.player_id = p_player and w.season_id = p_season;
$$;

-- Totals shown on screen hide a week until that week's picks are public.
create or replace function private.display_total(p_player uuid, p_season uuid, p_viewer uuid)
returns int
language sql
stable
as $$
  select coalesce(sum(
    case
      when p_player = p_viewer or private.scores_visible(w.id)
        then private.entry_correct(e.player_id, e.week_id)
      else 0
    end
  ), 0)::int
  from private.entries e
  join private.weeks w on w.id = e.week_id
  where e.player_id = p_player and w.season_id = p_season;
$$;

create or replace function private.player_in_season(p_player uuid, p_season uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from private.entries e
    join private.weeks w on w.id = e.week_id
    where e.player_id = p_player and w.season_id = p_season
  );
$$;

create or replace function private.save_picks(
  p_token text,
  p_week uuid,
  p_picks jsonb,
  p_mnf int
)
returns jsonb
language plpgsql
as $$
declare
  v_player uuid;
  v_item jsonb;
  v_game uuid;
  v_team text;
begin
  v_player := private.player_from_token(p_token);
  if v_player is null then
    raise exception 'That link does not match an active player' using errcode = '28000';
  end if;
  if not exists (
    select 1 from private.weeks w
    join private.seasons s on s.id = w.season_id
    where w.id = p_week and s.status = 'active'
  ) then
    raise exception 'That week is not open for picks';
  end if;
  if p_mnf is not null and (p_mnf < 0 or p_mnf > 150) then
    raise exception 'Monday total must be between 0 and 150';
  end if;

  insert into private.entries (player_id, week_id, mnf_guess, submitted_at, updated_at)
  values (v_player, p_week, p_mnf, private.app_now(), private.app_now())
  on conflict (player_id, week_id) do update
    set mnf_guess = excluded.mnf_guess,
        updated_at = private.app_now(),
        submitted_at = coalesce(private.entries.submitted_at, excluded.submitted_at);

  if p_picks is not null then
    for v_item in select value from jsonb_array_elements(p_picks)
    loop
      v_game := (v_item->>'game_id')::uuid;
      v_team := v_item->>'team_id';
      if v_team is null or v_team = '' then
        continue;
      end if;
      if not exists (
        select 1 from private.games g where g.id = v_game and g.week_id = p_week
      ) then
        raise exception 'That game is not in this week';
      end if;
      insert into private.picks (player_id, game_id, team_id, updated_at)
      values (v_player, v_game, v_team, private.app_now())
      on conflict (player_id, game_id) do update
        set team_id = excluded.team_id,
            updated_at = private.app_now();
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.missing_json(p_week uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'full_name', p.full_name,
    'first_name', p.first_name,
    'last_name', p.last_name
  ) order by p.full_name), '[]'::jsonb)
  from private.players p
  where p.active and p.kind = 'regular'
    and (
      not exists (
        select 1 from private.entries e
        where e.player_id = p.id and e.week_id = p_week and e.mnf_guess is not null
      )
      or exists (
        select 1 from private.games g
        where g.week_id = p_week and g.status <> 'excluded'
          and not exists (
            select 1 from private.picks pk
            where pk.player_id = p.id and pk.game_id = g.id
          )
      )
    );
$$;

create or replace function private.standings_json(p_season uuid, p_viewer uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(row_json order by total desc, full_name), '[]'::jsonb)
  from (
    select
      p.full_name,
      private.display_total(p.id, p_season, p_viewer) as total,
      jsonb_build_object(
        'player_id', p.id,
        'full_name', p.full_name,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'kind', p.kind,
        'active', p.active,
        'total', private.display_total(p.id, p_season, p_viewer),
        'wins', (
          select count(*)::int from private.week_wins ww
          join private.weeks w on w.id = ww.week_id
          where ww.player_id = p.id and w.season_id = p_season
        ),
        'weeks', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'week_id', w.id,
            'season_type', w.season_type,
            'week_number', w.week_number,
            'label', w.label,
            'entered', e.player_id is not null,
            'score', case
              when e.player_id is null then null
              when p.id = p_viewer or private.scores_visible(w.id)
                then private.entry_correct(p.id, w.id)
              else null
            end,
            'winner', exists (
              select 1 from private.week_wins ww
              where ww.week_id = w.id and ww.player_id = p.id
            )
          ) order by w.season_type, w.week_number), '[]'::jsonb)
          from private.weeks w
          left join private.entries e on e.week_id = w.id and e.player_id = p.id
          where w.season_id = p_season
        )
      ) as row_json
    from private.players p
    where p.kind = 'regular' or private.player_in_season(p.id, p_season)
  ) s;
$$;

create or replace function private.leaderboard_json(p_week uuid)
returns jsonb
language sql
stable
as $$
  select case when private.scores_visible(p_week) then
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.id,
        'full_name', p.full_name,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'correct', private.entry_correct(p.id, p_week),
        'guess', case when private.guess_locked(p_week) then e.mnf_guess else null end,
        'diff', case
          when private.guess_locked(p_week) and e.mnf_guess is not null and w.mnf_total is not null
            then abs(e.mnf_guess - w.mnf_total)
          else null
        end,
        'winner', exists (
          select 1 from private.week_wins ww
          where ww.week_id = p_week and ww.player_id = p.id
        )
      ) order by private.entry_correct(p.id, p_week) desc, p.full_name)
      from private.entries e
      join private.players p on p.id = e.player_id
      join private.weeks w on w.id = e.week_id
      where e.week_id = p_week
    ), '[]'::jsonb)
  else null end;
$$;

create or replace function private.weeks_json(p_season uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'season_type', w.season_type,
    'week_number', w.week_number,
    'label', w.label,
    'lock_at', w.lock_at,
    'scheduled_open_at', w.scheduled_open_at,
    'complete', private.week_complete(w.id),
    'mnf_total', w.mnf_total,
    'released', private.week_released(w.id),
    'winner_ids', coalesce((
      select jsonb_agg(ww.player_id) from private.week_wins ww where ww.week_id = w.id
    ), '[]'::jsonb)
  ) order by w.season_type, w.week_number), '[]'::jsonb)
  from private.weeks w
  where w.season_id = p_season;
$$;

create or replace function private.champions_json(p_season uuid)
returns jsonb
language sql
stable
as $$
  with totals as (
    select p.id, p.full_name, p.first_name, p.last_name,
           private.display_total(p.id, p_season, null) as total
    from private.players p
    where p.kind = 'regular' or private.player_in_season(p.id, p_season)
  ),
  best as (select max(total) as m from totals)
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', id,
    'full_name', full_name,
    'first_name', first_name,
    'last_name', last_name,
    'total', total
  ) order by full_name), '[]'::jsonb)
  from totals, best
  where total = m and m > 0;
$$;

create or replace function private.all_time_json()
returns jsonb
language plpgsql
stable
as $$
declare
  v_seasons int;
begin
  select count(*) into v_seasons from private.seasons;
  if v_seasons < 2 then
    return null;
  end if;

  return jsonb_build_object(
    'titles', coalesce((
      with totals as (
        select s.id as season_id, p.id, p.full_name, p.first_name, p.last_name,
               private.season_player_total(p.id, s.id) as total
        from private.seasons s
        join private.players p on p.kind = 'regular' or private.player_in_season(p.id, s.id)
        where s.status = 'archived'
      ),
      champs as (
        select * from totals t
        where t.total = (select max(total) from totals x where x.season_id = t.season_id)
          and t.total > 0
      )
      select jsonb_agg(jsonb_build_object(
        'player_id', id,
        'full_name', full_name,
        'first_name', first_name,
        'last_name', last_name,
        'titles', titles
      ) order by titles desc, full_name)
      from (
        select id, full_name, first_name, last_name, count(*)::int as titles
        from champs group by id, full_name, first_name, last_name
      ) c
    ), '[]'::jsonb),
    'best_season', coalesce((
      with totals as (
        select s.year, p.id, p.full_name, p.first_name, p.last_name,
               private.season_player_total(p.id, s.id) as total
        from private.seasons s
        join private.players p on true
      ),
      best as (select max(total) as m from totals)
      select jsonb_agg(jsonb_build_object(
        'player_id', id, 'full_name', full_name, 'first_name', first_name,
        'last_name', last_name, 'total', total, 'year', year
      ) order by year, full_name)
      from totals, best where total = m and m > 0
    ), '[]'::jsonb),
    'weekly_wins', coalesce((
      with wins as (
        select p.id, p.full_name, p.first_name, p.last_name, count(ww.week_id)::int as wins
        from private.players p
        left join private.week_wins ww on ww.player_id = p.id
        group by p.id, p.full_name, p.first_name, p.last_name
      ),
      best as (select max(wins) as m from wins)
      select jsonb_agg(jsonb_build_object(
        'player_id', id, 'full_name', full_name, 'first_name', first_name,
        'last_name', last_name, 'wins', wins
      ) order by full_name)
      from wins, best where wins = m and m > 0
    ), '[]'::jsonb),
    'best_week', coalesce((
      with scores as (
        select p.id, p.full_name, p.first_name, p.last_name,
               w.label, s.year, private.entry_correct(e.player_id, e.week_id) as score
        from private.entries e
        join private.players p on p.id = e.player_id
        join private.weeks w on w.id = e.week_id
        join private.seasons s on s.id = w.season_id
        where private.week_complete(w.id)
      ),
      best as (select max(score) as m from scores)
      select jsonb_agg(jsonb_build_object(
        'player_id', id, 'full_name', full_name, 'first_name', first_name,
        'last_name', last_name, 'score', score, 'label', label, 'year', year
      ) order by year, label, full_name)
      from scores, best where score = m
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.bootstrap(p_player_token text, p_admin_token text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_player uuid := private.player_from_token(p_player_token);
  v_admin boolean := private.admin_ok(p_admin_token);
  v_season private.seasons%rowtype;
  v_week uuid;
  v_live uuid;
  v_phase text := 'regular';
  v_label text;
  v_type int;
begin
  if v_player is null and not v_admin then
    return jsonb_build_object(
      'now', private.app_now(),
      'authenticated', false,
      'bad_token', p_player_token is not null and length(trim(p_player_token)) > 0
    );
  end if;

  select * into v_season from private.seasons where status = 'active';
  if not found then
    return jsonb_build_object(
      'now', private.app_now(),
      'authenticated', true,
      'me', case when v_player is null then null else (
        select jsonb_build_object(
          'player_id', id, 'full_name', full_name, 'first_name', first_name, 'last_name', last_name
        ) from private.players where id = v_player
      ) end,
      'is_admin', v_admin,
      'season', null
    );
  end if;

  v_week := private.current_week_id(v_season.id);
  select label, season_type into v_label, v_type from private.weeks where id = v_week;
  if v_type = 3 and (v_label = 'Super Bowl' or coalesce(v_type, 0) = 3 and (
    select week_number from private.weeks where id = v_week
  ) >= 4) then
    v_phase := 'superbowl';
  elsif v_type = 3 then
    v_phase := 'playoffs';
  end if;

  select w.id into v_live
  from private.weeks w
  where w.season_id = v_season.id
    and w.id is distinct from v_week
    and private.week_released(w.id)
    and not coalesce(private.week_complete(w.id), false)
  order by w.season_type desc, w.week_number desc
  limit 1;

  return jsonb_build_object(
    'now', private.app_now(),
    'authenticated', true,
    'me', case when v_player is null then null else (
      select jsonb_build_object(
        'player_id', id, 'full_name', full_name, 'first_name', first_name,
        'last_name', last_name, 'kind', kind
      ) from private.players where id = v_player
    ) end,
    'is_admin', v_admin,
    'phase', v_phase,
    'season', jsonb_build_object(
      'id', v_season.id,
      'year', v_season.year,
      'name', v_season.name,
      'status', v_season.status,
      'lock_mode', v_season.lock_mode,
      'lock_time', to_char(v_season.lock_time, 'HH24:MI'),
      'lock_weekday', v_season.lock_weekday,
      'lock_timezone', v_season.lock_timezone
    ),
    'current_week_id', v_week,
    'live_week_id', v_live,
    'weeks', private.weeks_json(v_season.id),
    'games', coalesce((
      select jsonb_agg(private.game_json(g.id) order by g.slot)
      from private.games g where g.week_id = v_week
    ), '[]'::jsonb),
    'my_picks', coalesce((
      select jsonb_object_agg(pk.game_id, pk.team_id)
      from private.picks pk
      join private.games g on g.id = pk.game_id
      where pk.player_id = v_player and g.week_id = v_week
    ), '{}'::jsonb),
    'my_guess', (
      select mnf_guess from private.entries
      where player_id = v_player and week_id = v_week
    ),
    'my_entry', exists (
      select 1 from private.entries where player_id = v_player and week_id = v_week
    ),
    'missing', case when v_week is null then '[]'::jsonb else private.missing_json(v_week) end,
    'leaderboard', case when v_week is null then null else private.leaderboard_json(v_week) end,
    'standings', private.standings_json(v_season.id, v_player),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'year', s.year,
        'name', s.name,
        'status', s.status,
        'champions', private.champions_json(s.id)
      ) order by s.year desc)
      from private.seasons s
    ), '[]'::jsonb),
    'all_time', private.all_time_json(),
    'roster', case when v_admin then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'player_id', id, 'full_name', full_name, 'first_name', first_name,
        'last_name', last_name, 'kind', kind, 'active', active
      ) order by full_name), '[]'::jsonb)
      from private.players
    ) else null end
  );
end;
$$;

create or replace function private.week_board(
  p_player_token text,
  p_admin_token text,
  p_week uuid
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_player uuid := private.player_from_token(p_player_token);
  v_admin boolean := private.admin_ok(p_admin_token);
  w private.weeks%rowtype;
begin
  if v_player is null and not v_admin then
    raise exception 'Open your family link first' using errcode = '28000';
  end if;
  select * into w from private.weeks where id = p_week;
  if not found then
    raise exception 'That week is not in the pool';
  end if;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'id', w.id,
      'season_id', w.season_id,
      'season_type', w.season_type,
      'week_number', w.week_number,
      'label', w.label,
      'lock_at', w.lock_at,
      'complete', private.week_complete(w.id),
      'mnf_total', w.mnf_total,
      'visible', private.scores_visible(w.id)
    ),
    'games', coalesce((
      select jsonb_agg(private.game_json(g.id) order by g.slot)
      from private.games g where g.week_id = w.id
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.id,
        'full_name', p.full_name,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'entered', true,
        'guess', case
          when p.id = v_player or private.guess_locked(w.id) then e.mnf_guess
          else null
        end,
        'correct', case
          when p.id = v_player or private.scores_visible(w.id)
            then private.entry_correct(p.id, w.id)
          else null
        end,
        'diff', case
          when (p.id = v_player or private.guess_locked(w.id))
            and e.mnf_guess is not null and w.mnf_total is not null
            then abs(e.mnf_guess - w.mnf_total)
          else null
        end,
        'winner', exists (
          select 1 from private.week_wins ww
          where ww.week_id = w.id and ww.player_id = p.id
        ),
        'picks', coalesce((
          select jsonb_object_agg(pk.game_id, pk.team_id)
          from private.picks pk
          join private.games g on g.id = pk.game_id
          where pk.player_id = p.id and g.week_id = w.id
            and (p.id = v_player or private.game_locked(g.id))
        ), '{}'::jsonb)
      ) order by p.full_name)
      from private.entries e
      join private.players p on p.id = e.player_id
      where e.week_id = w.id
    ), '[]'::jsonb),
    'missing', private.missing_json(w.id)
  );
end;
$$;

create or replace function private.player_page(
  p_player_token text,
  p_admin_token text,
  p_player uuid,
  p_season uuid
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_viewer uuid := private.player_from_token(p_player_token);
  v_admin boolean := private.admin_ok(p_admin_token);
  v_person private.players%rowtype;
  v_season uuid := p_season;
begin
  if v_viewer is null and not v_admin then
    raise exception 'Open your family link first' using errcode = '28000';
  end if;
  select * into v_person from private.players where id = p_player;
  if not found then
    raise exception 'That player is not in the pool';
  end if;
  if v_season is null then
    select id into v_season from private.seasons where status = 'active';
  end if;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'player_id', v_person.id,
      'full_name', v_person.full_name,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name,
      'kind', v_person.kind
    ),
    'season_id', v_season,
    'total', private.display_total(v_person.id, v_season, v_viewer),
    'wins', (
      select count(*)::int from private.week_wins ww
      join private.weeks w on w.id = ww.week_id
      where ww.player_id = v_person.id and w.season_id = v_season
    ),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_id', w.id,
        'label', w.label,
        'week_number', w.week_number,
        'season_type', w.season_type,
        'entered', e.player_id is not null,
        'visible', v_person.id = v_viewer or private.scores_visible(w.id),
        'score', case
          when e.player_id is null then null
          when v_person.id = v_viewer or private.scores_visible(w.id)
            then private.entry_correct(v_person.id, w.id)
          else null
        end,
        'guess', case
          when e.player_id is not null and (v_person.id = v_viewer or private.guess_locked(w.id))
            then e.mnf_guess else null
        end,
        'winner', exists (
          select 1 from private.week_wins ww
          where ww.week_id = w.id and ww.player_id = v_person.id
        )
      ) order by w.season_type, w.week_number)
      from private.weeks w
      left join private.entries e on e.week_id = w.id and e.player_id = v_person.id
      where w.season_id = v_season
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.admin_override_game(
  p_token text,
  p_game uuid,
  p_patch jsonb,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  g private.games%rowtype;
  v_note text := private.require_note(p_note);
  v_status text;
  v_tie boolean;
  v_winner text;
  v_away int;
  v_home int;
begin
  perform private.require_admin(p_token);
  select * into g from private.games where id = p_game;
  if not found then raise exception 'Game not found'; end if;

  v_status := coalesce(p_patch->>'status', g.status);
  v_tie := coalesce((p_patch->>'is_tie')::boolean, false);
  v_winner := nullif(p_patch->>'winner_team_id', '');
  v_away := case when p_patch ? 'away_score' then nullif(p_patch->>'away_score', '')::int else g.away_score end;
  v_home := case when p_patch ? 'home_score' then nullif(p_patch->>'home_score', '')::int else g.home_score end;

  if v_status = 'final' and v_tie then
    v_winner := null;
  elsif v_status = 'final' and not v_tie then
    if v_winner is null or v_winner not in (g.away_id, g.home_id) then
      raise exception 'Pick the winning team, or mark the game a tie';
    end if;
  else
    v_tie := false;
    v_winner := null;
    if v_status not in ('scheduled', 'in_progress', 'postponed', 'excluded', 'final') then
      raise exception 'Unknown game status';
    end if;
  end if;

  if v_away is not null and v_home is not null and v_status = 'final' then
    if v_tie and v_away <> v_home then
      raise exception 'A tie needs both teams on the same score';
    end if;
    if not v_tie and (
      (v_winner = g.away_id and v_away <= v_home)
      or (v_winner = g.home_id and v_home <= v_away)
    ) then
      raise exception 'That winner does not match the score';
    end if;
  end if;

  update private.games set
    status = v_status,
    is_tie = v_tie,
    winner_team_id = v_winner,
    away_score = v_away,
    home_score = v_home,
    result_source = 'admin'
  where id = g.id;

  if g.is_mnf and p_patch ? 'mnf_total' then
    update private.weeks set
      mnf_total = nullif(p_patch->>'mnf_total', '')::int,
      mnf_source = case when nullif(p_patch->>'mnf_total', '') is null then null else 'admin' end
    where id = g.week_id;
  elsif g.is_mnf and v_status = 'final' and v_away is not null and v_home is not null then
    update private.weeks set
      mnf_total = v_away + v_home,
      mnf_source = 'admin'
    where id = g.week_id and (mnf_source is null or mnf_source = 'scores');
  end if;

  perform private.award_week(g.week_id);
  perform private.audit('override_game', v_note, jsonb_build_object(
    'game_id', g.id, 'patch', p_patch
  ));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.admin_fix_pick(
  p_token text,
  p_player uuid,
  p_week uuid,
  p_picks jsonb,
  p_mnf int,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_note text := private.require_note(p_note);
  v_item jsonb;
  v_game uuid;
  v_team text;
begin
  perform private.require_admin(p_token);
  if not exists (select 1 from private.players where id = p_player) then
    raise exception 'Player not found';
  end if;
  if not exists (select 1 from private.weeks where id = p_week) then
    raise exception 'Week not found';
  end if;
  if p_mnf is not null and (p_mnf < 0 or p_mnf > 150) then
    raise exception 'Monday total must be between 0 and 150';
  end if;

  perform set_config('private.bypass_lock', 'on', true);

  insert into private.entries (player_id, week_id, mnf_guess, submitted_at, updated_at)
  values (p_player, p_week, p_mnf, private.app_now(), private.app_now())
  on conflict (player_id, week_id) do update
    set mnf_guess = excluded.mnf_guess,
        updated_at = private.app_now();

  if p_picks is not null then
    for v_item in select value from jsonb_array_elements(p_picks)
    loop
      v_game := (v_item->>'game_id')::uuid;
      v_team := nullif(v_item->>'team_id', '');
      if not exists (select 1 from private.games g where g.id = v_game and g.week_id = p_week) then
        raise exception 'That game is not in this week';
      end if;
      if v_team is null then
        delete from private.picks where player_id = p_player and game_id = v_game;
      else
        insert into private.picks (player_id, game_id, team_id, updated_at)
        values (p_player, v_game, v_team, private.app_now())
        on conflict (player_id, game_id) do update
          set team_id = excluded.team_id, updated_at = private.app_now();
      end if;
    end loop;
  end if;

  perform private.award_week(p_week);
  perform private.audit('fix_pick', v_note, jsonb_build_object(
    'player_id', p_player, 'week_id', p_week, 'mnf_guess', p_mnf
  ));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.admin_entries(p_token text, p_week uuid)
returns jsonb
language plpgsql
stable
as $$
begin
  perform private.require_admin(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'player_id', p.id,
      'full_name', p.full_name,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'guess', e.mnf_guess,
      'picks', coalesce((
        select jsonb_object_agg(pk.game_id, pk.team_id)
        from private.picks pk
        join private.games g on g.id = pk.game_id
        where pk.player_id = p.id and g.week_id = p_week
      ), '{}'::jsonb)
    ) order by p.full_name)
    from private.players p
    left join private.entries e on e.player_id = p.id and e.week_id = p_week
    where p.active
  ), '[]'::jsonb);
end;
$$;

create or replace function private.split_name(p_full text)
returns table (first_name text, last_name text)
language plpgsql
as $$
declare
  v text := trim(p_full);
begin
  first_name := regexp_replace(v, '\s+\S+$', '');
  last_name := regexp_replace(v, '^.*\s+', '');
  if first_name = v or first_name = '' or last_name = '' then
    raise exception 'Use a first and last name';
  end if;
  return next;
end;
$$;

create or replace function private.admin_upsert_player(p_token text, p_patch jsonb, p_note text)
returns jsonb
language plpgsql
as $$
declare
  v_note text := private.require_note(p_note);
  v_id uuid := nullif(p_patch->>'player_id', '')::uuid;
  v_full text := trim(p_patch->>'full_name');
  v_kind text := coalesce(nullif(p_patch->>'kind', ''), 'regular');
  v_active boolean := coalesce((p_patch->>'active')::boolean, true);
  v_first text;
  v_last text;
begin
  perform private.require_admin(p_token);
  if v_kind not in ('regular', 'occasional') then
    raise exception 'Player type must be regular or occasional';
  end if;
  select first_name, last_name into v_first, v_last from private.split_name(v_full);
  if v_id is null then
    insert into private.players (full_name, first_name, last_name, kind, active)
    values (v_full, v_first, v_last, v_kind, v_active)
    returning id into v_id;
  else
    update private.players set
      full_name = v_full,
      first_name = v_first,
      last_name = v_last,
      kind = v_kind,
      active = v_active
    where id = v_id;
    if not found then raise exception 'Player not found'; end if;
  end if;
  perform private.audit('upsert_player', v_note, jsonb_build_object(
    'player_id', v_id, 'full_name', v_full, 'kind', v_kind, 'active', v_active
  ));
  return jsonb_build_object('ok', true, 'player_id', v_id);
end;
$$;

create or replace function private.admin_set_lock(
  p_token text,
  p_mode text,
  p_time text,
  p_weekday int,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_note text := private.require_note(p_note);
  v_season uuid;
  v_week uuid;
begin
  perform private.require_admin(p_token);
  if p_mode not in ('deadline', 'kickoff') then
    raise exception 'Lock rule must be deadline or kickoff';
  end if;
  if p_weekday < 1 or p_weekday > 7 then
    raise exception 'Pick a day for the lock';
  end if;
  select id into v_season from private.seasons where status = 'active';
  if v_season is null then raise exception 'There is no active season'; end if;
  update private.seasons set
    lock_mode = p_mode,
    lock_time = p_time::time,
    lock_weekday = p_weekday
  where id = v_season;
  for v_week in select id from private.weeks where season_id = v_season
  loop
    perform private.recompute_week_times(v_week);
  end loop;
  perform private.audit('set_lock', v_note, jsonb_build_object(
    'mode', p_mode, 'time', p_time, 'weekday', p_weekday
  ));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.admin_start_season(
  p_token text,
  p_year int,
  p_name text,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_note text := private.require_note(p_note);
  v_prev private.seasons%rowtype;
  v_id uuid;
begin
  perform private.require_admin(p_token);
  if p_year < 2000 or p_year > 2100 then
    raise exception 'That year does not look right';
  end if;
  if exists (select 1 from private.seasons where year = p_year) then
    raise exception 'That season already exists';
  end if;
  select * into v_prev from private.seasons where status = 'active';
  update private.seasons
    set status = 'archived', archived_at = private.app_now()
  where status = 'active';
  insert into private.seasons (
    year, name, status, lock_mode, lock_weekday, lock_time, lock_timezone
  ) values (
    p_year,
    coalesce(nullif(trim(p_name), ''), p_year::text || ' season'),
    'active',
    coalesce(v_prev.lock_mode, 'deadline'),
    coalesce(v_prev.lock_weekday, 4),
    coalesce(v_prev.lock_time, time '17:10'),
    coalesce(v_prev.lock_timezone, 'America/Los_Angeles')
  ) returning id into v_id;
  perform private.audit('start_season', v_note, jsonb_build_object(
    'year', p_year, 'season_id', v_id, 'archived', v_prev.id
  ));
  return jsonb_build_object('ok', true, 'season_id', v_id);
end;
$$;

create or replace function private.admin_set_clock(p_token text, p_at timestamptz)
returns jsonb
language plpgsql
as $$
begin
  perform private.require_admin(p_token);
  if not (select allow_test_clock from private.app_settings where id = 1) then
    raise exception 'Clock override is disabled';
  end if;
  update private.app_settings set frozen_at = p_at where id = 1;
  perform private.audit('set_clock', 'test clock', jsonb_build_object('at', p_at));
  return jsonb_build_object('ok', true, 'now', private.app_now());
end;
$$;

create or replace function private.admin_audit(p_token text)
returns jsonb
language plpgsql
stable
as $$
begin
  perform private.require_admin(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'at', at, 'action', action, 'note', note
    ) order by id desc)
    from (select * from private.audit order by id desc limit 40) recent
  ), '[]'::jsonb);
end;
$$;

create or replace function private.apply_scoreboard(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_year int := (p_payload->>'season_year')::int;
  v_type int := (p_payload->>'season_type')::int;
  v_week_num int := (p_payload->>'week')::int;
  v_season uuid;
  v_active uuid;
  v_week uuid;
  v_sheet boolean;
  v_event jsonb;
  v_away text;
  v_home text;
  v_espn text;
  v_state text;
  v_game uuid;
  v_source text;
  v_kick timestamptz;
  v_away_score int;
  v_home_score int;
  v_status text;
  v_tie boolean;
  v_winner text;
  v_slot int;
begin
  if v_type not in (2, 3) or v_year is null or v_week_num is null then
    return jsonb_build_object('skipped', true, 'reason', 'unsupported season');
  end if;

  select id into v_active from private.seasons where status = 'active';
  select id into v_season from private.seasons where year = v_year;

  if v_season is null then
    if v_active is not null then
      return jsonb_build_object('skipped', true, 'reason', 'different active season');
    end if;
    insert into private.seasons (year, name, status)
    values (v_year, v_year::text || ' season', 'active')
    returning id into v_season;
  elsif v_active is distinct from v_season then
    return jsonb_build_object('skipped', true, 'reason', 'season not active');
  end if;

  insert into private.weeks (season_id, season_type, week_number, label)
  values (v_season, v_type, v_week_num, private.week_label(v_type, v_week_num))
  on conflict (season_id, season_type, week_number)
    do update set label = excluded.label
  returning id into v_week;

  select exists (
    select 1 from private.games g where g.week_id = v_week and g.result_source = 'sheet'
  ) into v_sheet;

  for v_event in select value from jsonb_array_elements(coalesce(p_payload->'events', '[]'::jsonb))
  loop
    v_away := v_event->>'away_abbr';
    v_home := v_event->>'home_abbr';
    v_espn := nullif(v_event->>'espn_id', '');
    v_state := coalesce(v_event->>'state', 'scheduled');
    v_kick := nullif(v_event->>'kickoff', '')::timestamptz;
    v_away_score := nullif(v_event->>'away_score', '')::int;
    v_home_score := nullif(v_event->>'home_score', '')::int;
    if not exists (select 1 from private.teams where id = v_away)
      or not exists (select 1 from private.teams where id = v_home) then
      continue;
    end if;

    update private.teams set
      color = case
        when coalesce(v_event->>'away_color', '') ~ '^[0-9A-Fa-f]{6}$'
          then '#' || upper(v_event->>'away_color') else color end,
      logo = coalesce(nullif(v_event->>'away_logo', ''), logo)
    where id = v_away;
    update private.teams set
      color = case
        when coalesce(v_event->>'home_color', '') ~ '^[0-9A-Fa-f]{6}$'
          then '#' || upper(v_event->>'home_color') else color end,
      logo = coalesce(nullif(v_event->>'home_logo', ''), logo)
    where id = v_home;

    select g.id, g.result_source into v_game, v_source
    from private.games g
    where g.week_id = v_week
      and (
        (v_espn is not null and g.espn_id = v_espn)
        or (g.away_id = v_away and g.home_id = v_home)
      )
    limit 1;

    v_status := case v_state
      when 'final' then 'final'
      when 'in_progress' then 'in_progress'
      when 'postponed' then 'postponed'
      else 'scheduled'
    end;
    v_tie := false;
    v_winner := null;
    if v_status = 'final' and v_away_score is not null and v_home_score is not null then
      if v_away_score = v_home_score then
        v_tie := true;
      elsif v_away_score > v_home_score then
        v_winner := v_away;
      else
        v_winner := v_home;
      end if;
    elsif v_status = 'final' then
      v_status := 'scheduled';
    end if;

    if v_game is null then
      if v_sheet then continue; end if;
      select coalesce(max(slot), -1) + 1 into v_slot from private.games where week_id = v_week;
      insert into private.games (
        week_id, slot, espn_id, kickoff, kickoff_estimated,
        away_id, home_id, away_score, home_score, status, is_tie, winner_team_id,
        neutral, result_source
      ) values (
        v_week, v_slot, v_espn, v_kick, false,
        v_away, v_home, v_away_score, v_home_score, v_status, v_tie, v_winner,
        coalesce((v_event->>'neutral')::boolean, false), 'espn'
      );
      continue;
    end if;

    update private.games set
      espn_id = coalesce(espn_id, v_espn),
      kickoff = case
        when kickoff_estimated or result_source is distinct from 'sheet' and result_source is distinct from 'admin'
          then coalesce(v_kick, kickoff)
        else kickoff
      end,
      kickoff_estimated = case
        when (kickoff_estimated or kickoff is null) and v_kick is not null then false
        else kickoff_estimated
      end,
      neutral = coalesce((v_event->>'neutral')::boolean, neutral)
    where id = v_game;

    if v_source in ('sheet', 'admin') then
      update private.games set
        away_score = coalesce(away_score, v_away_score),
        home_score = coalesce(home_score, v_home_score)
      where id = v_game
        and away_score is null
        and home_score is null
        and v_away_score is not null
        and v_home_score is not null
        and (
          (status <> 'final')
          or (is_tie and v_away_score = v_home_score)
          or (not is_tie and winner_team_id = case when v_away_score > v_home_score then away_id else home_id end)
        );
    else
      update private.games set
        away_score = v_away_score,
        home_score = v_home_score,
        status = v_status,
        is_tie = v_tie,
        winner_team_id = v_winner,
        result_source = 'espn'
      where id = v_game;
    end if;
  end loop;

  if not v_sheet then
    update private.games set is_mnf = false where week_id = v_week;
    update private.games set is_mnf = true
    where id = (
      select id from private.games
      where week_id = v_week and status <> 'excluded' and kickoff is not null
      order by kickoff desc
      limit 1
    );
  end if;

  update private.weeks w set
    mnf_total = g.away_score + g.home_score,
    mnf_source = 'scores'
  from private.games g
  where g.week_id = w.id
    and w.id = v_week
    and g.is_mnf
    and g.status = 'final'
    and g.away_score is not null
    and g.home_score is not null
    and (w.mnf_source is null or w.mnf_source = 'scores');

  perform private.recompute_week_times(v_week);
  perform private.award_week(v_week);
  return jsonb_build_object('ok', true, 'week_id', v_week, 'week', v_week_num);
end;
$$;

create or replace function private.sync_plan()
returns jsonb
language plpgsql
stable
as $$
declare
  v_season private.seasons%rowtype;
  v_latest private.weeks%rowtype;
  v_next_type int;
  v_next_week int;
  v_open timestamptz;
  v_sunday date;
begin
  select * into v_season from private.seasons where status = 'active';
  if not found then
    return jsonb_build_object('fetch_default', true, 'weeks', '[]'::jsonb);
  end if;

  select * into v_latest
  from private.weeks
  where season_id = v_season.id
  order by season_type desc, week_number desc
  limit 1;

  if v_latest.id is not null then
    if v_latest.season_type = 2 and v_latest.week_number < 18 then
      v_next_type := 2;
      v_next_week := v_latest.week_number + 1;
    elsif v_latest.season_type = 2 then
      v_next_type := 3;
      v_next_week := 1;
    elsif v_latest.season_type = 3 and v_latest.week_number < 4 then
      v_next_type := 3;
      v_next_week := v_latest.week_number + 1;
    end if;
    v_sunday := private.slate_sunday(v_latest.id);
    if v_sunday is not null then
      v_open := ((v_sunday + 2)::timestamp + time '08:00') at time zone v_season.lock_timezone;
    end if;
  end if;

  return jsonb_build_object(
    'fetch_default', false,
    'season_year', v_season.year,
    'weeks', coalesce((
      select jsonb_agg(distinct jsonb_build_object('season_type', season_type, 'week', week_number))
      from (
        select w.season_type, w.week_number
        from private.weeks w
        where w.season_id = v_season.id
          and not coalesce(private.week_games_done(w.id), false)
        union all
        select v_latest.season_type, v_latest.week_number
        where v_latest.id is not null
        union all
        select v_next_type, v_next_week
        where v_next_type is not null
          and (
            coalesce(private.week_games_done(v_latest.id), false)
            or (v_open is not null and private.app_now() >= v_open)
          )
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.log_sync(p_detail jsonb)
returns jsonb
language plpgsql
as $$
begin
  insert into private.sync_log (ok, detail)
  values (coalesce((p_detail->>'ok')::boolean, false), coalesce(p_detail, '{}'::jsonb));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.report_standings(p_year int)
returns jsonb
language plpgsql
stable
as $$
declare
  v_season uuid;
begin
  select id into v_season from private.seasons where year = p_year;
  return jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'full_name', p.full_name,
        'total', private.season_player_total(p.id, v_season),
        'wins', (
          select count(*)::int from private.week_wins ww
          join private.weeks w on w.id = ww.week_id
          where ww.player_id = p.id and w.season_id = v_season
        ),
        'weeks', (
          select coalesce(jsonb_object_agg(
            w.week_number::text,
            case when e.player_id is null then null else private.entry_correct(p.id, w.id) end
          ), '{}'::jsonb)
          from private.weeks w
          left join private.entries e on e.week_id = w.id and e.player_id = p.id
          where w.season_id = v_season and w.season_type = 2
        )
      ) order by p.full_name)
      from private.players p
    ), '[]'::jsonb),
    'champions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', w.week_number,
        'complete', private.week_complete(w.id),
        'mnf', w.mnf_total,
        'winners', coalesce((
          select jsonb_agg(p.full_name order by p.full_name)
          from private.week_wins ww
          join private.players p on p.id = ww.player_id
          where ww.week_id = w.id
        ), '[]'::jsonb),
        'tiebreak', (
          select count(*) > 1 from (
            select private.entry_correct(e.player_id, e.week_id) as correct
            from private.entries e where e.week_id = w.id
          ) s
          where correct = (select max(private.entry_correct(e2.player_id, e2.week_id))
                           from private.entries e2 where e2.week_id = w.id)
        )
      ) order by w.week_number)
      from private.weeks w
      where w.season_id = v_season and w.season_type = 2
    ), '[]'::jsonb)
  );
end;
$$;

-- Browser API. Security definer so the anon key can call them,
-- while the tables themselves stay unreachable.

create or replace function public.bootstrap(p_player_token text, p_admin_token text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.bootstrap(p_player_token, p_admin_token); end $$;

create or replace function public.save_picks(p_player_token text, p_week_id uuid, p_picks jsonb, p_mnf_guess int)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.save_picks(p_player_token, p_week_id, p_picks, p_mnf_guess); end $$;

create or replace function public.week_board(p_player_token text, p_admin_token text, p_week_id uuid)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.week_board(p_player_token, p_admin_token, p_week_id); end $$;

create or replace function public.player_page(p_player_token text, p_admin_token text, p_player_id uuid, p_season_id uuid)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.player_page(p_player_token, p_admin_token, p_player_id, p_season_id); end $$;

create or replace function public.admin_override_game(p_admin_token text, p_game_id uuid, p_patch jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_override_game(p_admin_token, p_game_id, p_patch, p_note); end $$;

create or replace function public.admin_fix_pick(p_admin_token text, p_player_id uuid, p_week_id uuid, p_picks jsonb, p_mnf_guess int, p_note text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_fix_pick(p_admin_token, p_player_id, p_week_id, p_picks, p_mnf_guess, p_note); end $$;

create or replace function public.admin_entries(p_admin_token text, p_week_id uuid)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_entries(p_admin_token, p_week_id); end $$;

create or replace function public.admin_upsert_player(p_admin_token text, p_patch jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_upsert_player(p_admin_token, p_patch, p_note); end $$;

create or replace function public.admin_set_lock(p_admin_token text, p_mode text, p_time text, p_weekday int, p_note text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_set_lock(p_admin_token, p_mode, p_time, p_weekday, p_note); end $$;

create or replace function public.admin_start_season(p_admin_token text, p_year int, p_name text, p_note text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_start_season(p_admin_token, p_year, p_name, p_note); end $$;

create or replace function public.admin_set_clock(p_admin_token text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_set_clock(p_admin_token, p_at); end $$;

create or replace function public.admin_audit(p_admin_token text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.admin_audit(p_admin_token); end $$;

create or replace function public.apply_scoreboard(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.apply_scoreboard(p_payload); end $$;

create or replace function public.sync_plan()
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.sync_plan(); end $$;

create or replace function public.log_sync(p_detail jsonb)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp
as $$ begin return private.log_sync(p_detail); end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'bootstrap', 'save_picks', 'week_board', 'player_page',
        'admin_override_game', 'admin_fix_pick', 'admin_entries',
        'admin_upsert_player', 'admin_set_lock', 'admin_start_season',
        'admin_set_clock', 'admin_audit', 'apply_scoreboard', 'sync_plan', 'log_sync'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
end $$;

grant execute on function public.bootstrap(text, text) to anon, authenticated;
grant execute on function public.save_picks(text, uuid, jsonb, int) to anon, authenticated;
grant execute on function public.week_board(text, text, uuid) to anon, authenticated;
grant execute on function public.player_page(text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.admin_override_game(text, uuid, jsonb, text) to anon, authenticated;
grant execute on function public.admin_fix_pick(text, uuid, uuid, jsonb, int, text) to anon, authenticated;
grant execute on function public.admin_entries(text, uuid) to anon, authenticated;
grant execute on function public.admin_upsert_player(text, jsonb, text) to anon, authenticated;
grant execute on function public.admin_set_lock(text, text, text, int, text) to anon, authenticated;
grant execute on function public.admin_start_season(text, int, text, text) to anon, authenticated;
grant execute on function public.admin_set_clock(text, timestamptz) to anon, authenticated;
grant execute on function public.admin_audit(text) to anon, authenticated;

grant execute on function public.apply_scoreboard(jsonb) to service_role;
grant execute on function public.sync_plan() to service_role;
grant execute on function public.log_sync(jsonb) to service_role;
