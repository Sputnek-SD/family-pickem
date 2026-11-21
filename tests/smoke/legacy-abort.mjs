import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = 4177;
const origin = `http://127.0.0.1:${port}`;

const signedIn = {
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
    lock_at: "2026-11-22T01:10:00.000Z", scheduled_open_at: null,
    complete: false, mnf_total: null, released: true, winner_ids: [],
  }],
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

let calls = 0;
const failures = [];
let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.clock.install({ time: new Date("2026-11-21T18:00:00Z") });
  await page.addInitScript(() => {
    delete AbortSignal.timeout;
  });
  await page.route("**/rest/v1/rpc/bootstrap", async (route) => {
    calls += 1;
    if (calls === 2) {
      await new Promise(() => {});
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn),
    });
  });
  await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
  const timeoutGone = await page.evaluate(() => typeof AbortSignal.timeout !== "function");
  if (!timeoutGone) failures.push("AbortSignal.timeout was still a function");
  await page.getByTestId("week-title").waitFor({ timeout: 8000 });
  const afterStart = calls;
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(50);
  if (calls < afterStart + 1) failures.push(`the poll did not start a fetch (saw ${calls})`);
  await page.clock.fastForward(16_000);
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(50);
  if (calls < afterStart + 2) {
    failures.push(`without AbortSignal.timeout a stalled bootstrap blocked the next poll (saw ${calls}, started at ${afterStart})`);
  }
  if (await page.getByTestId("week-title").count() !== 1) {
    failures.push("the Week screen did not stay up");
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
console.log("Without AbortSignal.timeout, a player link still opens the week and a stalled bootstrap still times out.");
process.exit(0);
