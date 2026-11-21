-- Ask ESPN for scores on a schedule.
-- The job does nothing until Brad stores two Vault secrets (see the README):
--   project_url   https://yqbepfcgyzrvsicvxukb.supabase.co
--   secret_key    the project's secret key (never the publishable key)

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

  begin
    create extension if not exists supabase_vault with schema vault;
  exception when others then
    raise notice 'vault extension note: %', sqlerrm;
  end;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('sync-nfl-game-window', 'sync-nfl-offdays');

  perform cron.schedule(
    'sync-nfl-game-window',
    '*/10 * * * 0,1,4,5,6',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-nfl',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    )
    where (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') is not null
      and (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key') is not null;
    $cron$
  );

  perform cron.schedule(
    'sync-nfl-offdays',
    '20 */6 * * 2,3',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-nfl',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    )
    where (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') is not null
      and (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key') is not null;
    $cron$
  );
exception when others then
  raise notice 'Score sync was not scheduled (%). The README has the commands to run by hand.', sqlerrm;
end
$schedule$;
