import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = 4178;
const origin = `http://127.0.0.1:${port}`;
const ids = ["IND", "HOU", "KC", "BUF", "NYG", "DAL", "SEA", "SF"];

function team(id, color) {
  return { id, name: id, short_name: id, location: id, color, logo: "" };
}

const games = ids.map((id, index) => ({
  id: `g${index}`,
  week_id: "w10",
  slot: index,
  kickoff: null,
  status: "final",
  is_tie: false,
  is_mnf: index === ids.length - 1,
  neutral: false,
  away_score: 21,
  home_score: 17,
  winner_team_id: id,
  locked: true,
  away: team(id, "#00338D"),
  home: team(index % 2 ? "BAL" : "PHI", "#241773"),
}));

const people = [
  ["chelsea", "Chelsea", "Jess", 150, 6],
  ["toby", "Toby", "Spurlock", 43, 8],
  ["dan", "Dan", "Smith", 9, 4],
];

const board = {
  week: {
    id: "w10",
    label: "Week 10",
    week_number: 10,
    lock_at: "2026-11-13T01:10:00.000Z",
    complete: true,
    mnf_total: 43,
    visible: true,
  },
  games,
  missing: [],
  rows: people.map(([player_id, first_name, last_name, guess, correct]) => ({
    player_id,
    full_name: `${first_name} ${last_name}`,
    first_name,
    last_name,
    entered: true,
    guess,
    correct,
    diff: Math.abs(guess - 43),
    winner: player_id === "toby",
    picks: Object.fromEntries(games.map((game) => [game.id, game.away.id])),
  })),
};

const boot = {
  now: "2026-11-21T18:00:00.000Z",
  authenticated: true,
  me: { player_id: "chelsea", full_name: "Chelsea Jess", first_name: "Chelsea", last_name: "Jess" },
  is_admin: false,
  phase: "regular",
  season: {
    id: "season", year: 2026, name: "2026", status: "active",
    lock_mode: "deadline", lock_time: "17:10", lock_weekday: 4, lock_timezone: "America/Los_Angeles",
  },
  current_week_id: "w11",
  live_week_id: null,
  weeks: [
    {
      id: "w10", season_type: 2, week_number: 10, label: "Week 10",
      lock_at: "2026-11-13T01:10:00.000Z", scheduled_open_at: null,
      complete: true, mnf_total: 43, released: true, winner_ids: ["toby"],
    },
    {
      id: "w11", season_type: 2, week_number: 11, label: "Week 11",
      lock_at: "2026-11-20T01:10:00.000Z", scheduled_open_at: null,
      complete: false, mnf_total: null, released: true, winner_ids: [],
    },
  ],
  games: [],
  my_picks: {},
  my_guess: null,
  my_entry: false,
  missing: [],
  leaderboard: null,
  standings: [],
  seasons: [],
  all_time: null,
  roster: null,
};

const server = spawn(
  "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { stdio: "inherit", detached: true },
);
let previewExited = false;
server.on("exit", () => { previewExited = true; });
function stop() {
  if (!server.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
}

async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok && !previewExited) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The preview server did not start");
}

const failures = [];
let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ name: "390", width: 390, height: 844 }, { name: "1280", width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await page.route("**/rest/v1/rpc/**", async (route) => {
      const url = route.request().url();
      const body = url.includes("week_board") ? board : url.includes("bootstrap") ? boot : null;
      if (!body) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("week-title").waitFor({ timeout: 8000 });
    await page.evaluate(() => { location.hash = "#/history/10"; });
    await page.getByTestId("pick-grid").waitFor({ timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    const report = await page.evaluate(() => {
      const head = [...document.querySelectorAll(".gridrow.head .helmet")];
      const rows = [...document.querySelectorAll(".gridrow:not(.head)")];
      const drifts = [];
      head.forEach((helmet, index) => {
        const box = helmet.getBoundingClientRect();
        const centre = box.x + box.width / 2;
        rows.forEach((row, rowIndex) => {
          const cell = row.querySelectorAll(".cell")[index];
          if (!cell) return;
          const cellBox = cell.getBoundingClientRect();
          drifts.push({ index, rowIndex, delta: Math.abs(centre - (cellBox.x + cellBox.width / 2)) });
        });
      });
      const mnf = [...document.querySelectorAll(".gh.mnf, .gridrow:not(.head) .cell.guess")]
        .map((node) => Math.round(node.getBoundingClientRect().width * 10) / 10);
      const clip = [...document.querySelectorAll(".gh.mnf, .cell.guess")].map((node) => ({
        text: (node.textContent || "").replace(/\s+/g, " ").trim(),
        overflow: node.scrollWidth - node.clientWidth,
      }));
      return { drifts, mnf, clip, headers: head.length, rows: rows.length };
    });
    if (report.headers !== games.length || report.rows < 2) {
      problems.push(`expected ${games.length} headers and several rows, saw ${report.headers}/${report.rows}`);
    }
    for (const drift of report.drifts) {
      if (drift.delta > 1.5) {
        problems.push(`column ${drift.index} row ${drift.rowIndex} is ${drift.delta.toFixed(2)}px off`);
      }
    }
    const uniqueMnf = [...new Set(report.mnf)];
    if (viewport.width >= 900 && uniqueMnf.length > 1) {
      problems.push(`Monday column widths differ: ${report.mnf.join(", ")}`);
    }
    for (const item of report.clip) {
      if (item.overflow > 1) problems.push(`clipped "${item.text}" by ${item.overflow}px`);
    }
    if (problems.length) failures.push(`${viewport.name}\n${problems.join("\n")}`);
    await context.close();
  }
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await browser?.close();
  stop();
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log("History header helmets line up with the cells under them at 390 and 1280.");
