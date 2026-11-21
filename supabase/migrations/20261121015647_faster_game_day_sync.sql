-- Faster game-day score sync.
-- 1. claim_sync throttle: only the 'claimed' row counts, and the window is 90 seconds.
--    The old rule (any sync_log row in the last 2 minutes) also matched the completion row
--    written ~1 s after each claim, so a 2-minute cron would have skipped every other run.
--    ESPN still gets at most one sync per 90 seconds.
create or replace function private.claim_sync()
returns boolean
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(481516234);
  if exists (
    select 1 from private.sync_log
    where at > pg_catalog.now() - interval '90 seconds'
      and detail->>'phase' = 'claimed'
  ) then
    return false;
  end if;
  insert into private.sync_log (ok, detail)
  values (true, '{"phase":"claimed"}'::jsonb);
  return true;
end;
$$;

revoke all on function private.claim_sync() from public, anon, authenticated, service_role;

-- 2. Every 2 minutes during NFL game hours (UTC windows cover both PST and PDT).
--    sync-nfl-game-window (*/10 Thu-Mon UTC) and sync-nfl-offdays stay as the slow safety net.
--    sync-nfl-monday-night is replaced by sync-nfl-fast-evenings (Tue 00-06 UTC).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-nfl-monday-night') then
    perform cron.unschedule('sync-nfl-monday-night');
  end if;
end $$;

-- Thu/Fri/Sat/Sun/Mon evenings PT (00:00-06:58 UTC next day)
select cron.schedule('sync-nfl-fast-evenings', '*/2 0-6 * * 0,1,2,5,6', $cron$
  select net.http_post(
    url := 'https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_B9FtAXbv5ln6lS3P745C_Q__2SXk7vJ'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- Sunday 5 AM-4 PM PST / 6 AM-5 PM PDT
select cron.schedule('sync-nfl-fast-sunday', '*/2 13-23 * * 0', $cron$
  select net.http_post(
    url := 'https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_B9FtAXbv5ln6lS3P745C_Q__2SXk7vJ'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- Thu/Fri/Sat 8 AM-4 PM PST (Thanksgiving, Black Friday, Christmas, late-season Saturdays)
select cron.schedule('sync-nfl-fast-daytime', '*/2 16-23 * * 4,5,6', $cron$
  select net.http_post(
    url := 'https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_B9FtAXbv5ln6lS3P745C_Q__2SXk7vJ'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);
