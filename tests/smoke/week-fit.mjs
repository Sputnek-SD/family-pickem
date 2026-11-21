import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = 4179;
const origin = `http://127.0.0.1:${port}`;

function team(id, name, short, location, color) {
  return { id, name, short_name: short, location, color, logo: "" };
}

const dolphins = team("MIA", "Miami Dolphins", "Dolphins", "Miami", "#008E97");
const bucs = team("TB", "Tampa Bay Buccaneers", "Buccaneers", "Tampa Bay", "#D50A0A");
const cowboys = team("DAL", "Dallas Cowboys", "Cowboys", "Dallas", "#003594");
const commanders = team("WSH", "Washington Commanders", "Commanders", "Washington", "#5A1414");
const panthers = team("CAR", "Carolina Panthers", "Panthers", "Carolina", "#0085CA");
const cardinals = team("ARI", "Arizona Cardinals", "Cardinals", "Arizona", "#97233F");

function finalGame(id, slot, away, home, awayScore, homeScore, winner) {
  return {
    id,
    week_id: "week",
    slot,
    kickoff: "2026-11-22T18:00:00.000Z",
    is_mnf: false,
    neutral: false,
    away,
    home,
    locked: true,
    status: "final",
    is_tie: false,
    away_score: awayScore,
    home_score: homeScore,
    winner_team_id: winner,
  };
}

const boot = {
  now: "2026-11-23T18:00:00.000Z",
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
    lock_at: "2026-11-20T01:10:00.000Z",
    scheduled_open_at: null, complete: false, mnf_total: null, released: true, winner_ids: [],
  }],
  games: [
    finalGame("g1", 0, dolphins, bucs, 13, 27, "TB"),
    finalGame("g2", 1, cowboys, commanders, 17, 24, "WSH"),
    finalGame("g3", 2, panthers, cardinals, 14, 21, "ARI"),
  ],
  my_picks: { g1: "MIA", g2: "DAL", g3: "CAR" },
  my_guess: 41,
  my_entry: true,
  missing: [],
  leaderboard: null,
  standings: [],
  seasons: [],
  all_time: null,
  roster: null,
};

const themes = [
  ["gameday", "#08110e", "#dff25a"],
  ["halloween", "#140c09", "#ff8a2a"],
  ["thanksgiving", "#160e09", "#ffb020"],
  ["christmas", "#0c1412", "#ff5d6c"],
  ["newyear", "#0d1018", "#f3e2b3"],
  ["playoffs", "#100e09", "#e7c36a"],
  ["superbowl", "#090909", "#ffd76a"],
];

function luminance(hex) {
  const value = parseInt(hex.slice(1), 16);
  const linear = (channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(color) {
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) return rgb.slice(1, 4).map(Number);
  const srgb = color.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/);
  return srgb ? srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255)) : null;
}

function toHex(channels) {
  return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
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
  browser = await chromium.launch({ headless: true });
  const widths = [1024, 1200, 1440];
  for (const width of widths) {
    const problems = [];
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    await page.route("**/rest/v1/rpc/bootstrap", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(boot),
    }));
    await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("pick-0-TB").waitFor({ timeout: 8000 });
    const fit = await page.evaluate(() => {
      const intersects = (a, b) => a.left < b.right - 0.5
        && a.right > b.left + 0.5
        && a.top < b.bottom - 0.5
        && a.bottom > b.top + 0.5
        && a.right - a.left > 0.5
        && b.right - b.left > 0.5;
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const visible = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        let box = { left: text.left, right: text.right, top: text.top, bottom: text.bottom };
        let node = el;
        while (node && node !== document.documentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            const bound = node.getBoundingClientRect();
            box = {
              left: Math.max(box.left, bound.left),
              right: Math.min(box.right, bound.right),
              top: Math.max(box.top, bound.top),
              bottom: Math.min(box.bottom, bound.bottom),
            };
          }
          node = node.parentElement;
        }
        return box;
      };
      const inside = (inner, outer) => inner.right <= outer.right + 1
        && inner.left >= outer.left - 1
        && inner.bottom <= outer.bottom + 1
        && inner.top >= outer.top - 1;
      const hits = [];
      for (const tile of document.querySelectorAll(".team")) {
        const card = tile.closest(".game").getBoundingClientRect();
        const label = tile.dataset.testid;
        const name = tile.querySelector("strong");
        const city = tile.querySelector("small");
        const score = tile.querySelector(".score");
        const mark = tile.querySelector(".winner-mark");
        const nameBox = name ? visible(name) : null;
        const cityBox = city ? visible(city) : null;
        if (nameBox && score && intersects(nameBox, score.getBoundingClientRect())) {
          hits.push(`${label} name overlaps score by ${overlap(nameBox, score.getBoundingClientRect()).toFixed(0)}px`);
        }
        if (nameBox && mark && intersects(nameBox, mark.getBoundingClientRect())) {
          hits.push(`${label} name overlaps W by ${overlap(nameBox, mark.getBoundingClientRect()).toFixed(0)}px`);
        }
        if (cityBox && score && intersects(cityBox, score.getBoundingClientRect())) {
          hits.push(`${label} city overlaps score by ${overlap(cityBox, score.getBoundingClientRect()).toFixed(0)}px`);
        }
        if (cityBox && mark && intersects(cityBox, mark.getBoundingClientRect())) {
          hits.push(`${label} city overlaps W by ${overlap(cityBox, mark.getBoundingClientRect()).toFixed(0)}px`);
        }
        for (const node of [name, city, score, mark]) {
          if (!node) continue;
          const box = node.getBoundingClientRect();
          if (!inside(box, card)) hits.push(`${label} ${node.className || node.tagName} leaves its card`);
        }
      }
      const cards = [...document.querySelectorAll(".game")].map((card) => card.getBoundingClientRect());
      const games = document.querySelector(".games").getBoundingClientRect();
      const before = getComputedStyle(document.querySelector(".games"), "::before");
      const root = document.documentElement;
      return {
        hits,
        gamesWidth: games.width,
        stacked: cards[1].top >= cards[0].bottom - 2,
        sideBySide: cards[1].left > cards[0].right - 2 && Math.abs(cards[1].top - cards[0].top) < 8,
        divider: before.content,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      };
    });
    problems.push(...fit.hits);
    if (fit.scrollWidth > fit.clientWidth + 1) {
      problems.push(`page scrolls horizontally ${fit.scrollWidth} > ${fit.clientWidth}`);
    }
    if (width < 1200) {
      if (!fit.stacked) problems.push("games are not a single column");
      if (fit.gamesWidth > 681) problems.push(`single column is ${fit.gamesWidth.toFixed(0)}px wide`);
      if (fit.divider !== "none") problems.push(`divider shows below 1200 (${fit.divider})`);
    } else if (!fit.sideBySide) {
      problems.push("games are not two columns");
    } else if (fit.divider === "none") {
      problems.push("column divider is missing");
    }
    if (width === 1440) {
      for (const [name, background, accent] of themes) {
        const painted = await page.evaluate(({ background, accent }) => {
          const root = document.documentElement;
          root.style.setProperty("--bg", background);
          root.style.setProperty("--accent", accent);
          document.body.style.backgroundColor = background;
          const line = getComputedStyle(document.querySelector(".games"), "::before");
          return { color: line.backgroundColor, opacity: Number(line.opacity), page: getComputedStyle(document.body).backgroundColor };
        }, { background, accent });
        const ink = parseColor(painted.color);
        const paper = parseColor(painted.page);
        if (!ink || !paper) {
          problems.push(`${name} divider colors ${painted.color} on ${painted.page}`);
          continue;
        }
        const mixed = ink.map((channel, index) => Math.round(channel * painted.opacity + paper[index] * (1 - painted.opacity)));
        const ratio = contrast(toHex(mixed), toHex(paper));
        if (ratio < 2) problems.push(`${name} divider contrast ${ratio.toFixed(2)}:1`);
      }
    }
    if (problems.length) failures.push(`${width}\n${problems.join("\n")}`);
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
console.log("Names, scores, and W marks stay apart at 1024, 1200, and 1440.");
