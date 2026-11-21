import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const shots = "docs/screenshots";

const raiders = {
  id: "LV",
  name: "Las Vegas Raiders",
  short_name: "Raiders",
  location: "Las Vegas",
  color: "#000000",
  logo: "https://a.espncdn.com/i/teamlogos/nfl/500/lv.png",
};
const chiefs = {
  id: "KC",
  name: "Kansas City Chiefs",
  short_name: "Chiefs",
  location: "Kansas City",
  color: "#E31837",
  logo: "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
};

function gameFor(state) {
  const game = {
    id: "g",
    week_id: "week",
    slot: 0,
    kickoff: "2026-11-22T21:25:00.000Z",
    is_mnf: false,
    neutral: false,
    away: raiders,
    home: chiefs,
    locked: state !== "open",
    status: "final",
    is_tie: false,
    away_score: 17,
    home_score: 24,
    winner_team_id: "KC",
  };
  if (state === "open") {
    return { ...game, status: "scheduled", locked: false, away_score: null, home_score: null, winner_team_id: null };
  }
  if (state === "right") return { ...game, away_score: 24, home_score: 17, winner_team_id: "LV" };
  if (state === "tie") return { ...game, is_tie: true, away_score: 20, home_score: 20, winner_team_id: null };
  return game;
}

function bootFor(state) {
  return {
    now: "2026-11-21T18:00:00.000Z",
    authenticated: true,
    me: { player_id: "chelsea", full_name: "Chelsea Jess", first_name: "Chelsea", last_name: "Jess" },
    is_admin: false,
    phase: "regular",
    season: {
      id: "season", year: 2026, name: "2026", status: "active",
      lock_mode: "deadline", lock_time: "17:10", lock_weekday: 4, lock_timezone: "America/Los_Angeles",
    },
    current_week_id: "week",
    live_week_id: null,
    weeks: [{
      id: "week", season_type: 2, week_number: 11, label: "Week 11",
      lock_at: state === "open" ? "2026-11-22T01:10:00.000Z" : "2026-11-20T01:10:00.000Z",
      scheduled_open_at: null, complete: false, mnf_total: null, released: true, winner_ids: [],
    }],
    games: [gameFor(state)],
    my_picks: { g: "LV" },
    my_guess: 41,
    my_entry: true,
    missing: [],
    leaderboard: null,
    standings: [],
    seasons: [],
    all_time: null,
    roster: null,
  };
}

function luminance(hex) {
  const value = parseInt(hex.slice(1), 16);
  const linear = (channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const red = linear((value >> 16) & 255);
  const green = linear((value >> 8) & 255);
  const blue = linear(value & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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
  await mkdir(shots, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const states = ["open", "right", "wrong", "tie"];
  const viewports = [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ];
  for (const viewport of viewports) {
    for (const state of states) {
      const problems = [];
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on("pageerror", (error) => problems.push(error.message));
      await page.route("**/rest/v1/rpc/bootstrap", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(bootFor(state)),
      }));
      await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
      const card = page.getByTestId("pick-0-LV");
      await card.waitFor({ timeout: 8000 });
      const ratio = await card.evaluate((el) => {
        const parse = (color) => {
          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return match ? match.slice(1, 4).map(Number) : null;
        };
        const background = parse(getComputedStyle(el).backgroundColor);
        const parts = ["strong", "small", ".score"].map((selector) => {
          const node = el.querySelector(selector);
          return node ? { selector, rgb: parse(getComputedStyle(node).color) } : null;
        }).filter(Boolean);
        return { background, parts };
      });
      const bg = `#${ratio.background.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
      for (const part of ratio.parts) {
        const ink = `#${part.rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        const value = contrast(ink, bg);
        if (value < 4.5) problems.push(`${part.selector} ${ink} on ${bg} is ${value.toFixed(2)}:1`);
      }
      if (!ratio.parts.some((part) => part.selector === "strong")) problems.push("missing team name");
      await card.screenshot({ path: `${shots}/${viewport.name}-raiders-${state}.png` });
      if (problems.length) failures.push(`${viewport.name} ${state}\n${problems.join("\n")}`);
      await context.close();
    }
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
console.log("Raiders cards stay readable before lock, and when the pick is right, wrong, or a tie.");
