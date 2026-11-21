import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const slowMs = 1200;

const signedIn = {
  now: "2026-11-21T18:00:00.000Z",
  authenticated: true,
  me: {
    player_id: "chelsea",
    full_name: "Chelsea Jess",
    first_name: "Chelsea",
    last_name: "Jess",
  },
  is_admin: false,
  phase: "regular",
  season: {
    id: "season",
    year: 2026,
    name: "2026",
    status: "active",
    lock_mode: "deadline",
    lock_time: "17:10",
    lock_weekday: 4,
    lock_timezone: "America/Los_Angeles",
  },
  current_week_id: "week",
  live_week_id: null,
  weeks: [{
    id: "week",
    season_type: 2,
    week_number: 11,
    label: "Week 11",
    lock_at: "2026-11-20T01:10:00.000Z",
    scheduled_open_at: null,
    complete: false,
    mnf_total: null,
    released: true,
    winner_ids: [],
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
    } catch {
      // preview is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The preview server did not start");
}

function bootFrom(body) {
  if (!body?.p_player_token) {
    return { now: signedIn.now, authenticated: false };
  }
  if (body.p_player_token === "bogus") {
    return { now: signedIn.now, authenticated: false, bad_token: true };
  }
  return signedIn;
}

async function installBootstrap(page, problems) {
  const counts = { tokened: 0, plain: 0 };
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.route("**/rest/v1/rpc/bootstrap", async (route) => {
    const body = route.request().postDataJSON();
    const payload = bootFrom(body);
    if (!body?.p_player_token) {
      counts.plain += 1;
      await new Promise((resolve) => setTimeout(resolve, slowMs));
    } else {
      counts.tokened += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  return counts;
}

const failures = [];
let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });

  {
    const problems = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    const counts = await installBootstrap(page, problems);
    await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("week-title").waitFor({ timeout: 8000 });
    await page.waitForTimeout(slowMs + 400);
    if (counts.tokened !== 1) problems.push(`expected one tokened bootstrap, saw ${counts.tokened}`);
    if (await page.getByTestId("welcome").count()) {
      problems.push("a late tokenless response replaced the signed-in week");
    }
    const title = await page.getByTestId("week-title").innerText();
    if (!/week 11/i.test(title)) problems.push(`expected Week 11, saw ${title}`);
    if (problems.length) failures.push(`player link\n${problems.join("\n")}`);
    await context.close();
  }

  {
    const problems = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    await installBootstrap(page, problems);
    await page.goto(`${origin}/#/p/bogus`, { waitUntil: "domcontentloaded" });
    await page.getByText("doesn’t match anyone in the pool").waitFor({ timeout: 8000 });
    await page.waitForTimeout(slowMs + 400);
    if (await page.getByText("doesn’t match anyone in the pool").count() !== 1) {
      problems.push("the bad-link message did not survive the late tokenless response");
    }
    if (problems.length) failures.push(`bad link\n${problems.join("\n")}`);
    await context.close();
  }

  {
    const problems = [];
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const deny = function denyStorage() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      Storage.prototype.getItem = deny;
      Storage.prototype.setItem = deny;
      Storage.prototype.removeItem = deny;
      Storage.prototype.clear = deny;
      Storage.prototype.key = deny;
    });
    const page = await context.newPage();
    await installBootstrap(page, problems);
    await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("week-title").waitFor({ timeout: 8000 });
    if (await page.getByTestId("app-error").count()) {
      problems.push("blocked storage showed the error screen");
    }
    if (problems.length) failures.push(`blocked storage\n${problems.join("\n")}`);
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
console.log("Sign-in race: a late tokenless response kept the player signed in, and the bad-link message stayed.");
