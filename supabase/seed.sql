-- Local development only. `supabase db reset` runs this.
-- Do not run it against the hosted project: it turns on the test clock.
update private.app_settings set allow_test_clock = true where id = 1;
