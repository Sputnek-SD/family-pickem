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
    const pregame = normalizeScoreboard({
      season: { type: 2, year: 2026 },
      week: { number: 12 },
      events: [{
        id: "pre",
        date: "2026-11-30T01:15:00Z",
        competitions: [{
          status: { type: { name: "STATUS_SCHEDULED", state: "pre", completed: false } },
          competitors: [
            { homeAway: "away", score: "0", team: { abbreviation: "WAS" } },
            { homeAway: "home", score: "0", team: { abbreviation: "BAL" } },
          ],
        }],
      }],
    });
    expect(pregame?.events[0]).toMatchObject({ state: "scheduled", away_score: null, home_score: null });
  });
});