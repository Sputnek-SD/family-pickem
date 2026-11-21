import { describe, expect, it } from "vitest";
import { displayName } from "../../src/lib/names.ts";
import { ordinal, rankByTotal } from "../../src/lib/rank.ts";
import { highScoreWasTied, scoreEntry, seasonTotal, weekComplete, weeklyWinners, type ScoreEntry, type ScoreGame } from "../../src/lib/scoring.ts";
import { contrast, thanksgivingWindow, themeForDate, THEMES } from "../../src/lib/theme.ts";
import { zonedToUtc } from "../../src/lib/time.ts";
import { loadExport } from "../../scripts/lib/parseExport.ts";
import path from "node:path";

const DATA = path.resolve("data/2026");

function game(partial: Partial<ScoreGame> & { id: string }): ScoreGame {
  return { final: true, tie: false, excluded: false, winner: "A", ...partial };
}

describe("scoring", () => {
  const games = [
    game({ id: "1", winner: "NE" }),
    game({ id: "2", winner: "SF" }),
    game({ id: "3", tie: true, winner: null }),
    game({ id: "4", excluded: true, final: false, winner: null }),
    game({ id: "5", final: false, winner: null }),
  ];

  it("scores a correct pick, ignores ties and excluded games, and skips games with no result", () => {
    const entry: ScoreEntry = {
      playerId: "brad",
      entered: true,
      picks: { "1": "NE", "2": "SEA", "3": "NYG", "4": "DAL", "5": "KC" },
      guess: 40,
    };
    const scored = scoreEntry(games, entry, 41);
    expect(scored.correct).toBe(1);
    expect(scored.diff).toBe(1);
    expect(weekComplete(games, 41)).toBe(false);
    expect(weeklyWinners([scored], false)).toEqual([]);
  });

  it("does not award a point for a tie, and a missed week is absent", () => {
    const onlyTie = [game({ id: "t", tie: true, winner: null })];
    const played = scoreEntry(onlyTie, { playerId: "a", entered: true, picks: { t: "NYG" }, guess: 10 }, 20);
    const missed = scoreEntry(onlyTie, { playerId: "b", entered: false, picks: {}, guess: null }, 20);
    expect(played.correct).toBe(0);
    expect(missed.entered).toBe(false);
    expect(missed.correct).toBe(0);
    expect(weekComplete(onlyTie, 20)).toBe(true);
  });

  it("holds the week open while a game has no result, and an excluded game does not", () => {
    const open = [game({ id: "a", winner: "KC" }), game({ id: "b", final: false, winner: null })];
    const held = [game({ id: "a", winner: "KC" }), game({ id: "b", final: false, winner: null, excluded: false })];
    const excluded = [game({ id: "a", winner: "KC" }), game({ id: "b", excluded: true, final: false, winner: null })];
    expect(weekComplete(open, 30)).toBe(false);
    expect(weekComplete(held, null)).toBe(false);
    expect(weekComplete(excluded, 30)).toBe(true);
    expect(weekComplete(excluded, null)).toBe(false);
  });

  it("gives the win to the high score, then the closest Monday total, then to each player still tied", () => {
    const rows = [
      { playerId: "dan", entered: true, correct: 11, diff: 0 },
      { playerId: "toby", entered: true, correct: 10, diff: 0 },
      { playerId: "tim", entered: true, correct: 4, diff: 0 },
    ];
    expect(weeklyWinners(rows, true)).toEqual(["dan"]);

    const tiedScore = [
      { playerId: "vicki", entered: true, correct: 10, diff: 38 },
      { playerId: "chelsea", entered: true, correct: 10, diff: 53 },
      { playerId: "adam", entered: true, correct: 9, diff: 0 },
    ];
    expect(weeklyWinners(tiedScore, true)).toEqual(["vicki"]);
    expect(highScoreWasTied(tiedScore)).toBe(true);

    const stillTied = [
      { playerId: "a", entered: true, correct: 8, diff: 4 },
      { playerId: "b", entered: true, correct: 8, diff: 4 },
      { playerId: "c", entered: true, correct: 8, diff: 9 },
    ];
    expect(weeklyWinners(stillTied, true).sort()).toEqual(["a", "b"]);
  });

  it("does not award the week when the leader has no Monday guess", () => {
    const rows = [
      { playerId: "leader", entered: true, correct: 12, diff: null },
      { playerId: "next", entered: true, correct: 11, diff: 1 },
    ];
    expect(weeklyWinners(rows, true)).toEqual([]);
    const onlyLeaderEligible = [
      { playerId: "leader", entered: true, correct: 12, diff: null },
      { playerId: "other", entered: true, correct: 12, diff: 3 },
    ];
    expect(weeklyWinners(onlyLeaderEligible, true)).toEqual(["other"]);
  });

  it("treats a missed week as zero in the season total", () => {
    expect(seasonTotal([9, null, 5])).toBe(14);
  });
});

describe("2026 sheet", () => {
  const exported = loadExport(DATA);

  it("reproduces every weekly score, season total, weekly win, and champion", () => {
    const names = exported.standings.map((row) => row.player);
    for (const row of exported.standings) {
      const scores = exported.weeks.map((week) => {
        const entry = week.entries.find((item) => item.player === row.player);
        if (!entry) return null;
        const games = week.games.map((game) => ({
          id: String(game.slot),
          final: game.winner != null || game.tie,
          tie: game.tie,
          excluded: false,
          winner: game.winner,
        }));
        const picks: Record<string, string | null> = {};
        entry.picks.forEach((pick, index) => {
          picks[String(index)] = pick;
        });
        return scoreEntry(
          games,
          { playerId: row.player, entered: true, picks, guess: entry.guess },
          week.mnfTotal,
        ).correct;
      });
      expect(scores, row.player).toEqual(row.weeks);
      expect(seasonTotal(scores), row.player).toBe(row.total);
    }

    const wins = new Map(names.map((name) => [name, 0]));
    for (const week of exported.weeks) {
      const games = week.games.map((game) => ({
        id: String(game.slot),
        final: game.winner != null || game.tie,
        tie: game.tie,
        excluded: false,
        winner: game.winner,
      }));
      const complete = weekComplete(games, week.mnfTotal);
      const scored = names.map((name) => {
        const entry = week.entries.find((item) => item.player === name);
        const picks: Record<string, string | null> = {};
        entry?.picks.forEach((pick, index) => {
          picks[String(index)] = pick;
        });
        return scoreEntry(
          games,
          { playerId: name, entered: !!entry, picks, guess: entry?.guess ?? null },
          week.mnfTotal,
        );
      });
      const winners = weeklyWinners(scored, complete);
      for (const winner of winners) wins.set(winner, (wins.get(winner) ?? 0) + 1);
      const champ = exported.champions.find((item) => item.week === week.week)!;
      if (week.week <= 10) {
        expect(complete, `week ${week.week}`).toBe(true);
        expect(winners, `week ${week.week}`).toEqual([champ.winner]);
        expect(highScoreWasTied(scored), `week ${week.week} tiebreak`).toBe(champ.tiebreak);
        expect(week.mnfTotal).toBe(champ.mnf);
      } else {
        expect(complete).toBe(false);
        expect(winners).toEqual([]);
        expect(champ.winner).toContain("not awarded");
      }
    }
    for (const row of exported.standings) {
      expect(wins.get(row.player), row.player).toBe(row.wins);
    }
  });
});

describe("names and ranks", () => {
  const tylerL = { first_name: "Tyler", last_name: "Lipetzky" };
  const tylerS = { first_name: "Tyler", last_name: "Spurlock" };
  const brad = { first_name: "Brad", last_name: "Lipetzky" };

  it("disambiguates the two Tylers only when both are in the view", () => {
    expect(displayName(tylerL, [tylerL, brad])).toBe("Tyler");
    expect(displayName(tylerL, [tylerL, tylerS])).toBe("Tyler L.");
    expect(displayName(tylerS, [tylerL, tylerS])).toBe("Tyler S.");
    expect(displayName(brad, [tylerL, tylerS, brad])).toBe("Brad");
  });

  it("uses 1st and 2nd with a TIED tag and never a T-rank", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    const ranked = rankByTotal([
      { full_name: "Toby Spurlock", total: 98 },
      { full_name: "Dan Spurlock", total: 98 },
      { full_name: "Tyler Lipetzky", total: 93 },
    ]);
    expect(ranked.map((row) => [row.place, row.tied, row.full_name])).toEqual([
      ["1st", true, "Dan Spurlock"],
      ["1st", true, "Toby Spurlock"],
      ["3rd", false, "Tyler Lipetzky"],
    ]);
    expect(JSON.stringify(ranked)).not.toContain("T1");
  });
});

describe("themes and clock", () => {
  it("picks the theme from the Pacific date and the playoff phase", () => {
    expect(themeForDate(new Date("2026-11-21T20:00:00Z"))).toBe("gameday");
    expect(themeForDate(new Date("2026-10-31T18:00:00Z"))).toBe("halloween");
    expect(themeForDate(new Date("2026-10-23T18:00:00Z"))).toBe("gameday");
    expect(themeForDate(new Date("2026-11-26T20:00:00Z"))).toBe("thanksgiving");
    expect(themeForDate(new Date("2026-11-23T18:00:00Z"))).toBe("thanksgiving");
    expect(themeForDate(new Date("2026-11-30T18:00:00Z"))).toBe("gameday");
    expect(themeForDate(new Date("2026-12-25T20:00:00Z"))).toBe("christmas");
    expect(themeForDate(new Date("2026-12-19T20:00:00Z"))).toBe("gameday");
    expect(themeForDate(new Date("2027-01-01T20:00:00Z"))).toBe("newyear");
    expect(themeForDate(new Date("2026-12-31T20:00:00Z"))).toBe("newyear");
    expect(themeForDate(new Date("2027-01-16T20:00:00Z"), "playoffs")).toBe("playoffs");
    expect(themeForDate(new Date("2027-02-14T20:00:00Z"), "superbowl")).toBe("superbowl");
    expect(themeForDate(new Date("2026-12-25T20:00:00Z"), "playoffs")).toBe("christmas");
    const thanks = thanksgivingWindow(2026);
    expect(thanks).toEqual({ start: 20261123, end: 20261129 });
  });

  it("keeps text contrast in every theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(contrast(theme.text, theme.bg), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.muted, theme.bg), `${name} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.accentInk, theme.accent), `${name} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.good, theme.bg), `${name} good`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.bad, theme.bg), `${name} bad`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("converts Pacific lock times, including daylight saving", () => {
    expect(zonedToUtc(2026, 11, 19, 17, 10).toISOString()).toBe("2026-11-20T01:10:00.000Z");
    expect(zonedToUtc(2026, 10, 1, 17, 10).toISOString()).toBe("2026-10-02T00:10:00.000Z");
    expect(zonedToUtc(2026, 11, 1, 10, 0).toISOString()).toBe("2026-11-01T18:00:00.000Z");
  });
});
