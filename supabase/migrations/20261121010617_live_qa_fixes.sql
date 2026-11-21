-- Live QA fixes. The first three migrations are already applied, so this file
-- replaces two functions, repairs frozen games and pregame 0-0 scores, and
-- adds a Monday-night score sync. Monday evening Pacific is early Tuesday UTC.

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
  v_source text;
begin
  perform private.require_admin(p_token);
  select * into g from private.games where id = p_game;
  if not found then raise exception 'Game not found'; end if;

  if coalesce((p_patch->>'release_auto')::boolean, false) then
    update private.games
      set result_source = null
    where id = g.id;
    perform private.audit('release_auto', v_note, jsonb_build_object('game_id', g.id));
    return jsonb_build_object('ok', true, 'result_source', null);
  end if;

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

  -- A final, postponed, or excluded call is Brad's until he hands it back.
  -- Scheduling an unplayed game must not freeze ESPN out.
  if v_status in ('final', 'postponed', 'excluded') then
    v_source := 'admin';
  elsif g.result_source = 'admin' then
    v_source := null;
  else
    v_source := g.result_source;
  end if;

  if v_status = 'scheduled' then
    v_away := null;
    v_home := null;
  end if;

  update private.games set
    status = v_status,
    is_tie = v_tie,
    winner_team_id = v_winner,
    away_score = v_away,
    home_score = v_home,
    result_source = v_source
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
    'game_id', g.id, 'patch', p_patch, 'result_source', v_source
  ));
  return jsonb_build_object('ok', true, 'result_source', v_source);
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

    -- ESPN sends 0-0 before kickoff. That is not a score.
    if v_status = 'scheduled' then
      v_away_score := null;
      v_home_score := null;
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
        and v_status <> 'scheduled'
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

-- Unplayed games that were saved as "scheduled" got stuck on result_source admin.
update private.games
set result_source = null
where result_source = 'admin'
  and status in ('scheduled', 'in_progress');

-- Pregame zeroes already stored.
update private.games
set away_score = null, home_score = null
where status = 'scheduled'
  and coalesce(away_score, 0) = 0
  and coalesce(home_score, 0) = 0;

do $monday$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname = 'sync-nfl-monday-night';

    perform cron.schedule(
      'sync-nfl-monday-night',
      '*/10 0-7 * * 2',
      $cron$
      select net.http_post(
        url := 'https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'sb_publishable_B9FtAXbv5ln6lS3P745C_Q__2SXk7vJ'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
      $cron$
    );
  end if;
exception when others then
  raise notice 'Monday-night score sync was not scheduled (%).', sqlerrm;
end
$monday$;
