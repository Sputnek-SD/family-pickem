-- Ask ESPN for scores on a schedule.
-- The project URL and the publishable key are public. No Vault secret and no
-- project secret key. The function itself uses the service role Supabase injects.

do $schedule$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron was not created (%). Enable it, then run this migration again.', sqlerrm;
  end;

  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net was not created (%). Enable it, then run this migration again.', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('sync-nfl-game-window', 'sync-nfl-offdays');

  perform cron.schedule(
    'sync-nfl-game-window',
    '*/10 * * * 0,1,4,5,6',
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

  perform cron.schedule(
    'sync-nfl-offdays',
    '20 */6 * * 2,3',
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
exception when others then
  raise notice 'Score sync was not scheduled (%). Enable pg_cron and pg_net, then run this migration again.', sqlerrm;
end
$schedule$;
