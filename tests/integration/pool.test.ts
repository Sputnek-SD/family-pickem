import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const api = process.env.API_URL ?? "http://127.0.0.1:54321";
const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function rpc(fn: string, body: unknown, key = anon) {
  const response = await fetch(`${api}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("database rules", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const playerToken = randomBytes(32).toString("base64url");
  const adminToken = randomBytes(32).toString("base64url");
  let previousPlayerHash: string | null = null;
  let previousAdminHash: string | null = null;
  let chelseaId = "";
  let weekId = "";
  let gameId = "";
  let originalTeam = "";

  beforeAll(async () => {
    await client.connect();
    const { execFileSync } = await import("node:child_process");
    const sql = execFileSync(path.resolve("node_modules/.bin/tsx"), ["scripts/import-sql.ts"], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });
    await client.query(sql);
    const chelsea = await client.query(
      "select id, token_hash from private.players where full_name = 'Chelsea Jess'",
    );
    chelseaId = chelsea.rows[0].id;
    previousPlayerHash = chelsea.rows[0].token_hash;
    await client.query("update private.players set token_hash = $1 where id = $2", [hash(playerToken), chelseaId]);
    const admin = await client.query("select token_hash from private.secrets where name = 'admin'");
    previousAdminHash = admin.rows[0].token_hash;
    await client.query("update private.secrets set token_hash = $1 where name = 'admin'", [hash(adminToken)]);
    const week = await client.query(
      `select w.id from private.weeks w
       join private.seasons s on s.id = w.season_id
       where s.year = 2026 and w.week_number = 11`,
    );
    weekId = week.rows[0].id;
    const game = await client.query(
      "select id from private.games where week_id = $1 and slot = 1",
      [weekId],
    );
    gameId = game.rows[0].id;
    const pick = await client.query(
      "select team_id from private.picks where player_id = $1 and game_id = $2",
      [chelseaId, gameId],
    );
    originalTeam = pick.rows[0].team_id;
  });

  afterAll(async () => {
    await client.query("begin");
    await client.query("select set_config('private.bypass_lock', 'on', true)");
    await client.query("update private.app_settings set frozen_at = null where id = 1");
    await client.query(
      `update private.seasons set lock_mode = 'deadline', lock_time = '17:10', lock_weekday = 4
       where status = 'active' and year = 2026`,
    );
    await client.query("select private.recompute_week_times(id) from private.weeks");
    await client.query("update private.players set token_hash = $1 where id = $2", [previousPlayerHash, chelseaId]);
    await client.query("update private.secrets set token_hash = $1 where name = 'admin'", [previousAdminHash]);
    if (originalTeam) {
      await client.query(
        "update private.picks set team_id = $1 where player_id = $2 and game_id = $3",
        [originalTeam, chelseaId, gameId],
      );
    }
    await client.query("commit");
    await client.end();
  });

  it("rejects a pick after the pool locks, from the API and from a direct write", async () => {
    await rpc("admin_set_clock", { p_admin_token: adminToken, p_at: "2026-11-18T18:00:00Z" });
    const open = await rpc("save_picks", {
      p_player_token: playerToken,
      p_week_id: weekId,
      p_picks: [{ game_id: gameId, team_id: originalTeam === "BUF" ? "MIA" : "BUF" }],
      p_mnf_guess: 44,
    });
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    await rpc("admin_set_clock", { p_admin_token: adminToken, p_at: "2026-11-20T03:00:00Z" });
    const locked = await rpc("save_picks", {
      p_player_token: playerToken,
      p_week_id: weekId,
      p_picks: [{ game_id: gameId, team_id: originalTeam }],
      p_mnf_guess: 45,
    });
    expect(locked.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(locked.body)).toMatch(/locked/i);

    await expect(
      client.query("update private.picks set team_id = $1 where player_id = $2 and game_id = $3", [
        originalTeam,
        chelseaId,
        gameId,
      ]),
    ).rejects.toThrow(/locked/i);
  });

  it("locks one game at kickoff and leaves a later game open", async () => {
    await rpc("admin_set_clock", { p_admin_token: adminToken, p_at: "2026-11-18T18:00:00Z" });
    await rpc("admin_set_lock", {
      p_admin_token: adminToken,
      p_mode: "kickoff",
      p_time: "17:10",
      p_weekday: 4,
      p_note: "integration kickoff check",
    });
    await rpc("admin_set_clock", { p_admin_token: adminToken, p_at: "2026-11-20T03:00:00Z" });
    const early = await client.query(
      "select id from private.games where week_id = $1 order by kickoff asc limit 1",
      [weekId],
    );
    const late = await client.query(
      "select id, away_id from private.games where week_id = $1 order by kickoff desc limit 1",
      [weekId],
    );
    const earlySave = await rpc("save_picks", {
      p_player_token: playerToken,
      p_week_id: weekId,
      p_picks: [{ game_id: early.rows[0].id, team_id: "IND" }],
      p_mnf_guess: 44,
    });
    expect(earlySave.status).toBeGreaterThanOrEqual(400);
    const lateSave = await rpc("save_picks", {
      p_player_token: playerToken,
      p_week_id: weekId,
      p_picks: [{ game_id: late.rows[0].id, team_id: late.rows[0].away_id }],
      p_mnf_guess: 44,
    });
    expect(lateSave.status, JSON.stringify(lateSave.body)).toBe(200);
    await rpc("admin_set_lock", {
      p_admin_token: adminToken,
      p_mode: "deadline",
      p_time: "17:10",
      p_weekday: 4,
      p_note: "restore deadline lock",
    });
  });

  it("hides tables from the public API and blocks the score sync from the anon key", async () => {
    const picks = await fetch(`${api}/rest/v1/picks`, { headers: { apikey: anon, authorization: `Bearer ${anon}` } });
    expect(picks.status).toBeGreaterThanOrEqual(400);
    const sync = await rpc("apply_scoreboard", { p_payload: {} });
    expect(sync.status).toBeGreaterThanOrEqual(400);
  });

  it("scores a tie as zero, holds a postponed game, and ignores an excluded game", async () => {
    await client.query("begin");
    try {
      await client.query("select set_config('private.bypass_lock', 'on', true)");
      const season = await client.query("select id from private.seasons where year = 2026");
      const week = await client.query(
        `insert into private.weeks (season_id, season_type, week_number, label, mnf_total, mnf_source)
         values ($1, 2, 19, 'Week 19', 40, 'admin') returning id`,
        [season.rows[0].id],
      );
      const week19 = week.rows[0].id;
      const tie = await client.query(
        `insert into private.games (week_id, slot, away_id, home_id, status, is_tie, kickoff)
         values ($1, 0, 'NYG', 'WSH', 'final', true, '2026-12-01T18:00:00Z') returning id`,
        [week19],
      );
      const open = await client.query(
        `insert into private.games (week_id, slot, away_id, home_id, status, kickoff)
         values ($1, 1, 'BUF', 'KC', 'postponed', '2026-12-02T01:00:00Z') returning id`,
        [week19],
      );
      await client.query(
        `insert into private.entries (player_id, week_id, mnf_guess) values ($1, $2, 40)`,
        [chelseaId, week19],
      );
      await client.query(
        `insert into private.picks (player_id, game_id, team_id) values ($1, $2, 'NYG')`,
        [chelseaId, tie.rows[0].id],
      );
      await client.query("select private.award_week($1)", [week19]);
      const held = await client.query("select private.week_complete($1) as done", [week19]);
      expect(held.rows[0].done).toBe(false);
      const scored = await client.query("select private.entry_correct($1, $2) as n", [chelseaId, week19]);
      expect(scored.rows[0].n).toBe(0);
      await client.query("update private.games set status = 'excluded' where id = $1", [open.rows[0].id]);
      await client.query(
        `insert into private.games (week_id, slot, away_id, home_id, status, is_tie, winner_team_id, is_mnf, kickoff)
         values ($1, 2, 'DAL', 'PHI', 'final', false, 'PHI', true, '2026-12-02T01:15:00Z')`,
        [week19],
      );
      await client.query("select private.award_week($1)", [week19]);
      const done = await client.query("select private.week_complete($1) as done", [week19]);
      expect(done.rows[0].done).toBe(true);
      const wins = await client.query("select count(*)::int as n from private.week_wins where week_id = $1", [week19]);
      expect(wins.rows[0].n).toBe(1);
    } finally {
      await client.query("rollback");
    }
  });

  it("starts a new season without dropping the roster, then rolls back", async () => {
    await client.query("begin");
    try {
      await client.query("update private.secrets set token_hash = $1 where name = 'admin'", [hash(adminToken)]);
      await client.query(
        "select private.admin_start_season($1, 2099, '2099 season', 'integration rollover')",
        [adminToken],
      );
      const seasons = await client.query("select year, status from private.seasons order by year");
      expect(seasons.rows).toEqual(
        expect.arrayContaining([
          { year: 2026, status: "archived" },
          { year: 2099, status: "active" },
        ]),
      );
      const players = await client.query("select count(*)::int as n from private.players");
      expect(players.rows[0].n).toBe(14);
      const weeks = await client.query(
        `select count(*)::int as n from private.weeks w
         join private.seasons s on s.id = w.season_id where s.year = 2099`,
      );
      expect(weeks.rows[0].n).toBe(0);
    } finally {
      await client.query("rollback");
    }
  });

  it("rate-limits score sync and hides that claim from the public API", async () => {
    await client.query("delete from private.sync_log");
    const first = await client.query("select public.claim_sync() as ok");
    const second = await client.query("select public.claim_sync() as ok");
    expect(first.rows[0].ok).toBe(true);
    expect(second.rows[0].ok).toBe(false);
    const anonCall = await rpc("claim_sync", {});
    expect(anonCall.status).toBeGreaterThanOrEqual(400);
    await client.query("delete from private.sync_log");
  });

  it("loads 2026 from the generated SQL and the sheet check is empty", async () => {
    const { execFileSync } = await import("node:child_process");
    const sql = execFileSync(path.resolve("node_modules/.bin/tsx"), ["scripts/import-sql.ts"], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });
    const result = await client.query(sql);
    const rows = Array.isArray(result) ? result[result.length - 1].rows : result.rows;
    expect(rows).toEqual([]);
    const toby = await client.query("select private.report_standings(2026) as report");
    const row = toby.rows[0].report.players.find(
      (player: { full_name: string }) => player.full_name === "Toby Spurlock",
    );
    expect(row.total).toBe(98);
    expect(row.wins).toBe(4);
  });

  it("still matches the sheet after the other checks", async () => {
    const report = await client.query("select private.report_standings(2026) as report");
    const toby = report.rows[0].report.players.find((player: { full_name: string }) => player.full_name === "Toby Spurlock");
    expect(toby.total).toBe(98);
    expect(toby.wins).toBe(4);
    const week9 = report.rows[0].report.champions.find((row: { week: number }) => row.week === 9);
    expect(week9.winners).toEqual(["Toby Spurlock"]);
    expect(week9.tiebreak).toBe(true);
  });
});
