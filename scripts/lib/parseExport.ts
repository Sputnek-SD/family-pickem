import { readFileSync } from "node:fs";
import path from "node:path";
import { isTie, resolveTeam } from "../../src/lib/teams.ts";
import { zonedToUtc } from "../../src/lib/time.ts";

export type ParsedGame = {
  slot: number;
  away: string;
  home: string;
  winner: string | null;
  tie: boolean;
  kickoff: string | null;
  kickoffEstimated: boolean;
  mnf: boolean;
  awayScore: number | null;
  homeScore: number | null;
};

export type ParsedEntry = {
  player: string;
  picks: (string | null)[];
  guess: number | null;
  submittedAt: string | null;
};

export type ParsedWeek = {
  week: number;
  games: ParsedGame[];
  mnfTotal: number | null;
  entries: ParsedEntry[];
};

export type StandingRow = {
  player: string;
  weeks: Array<number | null>;
  wins: number;
  total: number;
};

export type ChampionRow = {
  week: number;
  status: string;
  winner: string;
  tiebreak: boolean;
  mnf: number | null;
};

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

function weekThursday(week: number): { y: number; m: number; d: number } {
  const base = new Date(Date.UTC(2026, 9, 1));
  base.setUTCDate(base.getUTCDate() + (week - 4) * 7);
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

function addDays(y: number, m: number, d: number, days: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function iso(y: number, m: number, d: number, hour: number, minute: number): string {
  return zonedToUtc(y, m, d, hour, minute).toISOString();
}

export function parseKickoff(raw: string, seasonYear = 2026): string | null {
  const match = raw.match(
    /([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (!match) return null;
  const month = MONTHS[match[1].slice(0, 1).toUpperCase() + match[1].slice(1, 3).toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  let hour = Number(match[3]) % 12;
  if (match[5].toUpperCase() === "PM") hour += 12;
  const minute = Number(match[4]);
  const year = month <= 2 ? seasonYear + 1 : seasonYear;
  return iso(year, month, day, hour, minute);
}

function parseSubmitted(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === "PM") hour += 12;
  return zonedToUtc(
    Number(match[3]),
    Number(match[1]),
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6]),
  ).toISOString();
}

function estimateKickoff(week: number, slot: number, count: number): string {
  const thu = weekThursday(week);
  const sun = addDays(thu.y, thu.m, thu.d, 3);
  const mon = addDays(thu.y, thu.m, thu.d, 4);
  if (slot === 0) return iso(thu.y, thu.m, thu.d, 17, 15);
  if (slot === count - 1) return iso(mon.y, mon.m, mon.d, 17, 15);
  return iso(sun.y, sun.m, sun.d, 13, 0);
}

export function loadExport(dir: string): {
  weeks: ParsedWeek[];
  standings: StandingRow[];
  champions: ChampionRow[];
} {
  const schedule = parseCsv(readFileSync(path.join(dir, "schedule.csv"), "utf8"));
  const header = schedule[0];
  const col = (name: string) => header.indexOf(name);
  const byWeek = new Map<number, string[][]>();
  for (const row of schedule.slice(1)) {
    const week = Number(row[col("Week")].replace(/\D/g, ""));
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(row);
  }

  const weeks: ParsedWeek[] = [];
  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    const rows = byWeek.get(week)!;
    const games: ParsedGame[] = rows.map((row, slot) => {
      const kickRaw = row[col("Kickoff (Pacific)")]?.trim() ?? "";
      const parsedKick = kickRaw ? parseKickoff(kickRaw) : null;
      const winnerRaw = row[col("Winner")]?.trim() ?? "";
      const tie = isTie(winnerRaw);
      const away = resolveTeam(row[col("Away Team")]);
      const home = resolveTeam(row[col("Home Team")]);
      if (!away || !home) throw new Error(`Week ${week} is missing a team`);
      let awayScore: number | null = null;
      let homeScore: number | null = null;
      if (week === 11 && slot === 0 && winnerRaw) {
        awayScore = 3;
        homeScore = 26;
      }
      return {
        slot,
        away,
        home,
        winner: tie ? null : resolveTeam(winnerRaw),
        tie,
        kickoff: parsedKick,
        kickoffEstimated: !parsedKick,
        mnf: false,
        awayScore,
        homeScore,
      };
    });
    const mnfIndex = games.length - 1;
    games[mnfIndex].mnf = true;
    for (const game of games) {
      if (!game.kickoff) {
        game.kickoff = estimateKickoff(week, game.slot, games.length);
        game.kickoffEstimated = true;
      }
    }
    let mnfTotal: number | null = null;
    for (const row of rows) {
      const raw = row[col("Monday Night Total")]?.trim();
      if (raw) mnfTotal = Number(raw);
    }

    const picks = parseCsv(readFileSync(path.join(dir, `week_${String(week).padStart(2, "0")}_picks.csv`), "utf8"));
    const picksHeader = picks[0];
    const gameCols: number[] = [];
    let submittedCol = -1;
    let guessCol = -1;
    picksHeader.forEach((name, index) => {
      const label = name.trim();
      if (!label || label === "Player") return;
      if (label === "Submitted (Pacific)") submittedCol = index;
      else if (label === "MNF Tiebreaker") guessCol = index;
      else if (label === "Correct Picks" || label === "Tiebreak Diff") return;
      else gameCols.push(index);
    });
    if (gameCols.length !== games.length) {
      throw new Error(`Week ${week} has ${games.length} schedule games and ${gameCols.length} pick columns`);
    }
    const entries: ParsedEntry[] = [];
    for (const row of picks.slice(1)) {
      if (row[0].trim() === "ACTUAL WINNERS") continue;
      const player = row[0].trim();
      if (!player) continue;
      const pickIds = gameCols.map((index) => {
        const raw = row[index]?.trim() ?? "";
        if (!raw) return null;
        return resolveTeam(raw);
      });
      const guessRaw = guessCol >= 0 ? row[guessCol]?.trim() ?? "" : "";
      const submittedRaw = submittedCol >= 0 ? row[submittedCol]?.trim() ?? "" : "";
      entries.push({
        player,
        picks: pickIds,
        guess: guessRaw === "" ? null : Number(guessRaw),
        submittedAt: submittedRaw ? parseSubmitted(submittedRaw) : null,
      });
    }
    weeks.push({ week, games, mnfTotal, entries });
  }

  const standingsCsv = parseCsv(readFileSync(path.join(dir, "standings.csv"), "utf8"));
  const standings: StandingRow[] = standingsCsv.slice(1).map((row) => ({
    player: row[0].trim(),
    weeks: row.slice(1, 12).map((value) => (value.trim() === "" ? null : Number(value))),
    wins: Number(row[12]),
    total: Number(row[13]),
  }));

  const champsCsv = parseCsv(readFileSync(path.join(dir, "weekly_champions.csv"), "utf8"));
  const champions: ChampionRow[] = champsCsv.slice(1).map((row) => ({
    week: Number(row[0]),
    status: row[1],
    winner: row[5].trim(),
    tiebreak: row[6].trim().toLowerCase() === "yes",
    mnf: row[7].trim() === "" ? null : Number(row[7]),
  }));

  return { weeks, standings, champions };
}
