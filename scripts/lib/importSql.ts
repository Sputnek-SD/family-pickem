import type { ChampionRow, ParsedExport, StandingRow } from "./parseExport.ts";

function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function num(value: number | null): string {
  return value == null ? "null" : String(value);
}

function ts(value: string | null): string {
  return value == null ? "null" : `${q(value)}::timestamptz`;
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

/** One idempotent script: load 2026, then a query that lists any mismatch with the sheet. */
export function buildImportSql(exported: ParsedExport): string {
  const lines: string[] = [];
  lines.push("-- 2026 family pick'em import. Safe to run again: it replaces that season's weeks.");
  lines.push("-- The last query returns one row per mismatch with the sheet. No rows means it matches.");
  lines.push("begin;");
  lines.push("select set_config('private.bypass_lock', 'on', true);");
  lines.push("do $import$");
  lines.push("declare");
  lines.push("  v_week uuid;");
  lines.push("  v_game uuid;");
  lines.push("  v_games uuid[];");
  lines.push("begin");
  lines.push("  perform set_config('private.bypass_lock', 'on', true);");
  lines.push("  update private.seasons");
  lines.push("    set status = 'archived', archived_at = coalesce(archived_at, now())");
  lines.push("    where status = 'active' and year <> 2026;");
  lines.push("  insert into private.seasons (year, name, status)");
  lines.push("  values (2026, '2026 season', 'active')");
  lines.push("  on conflict (year) do update set status = 'active', archived_at = null;");
  lines.push("  delete from private.weeks w using private.seasons s");
  lines.push("    where w.season_id = s.id and s.year = 2026;");

  for (const week of exported.weeks) {
    lines.push("  v_games := '{}';");
    lines.push("  insert into private.weeks (season_id, season_type, week_number, label, mnf_total, mnf_source)");
    lines.push("  select id, 2, " +
      `${week.week}, ${q(`Week ${week.week}`)}, ${num(week.mnfTotal)}, ` +
      `${week.mnfTotal == null ? "null" : q("sheet")}`);
    lines.push("  from private.seasons where year = 2026");
    lines.push("  returning id into v_week;");
    for (const game of week.games) {
      const final = game.winner != null || game.tie;
      lines.push("  insert into private.games (");
      lines.push("    week_id, slot, kickoff, kickoff_estimated, away_id, home_id,");
      lines.push("    away_score, home_score, status, is_tie, winner_team_id, is_mnf, result_source");
      lines.push("  ) values (");
      lines.push(
        "    v_week, " +
          [
            game.slot,
            ts(game.kickoff),
            bool(game.kickoffEstimated),
            q(game.away),
            q(game.home),
            num(game.awayScore),
            num(game.homeScore),
            q(final ? "final" : "scheduled"),
            bool(game.tie),
            game.winner ? q(game.winner) : "null",
            bool(game.mnf),
            final ? q("sheet") : "null",
          ].join(", "),
      );
      lines.push("  ) returning id into v_game;");
      lines.push("  v_games := v_games || v_game;");
    }
    lines.push("  perform private.recompute_week_times(v_week);");
    for (const entry of week.entries) {
      lines.push("  insert into private.entries (player_id, week_id, mnf_guess, submitted_at)");
      lines.push(
        `  select id, v_week, ${num(entry.guess)}, ${ts(entry.submittedAt)} from private.players where full_name = ${q(entry.player)};`,
      );
      lines.push("  if not found then raise exception 'No roster row for %', " + q(entry.player) + "; end if;");
      entry.picks.forEach((team, slot) => {
        if (!team) return;
        lines.push("  insert into private.picks (player_id, game_id, team_id, updated_at)");
        lines.push(
          `  select id, v_games[${slot + 1}], ${q(team)}, coalesce(${ts(entry.submittedAt)}, now()) from private.players where full_name = ${q(entry.player)};`,
        );
      });
    }
    lines.push("  perform private.award_week(v_week);");
  }
  lines.push("end");
  lines.push("$import$;");
  lines.push("commit;");
  lines.push(verificationSql(exported.standings, exported.champions));
  return lines.join("\n") + "\n";
}

function weekChecks(): string {
  const parts: string[] = [];
  for (let week = 1; week <= 11; week++) {
    parts.push(`(e.w${week} is distinct from a.w${week})`);
  }
  return parts.join("\n    or ");
}

/** Rows are mismatches. An empty result means the loaded season matches the sheet. */
export function verificationSql(standings: StandingRow[], champions: ChampionRow[]): string {
  const playerValues = standings
    .map((row) => {
      const weeks = row.weeks.map((score) => (score == null ? "null::int" : String(score))).join(", ");
      return `    (${q(row.player)}, ${weeks}, ${row.wins}, ${row.total})`;
    })
    .join(",\n");

  const champValues = champions
    .map((row) => {
      const awarded = row.week <= 10;
      const winner = awarded ? q(row.winner) : "null";
      const mnf = row.mnf == null ? "null::int" : String(row.mnf);
      return `    (${row.week}, ${awarded ? "true" : "false"}, ${winner}, ${row.tiebreak ? "true" : "false"}, ${mnf})`;
    })
    .join(",\n");

  return `-- VERIFY: no rows means standings.csv and weekly_champions.csv match.
with report as (
  select private.report_standings(2026) as data
),
expected_player as (
  select * from (values
${playerValues}
  ) as v(full_name, w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, wins, total)
),
actual_player as (
  select
    p->>'full_name' as full_name,
    (p->>'total')::int as total,
    (p->>'wins')::int as wins,
    (p->'weeks'->>'1')::int as w1,
    (p->'weeks'->>'2')::int as w2,
    (p->'weeks'->>'3')::int as w3,
    (p->'weeks'->>'4')::int as w4,
    (p->'weeks'->>'5')::int as w5,
    (p->'weeks'->>'6')::int as w6,
    (p->'weeks'->>'7')::int as w7,
    (p->'weeks'->>'8')::int as w8,
    (p->'weeks'->>'9')::int as w9,
    (p->'weeks'->>'10')::int as w10,
    (p->'weeks'->>'11')::int as w11
  from report
  cross join lateral jsonb_array_elements(data->'players') p
),
player_mismatch as (
  select e.full_name, 'player'::text as kind
  from expected_player e
  left join actual_player a using (full_name)
  where a.full_name is null
    or e.total is distinct from a.total
    or e.wins is distinct from a.wins
    or ${weekChecks()}
),
expected_champ as (
  select * from (values
${champValues}
  ) as v(week, complete, winner, tiebreak, mnf)
),
actual_champ as (
  select
    (c->>'week')::int as week,
    (c->>'complete')::boolean as complete,
    c->'winners'->>0 as winner,
    coalesce(jsonb_array_length(c->'winners'), 0) as winner_count,
    (c->>'tiebreak')::boolean as tiebreak,
    (c->>'mnf')::int as mnf
  from report
  cross join lateral jsonb_array_elements(data->'champions') c
),
champ_mismatch as (
  select 'week ' || e.week::text as full_name, 'champion'::text as kind
  from expected_champ e
  left join actual_champ a using (week)
  where a.week is null
    or e.complete is distinct from a.complete
    or e.mnf is distinct from a.mnf
    or (e.complete and (a.winner_count <> 1 or a.winner is distinct from e.winner or e.tiebreak is distinct from a.tiebreak))
    or (not e.complete and a.winner_count <> 0)
)
select * from player_mismatch
union all
select * from champ_mismatch
order by 1, 2;
`;
}
