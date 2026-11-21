/**
 * Load the 2026 sheet export into the database and check it against the standings.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run import
 *
 * Safe to run again: it replaces the 2026 weeks and keeps the roster.
 * It does not call Google, and it does not print player links.
 */
import pg from "pg";
import path from "node:path";
import { loadExport } from "./lib/parseExport.ts";

const dir = path.resolve(process.env.PICKEM_DATA ?? "data/2026");
const year = 2026;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL to the Postgres connection string.");
  const exported = loadExport(dir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('private.bypass_lock', 'on', true)");

    const existing = await client.query(
      "select id from private.seasons where year = $1",
      [year],
    );
    let seasonId: string;
    if (existing.rowCount) {
      seasonId = existing.rows[0].id;
      await client.query(
        "update private.seasons set status = 'archived', archived_at = now() where status = 'active' and id <> $1",
        [seasonId],
      );
      await client.query(
        "update private.seasons set status = 'active', archived_at = null where id = $1",
        [seasonId],
      );
      await client.query("delete from private.weeks where season_id = $1", [seasonId]);
    } else {
      const active = await client.query("select id from private.seasons where status = 'active'");
      if (active.rowCount) {
        throw new Error("A different season is already active. Archive it before importing 2026.");
      }
      const inserted = await client.query(
        `insert into private.seasons (year, name, status)
         values ($1, '2026 season', 'active') returning id`,
        [year],
      );
      seasonId = inserted.rows[0].id;
    }

    for (const week of exported.weeks) {
      const weekRow = await client.query(
        `insert into private.weeks (season_id, season_type, week_number, label, mnf_total, mnf_source)
         values ($1, 2, $2, $3, $4, $5) returning id`,
        [
          seasonId,
          week.week,
          `Week ${week.week}`,
          week.mnfTotal,
          week.mnfTotal == null ? null : "sheet",
        ],
      );
      const weekId = weekRow.rows[0].id;
      const gameIds: string[] = [];
      for (const game of week.games) {
        const final = game.winner != null || game.tie;
        const inserted = await client.query(
          `insert into private.games (
             week_id, slot, kickoff, kickoff_estimated, away_id, home_id,
             away_score, home_score, status, is_tie, winner_team_id, is_mnf, result_source
           ) values (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11, $12, $13
           ) returning id`,
          [
            weekId,
            game.slot,
            game.kickoff,
            game.kickoffEstimated,
            game.away,
            game.home,
            game.awayScore,
            game.homeScore,
            final ? "final" : "scheduled",
            game.tie,
            game.winner,
            game.mnf,
            final ? "sheet" : null,
          ],
        );
        gameIds.push(inserted.rows[0].id);
      }
      await client.query("select private.recompute_week_times($1)", [weekId]);

      for (const entry of week.entries) {
        const player = await client.query(
          "select id from private.players where full_name = $1",
          [entry.player],
        );
        if (!player.rowCount) throw new Error(`No roster row for ${entry.player}`);
        const playerId = player.rows[0].id;
        await client.query(
          `insert into private.entries (player_id, week_id, mnf_guess, submitted_at)
           values ($1, $2, $3, $4)`,
          [playerId, weekId, entry.guess, entry.submittedAt],
        );
        for (let slot = 0; slot < entry.picks.length; slot++) {
          const team = entry.picks[slot];
          if (!team) continue;
          await client.query(
            `insert into private.picks (player_id, game_id, team_id, updated_at)
             values ($1, $2, $3, coalesce($4, now()))`,
            [playerId, gameIds[slot], team, entry.submittedAt],
          );
        }
      }
      await client.query("select private.award_week($1)", [weekId]);
    }

    const report = await client.query("select private.report_standings($1) as report", [year]);
    const mismatches = compare(exported, report.rows[0].report);
    if (mismatches.length) {
      await client.query("rollback");
      console.error(mismatches.join("\n"));
      throw new Error(`Import does not match the sheet (${mismatches.length} mismatches).`);
    }
    await client.query("commit");
    console.log(`Imported ${year}: ${exported.weeks.length} weeks, standings match the sheet.`);
  } catch (error) {
    try { await client.query("rollback"); } catch { /* already closed */ }
    throw error;
  } finally {
    await client.end();
  }
}

function compare(
  exported: ReturnType<typeof loadExport>,
  report: {
    players: { full_name: string; total: number; wins: number; weeks: Record<string, number | null> }[];
    champions: { week: number; complete: boolean; winners: string[]; tiebreak: boolean; mnf: number | null }[];
  },
): string[] {
  const problems: string[] = [];
  const byName = new Map(report.players.map((player) => [player.full_name, player]));
  for (const row of exported.standings) {
    const got = byName.get(row.player);
    if (!got) {
      problems.push(`missing player ${row.player}`);
      continue;
    }
    if (got.total !== row.total) problems.push(`${row.player} total ${got.total} != ${row.total}`);
    if (got.wins !== row.wins) problems.push(`${row.player} wins ${got.wins} != ${row.wins}`);
    row.weeks.forEach((score, index) => {
      const week = index + 1;
      const actual = got.weeks[String(week)] ?? null;
      if (actual !== score) problems.push(`${row.player} week ${week} ${actual} != ${score}`);
    });
  }
  for (const champ of exported.champions) {
    const got = report.champions.find((item) => item.week === champ.week);
    if (!got) {
      problems.push(`missing champion row ${champ.week}`);
      continue;
    }
    if (champ.week <= 10) {
      if (!got.complete) problems.push(`week ${champ.week} should be complete`);
      if (got.winners.join("; ") !== champ.winner) {
        problems.push(`week ${champ.week} winner ${got.winners.join("; ")} != ${champ.winner}`);
      }
      if (got.tiebreak !== champ.tiebreak) problems.push(`week ${champ.week} tiebreak flag`);
      if (got.mnf !== champ.mnf) problems.push(`week ${champ.week} mnf ${got.mnf} != ${champ.mnf}`);
    } else if (got.complete || got.winners.length) {
      problems.push("week 11 should not be awarded yet");
    }
  }
  return problems;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
