import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeScoreboard } from "../../supabase/functions/_shared/espn.ts";

describe("ESPN scoreboard", () => {
  it("reads finals, ties-ready scores, and postponed games", () => {
    const payload = JSON.parse(readFileSync("tests/fixtures/espn-scoreboard.json", "utf8"));
    const board = normalizeScoreboard(payload);
    expect(board).toMatchObject({ season_year: 2025, season_type: 2, week: 1 });
    expect(board?.events[0]).toMatchObject({
      espn_id: "401772510",
      state: "final",
      away_abbr: "DAL",
      home_abbr: "PHI",
      away_score: 20,
      home_score: 24,
    });
    expect(board?.events[1].state).toBe("postponed");
    expect(normalizeScoreboard({})).toBeNull();
  });
});