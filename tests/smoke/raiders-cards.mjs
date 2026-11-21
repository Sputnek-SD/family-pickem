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
const bills = {
  id: "BUF",
  name: "Buffalo Bills",
  short_name: "Bills",
  location: "Buffalo",
  color: "#00338D",
  logo: "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
};
const ravens = {
  id: "BAL",
  name: "Baltimore Ravens",
  short_name: "Ravens",
  location: "Baltimore",
  color: "#241773",
  logo: "https://a.espncdn.com/i/teamlogos/nfl/500/bal.png",
};
const themeAccents = ["#dff25a", "#ff8a2a", "#ffb020", "#ff5d6c", "#f3e2b3", "#e7c36a", "#ffd76a"];

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
  if (state === "open" || state === "blank") {
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
      lock_at: state === "open" || state === "blank" ? "2026-11-22T01:10:00.000Z" : "2026-11-20T01:10:00.000Z",
      scheduled_open_at: null, complete: false, mnf_total: null, released: true, winner_ids: [],
    }],
    games: [
      gameFor(state),
      {
        id: "g2",
        week_id: "week",
        slot: 1,
        kickoff: "2026-11-23T01:20:00.000Z",
        is_mnf: false,
        neutral: false,
        away: bills,
        home: ravens,
        locked: state !== "open" && state !== "blank",
        status: "scheduled",
        is_tie: false,
        away_score: null,
        home_score: null,
        winner_team_id: null,
      },
    ],
    my_picks: state === "blank" ? {} : { g: "LV" },
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

function clearColor(color) {
  return color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
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
    { name: "desktop", width: 1440, height: 800 },
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
      const other = await page.getByTestId("pick-0-KC").evaluate((el) => {
        const parse = (color) => {
          const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (rgb) return rgb.slice(1, 4).map(Number);
          const srgb = color.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/);
          return srgb ? srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255)) : null;
        };
        const button = getComputedStyle(el);
        const name = getComputedStyle(el.querySelector("strong"));
        const card = el.closest(".game");
        const surfaceRaw = getComputedStyle(card).backgroundColor;
        const inkRaw = name.color;
        const surface = parse(surfaceRaw);
        const ink = parse(inkRaw);
        const alpha = Number(name.opacity);
        const blended = surface && ink
          ? ink.map((channel, index) => Math.round(channel * alpha + surface[index] * (1 - alpha)))
          : null;
        const score = el.querySelector(".score");
        const mark = el.querySelector(".winner-mark");
        const helmet = el.querySelector(".helmet");
        return {
          bg: button.backgroundColor,
          border: button.borderTopWidth,
          shadow: button.boxShadow,
          nameOpacity: name.opacity,
          blended,
          surface,
          surfaceRaw,
          inkRaw,
          helmetBg: getComputedStyle(helmet).backgroundColor,
          helmetFilter: getComputedStyle(el.querySelector(".helmet img")).filter,
          scoreOpacity: score ? getComputedStyle(score).opacity : null,
          markOpacity: mark ? getComputedStyle(mark).opacity : null,
          versus: card.querySelectorAll(".versus").length,
        };
      });
      if (!other.blended || !other.surface) {
        problems.push(`could not read unpicked colors ink=${other.inkRaw} surface=${other.surfaceRaw}`);
      }
      const nameContrast = other.blended
        ? contrast(
          `#${other.blended.map((n) => n.toString(16).padStart(2, "0")).join("")}`,
          `#${other.surface.map((n) => n.toString(16).padStart(2, "0")).join("")}`,
        )
        : 0;
      if (!clearColor(other.bg)) problems.push(`unpicked background ${other.bg}`);
      if (other.border !== "0px") problems.push(`unpicked border ${other.border}`);
      if (other.shadow !== "none") problems.push(`unpicked shadow ${other.shadow}`);
      const nameOpacity = Number(other.nameOpacity);
      if (nameOpacity < 0.45 || nameOpacity > 0.55) problems.push(`unpicked name opacity ${other.nameOpacity}`);
      if (nameContrast < 3) problems.push(`unpicked name contrast ${nameContrast.toFixed(2)}:1`);
      if (!clearColor(other.helmetBg)) problems.push(`unpicked helmet plate ${other.helmetBg}`);
      if (!String(other.helmetFilter).includes("grayscale")) problems.push(`unpicked helmet filter ${other.helmetFilter}`);
      if (other.scoreOpacity && other.scoreOpacity !== "1") problems.push(`unpicked score opacity ${other.scoreOpacity}`);
      if (other.markOpacity && Number(other.markOpacity) < 0.99) problems.push(`unpicked W opacity ${other.markOpacity}`);
      if (other.versus !== 1) problems.push(`expected one @ between picked teams, saw ${other.versus}`);
      const split = await page.locator(".games").evaluate((el) => {
        const before = getComputedStyle(el, "::before");
        const grid = el.getBoundingClientRect();
        const cards = [...el.querySelectorAll(":scope > .game")].map((card) => {
          const box = card.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        });
        const width = parseFloat(before.width);
        const left = before.left.endsWith("%")
          ? (grid.width * parseFloat(before.left)) / 100
          : parseFloat(before.left);
        let shift = 0;
        const matrix = before.transform.match(/matrix\(([^)]+)\)/);
        if (matrix) shift = Number(matrix[1].split(",")[4]);
        return {
          content: before.content,
          width,
          opacity: Number(before.opacity),
          lineX: grid.left + left + shift + width / 2,
          cards,
          gap: cards.length >= 2 ? cards[1].left - cards[0].right : null,
        };
      });
      if (viewport.name === "desktop") {
        if (split.content === "none") problems.push("column divider is missing");
        if (!(split.width >= 1 && split.width <= 2)) problems.push(`divider width ${split.width}`);
        if (!(split.opacity >= 0.45 && split.opacity <= 0.5)) problems.push(`divider opacity ${split.opacity}`);
        if (!(split.gap >= 40 && split.gap <= 56)) problems.push(`column gutter ${split.gap}`);
        const [leftCard, rightCard] = split.cards;
        if (!(leftCard.right < split.lineX && split.lineX < rightCard.left)) {
          problems.push(`divider at ${split.lineX} is outside ${leftCard.right}..${rightCard.left}`);
        }
        if (state === "open") {
          for (const accent of themeAccents) {
            const painted = await page.evaluate((color) => {
              document.documentElement.style.setProperty("--accent", color);
              return getComputedStyle(document.querySelector(".games"), "::before").backgroundColor;
            }, accent);
            if (painted !== hexToRgb(accent)) problems.push(`theme ${accent} painted the divider ${painted}`);
          }
        }
      } else if (split.content !== "none") {
        problems.push(`phone shows a column divider (${split.content})`);
      }
      const at = await page.locator(".game").first().locator(".versus").evaluate((el) => {
        const style = getComputedStyle(el);
        return { display: style.display, size: style.fontSize };
      });
      if (viewport.name === "phone" && at.display !== "none") problems.push(`phone @ is ${at.display}`);
      if (viewport.name === "desktop" && at.size !== "16px") problems.push(`desktop @ is ${at.size}`);
      await card.screenshot({ path: `${shots}/${viewport.name}-raiders-${state}.png` });
      if (problems.length) failures.push(`${viewport.name} ${state}\n${problems.join("\n")}`);
      await context.close();
    }
  }
  for (const viewport of viewports) {
    const problems = [];
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    await page.route("**/rest/v1/rpc/bootstrap", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bootFor("blank")),
    }));
    await page.goto(`${origin}/#/p/chelsea`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("pick-0-LV").waitFor({ timeout: 8000 });
    const openTiles = await page.evaluate(() => ["pick-0-LV", "pick-0-KC"].map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const cs = getComputedStyle(el);
      return {
        id,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        aside: el.classList.contains("aside"),
        versus: document.querySelectorAll(".versus").length,
      };
    }));
    for (const tile of openTiles) {
      if (tile.aside) problems.push(`${tile.id} is styled unpicked before anyone picks`);
      if (clearColor(tile.bg)) problems.push(`${tile.id} has no tile background`);
      if (tile.border === "0px") problems.push(`${tile.id} has no border`);
      if (tile.versus !== 0) problems.push(`versus shown with no pick (${tile.versus})`);
    }
    if (problems.length) failures.push(`${viewport.name} blank\n${problems.join("\n")}`);
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
console.log("Raiders cards stay readable before lock, and when the pick is right, wrong, or a tie.");
