import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import pg from "pg";

const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const api = process.env.API_URL ?? "http://127.0.0.1:54321";
const shots = "/opt/cursor/artifacts";
const phoneShots = "docs/screenshots";

const tokens = JSON.parse(readFileSync(".tokens.local.json", "utf8")) as Record<string, string>;

async function rpc(fn: string, body: unknown) {
  const response = await fetch(`${api}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${fn} ${response.status} ${text}`);
  return payload;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  if (name.startsWith("phone-") || name.startsWith("desktop-pick")) {
    await page.screenshot({ path: `${phoneShots}/${name}.png`, fullPage: true });
  }
}

async function shotCard(page: Page, slot: number, name: string) {
  const card = page.getByTestId(`game-${slot}`);
  await card.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await card.screenshot({ path: `${shots}/${name}.png` });
  await card.screenshot({ path: `${phoneShots}/${name}.png` });
}

test("a player can pick, lock, review, and Brad can run the pool", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await mkdir(phoneShots, { recursive: true });
  execSync("npx tsx scripts/import-history.ts", {
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    stdio: "pipe",
  });
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();
  await db.query("begin");
  await db.query("select set_config('private.bypass_lock', 'on', true)");
  await db.query("delete from private.seasons where year <> 2026");
  await db.query(
    `delete from private.picks pk
     using private.games g, private.weeks w, private.seasons s, private.players p
     where pk.game_id = g.id and g.week_id = w.id and w.season_id = s.id
       and pk.player_id = p.id and p.full_name = 'Chelsea Jess'
       and s.year = 2026 and w.week_number = 11`,
  );
  await db.query(
    `delete from private.entries e
     using private.weeks w, private.seasons s, private.players p
     where e.week_id = w.id and w.season_id = s.id and e.player_id = p.id
       and p.full_name = 'Chelsea Jess' and s.year = 2026 and w.week_number = 11`,
  );
  await db.query("commit");
  await db.end();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(page.getByTestId("nav-week")).toHaveCount(0);
  await shot(page, "phone-welcome");
  await rpc("admin_set_clock", { p_admin_token: tokens.admin, p_at: "2026-11-18T18:00:00Z" });

  await page.goto(`/#/p/${tokens["Chelsea Jess"]}`);
  await expect(page.getByTestId("week-title")).toHaveText("Week 11");
  await page.goto(`/#/a/${tokens.admin}`);
  await expect(page.getByTestId("admin")).toBeVisible();
  await page.goto("/#/");
  await expect(page.getByTestId("week-title")).toHaveText("Week 11");
  await expect(page.getByTestId("progress")).toContainText("0 of 13");
  await shot(page, "phone-week-open");

  const boot = await rpc("bootstrap", {
    p_player_token: tokens["Chelsea Jess"],
    p_admin_token: null,
  });
  for (const game of boot.games) {
    await page.getByTestId(`pick-${game.slot}-${game.home.id}`).click();
  }
  await page.getByTestId("mnf-guess").fill("47");
  await page.getByTestId("mnf-guess").blur();
  await expect(page.getByTestId("progress")).toContainText("13 of 13");
  await expect(page.getByTestId("saved-state")).toHaveText("Saved");
  await expect(page.getByText("Your pick").first()).toBeVisible();

  const flipped = boot.games[1];
  await page.getByTestId(`pick-${flipped.slot}-${flipped.away.id}`).click();
  await expect(page.getByTestId(`pick-${flipped.slot}-${flipped.away.id}`)).toHaveAttribute("aria-pressed", "true");
  await shot(page, "phone-week-picked");

  await rpc("admin_set_clock", { p_admin_token: tokens.admin, p_at: "2026-11-20T03:00:00Z" });
  await page.reload();
  await expect(page.getByTestId("countdown")).toContainText("Locked");
  await expect(page.getByText("See all")).toBeVisible();
  await expect(page.getByTestId("game-0")).toBeVisible();
  await expect(page.getByTestId(`pick-${flipped.slot}-${flipped.away.id}`)).toBeDisabled();
  const rejected = await fetch(`${api}/rest/v1/rpc/save_picks`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_player_token: tokens["Chelsea Jess"],
      p_week_id: boot.current_week_id,
      p_picks: [{ game_id: flipped.id, team_id: flipped.home.id }],
      p_mnf_guess: 47,
    }),
  });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  await shot(page, "phone-week-locked");

  await page.getByTestId("nav-board").click();
  await expect(page.getByTestId("pick-grid")).toBeVisible();
  await shot(page, "phone-board");

  await page.getByTestId("nav-standings").click();
  await expect(page.getByTestId("standing-Toby Spurlock")).toContainText("98");
  await expect(page.getByTestId("standing-Toby Spurlock")).toContainText("1st");
  await shot(page, "phone-standings");

  await page.getByTestId("nav-more").click();
  await shot(page, "phone-more");
  await page.getByTestId("nav-history").click();
  await expect(page.getByTestId("week-winner")).toContainText("Toby");
  await shot(page, "phone-history-week9");
  await page.getByTestId("history-5").click();
  await expect(page.getByRole("heading", { name: "Week 5" })).toBeVisible();
  const giants = page.locator(".gridrow.head .gh").filter({ hasText: "NYG" });
  await expect(giants).toContainText("@ WSH");
  await expect(giants.locator(".tied-pill")).toHaveText("TIE");
  await expect(page.locator(".cell.tie").first()).not.toHaveText("TIE");
  await giants.evaluate((node) => {
    if (!(node instanceof HTMLElement)) return;
    const scroller = node.closest(".gridwrap");
    if (!(scroller instanceof HTMLElement)) return;
    scroller.scrollLeft = Math.max(0, node.offsetLeft - 96);
  });
  await shot(page, "phone-history-week5");

  await page.getByTestId("nav-standings").click();
  await page.getByTestId("standing-Toby Spurlock").click();
  await expect(page.getByTestId("player-page")).toContainText("Toby Spurlock");
  await expect(page.getByTestId("player-page")).toContainText("98");
  await shot(page, "phone-player");

  await page.goto("/#/admin");
  await page.getByTestId("admin-note").fill("E2E result correction");
  await page.getByLabel("Result Dolphins at Bills").selectOption({ label: "Bills" });
  await page.getByLabel("Status").nth(1).selectOption("final");
  await page.getByTestId("override-1").click();
  await expect(page.getByTestId("admin-message")).toHaveText("Saved");
  await shot(page, "phone-admin");

  const byTeam = (id: string) => boot.games.find((game: { home: { id: string }; away: { id: string } }) => game.home.id === id || game.away.id === id);
  const texans = byTeam("HOU");
  const bills = byTeam("BUF");
  const bears = byTeam("CHI");
  if (!texans || !bills || !bears) throw new Error("Week 11 is missing a Texans, Bills, or Bears game");
  await rpc("admin_override_game", {
    p_admin_token: tokens.admin,
    p_game_id: bills.id,
    p_note: "Bills win for the wrong-pick card",
    p_patch: { status: "final", is_tie: false, winner_team_id: "BUF" },
  });
  await rpc("admin_override_game", {
    p_admin_token: tokens.admin,
    p_game_id: bears.id,
    p_note: "Bears tie for the tie card",
    p_patch: { status: "final", is_tie: true },
  });
  await page.goto("/#/");
  await page.reload();
  const right = page.getByTestId(`pick-${texans.slot}-HOU`);
  const wrong = page.getByTestId(`pick-${bills.slot}-MIA`);
  const billsCard = page.getByTestId(`pick-${bills.slot}-BUF`);
  const tie = page.getByTestId(`pick-${bears.slot}-CHI`);
  await expect(right).toHaveClass(/right/);
  await expect(right).toContainText("Right");
  await expect(right).not.toContainText("Your pick");
  await expect(wrong).toHaveClass(/wrong/);
  await expect(wrong).toContainText("Wrong");
  await expect(wrong).not.toContainText("Your pick");
  await expect(billsCard).toHaveClass(/winner/);
  await expect(billsCard).not.toHaveClass(/right/);
  await expect(billsCard).toContainText("W");
  await expect(tie).toHaveClass(/tie/);
  await expect(tie).toContainText("Tie");
  await shotCard(page, texans.slot, "phone-pick-right");
  await shotCard(page, bills.slot, "phone-pick-wrong");
  await shotCard(page, bears.slot, "phone-pick-tie");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const openBadge = page.locator(".pick-badge", { hasText: "Your pick" }).first();
  await expect(openBadge).toBeVisible();
  const badgeBox = await openBadge.boundingBox();
  expect(badgeBox && badgeBox.height).toBeLessThan(28);
  await shotCard(page, texans.slot, "desktop-pick-right");
  await shotCard(page, bills.slot, "desktop-pick-wrong");
  await shotCard(page, bears.slot, "desktop-pick-tie");
  await page.setViewportSize({ width: 390, height: 844 });

  const fresh = await rpc("bootstrap", { p_player_token: tokens["Chelsea Jess"], p_admin_token: tokens.admin });
  for (const game of fresh.games) {
    if (game.status === "final" || game.status === "excluded") continue;
    await rpc("admin_override_game", {
      p_admin_token: tokens.admin,
      p_game_id: game.id,
      p_note: "Finish the week for the test",
      p_patch: {
        status: "final",
        is_tie: false,
        winner_team_id: game.home.id,
        ...(game.is_mnf ? { mnf_total: 44 } : {}),
      },
    });
  }
  await page.goto("/#/");
  await page.reload();
  await expect(page.getByTestId("week-winner")).toBeVisible();
  await shot(page, "phone-week-winner");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/standings");
  await expect(page.getByTestId("standings")).toBeVisible();
  await shot(page, "desktop-standings");
  await page.goto("/#/");
  await shot(page, "desktop-week");
  await page.goto("/#/history/10");
  await expect(page.getByTestId("pick-grid")).toBeVisible();
  await shot(page, "desktop-history");

  await page.setViewportSize({ width: 390, height: 844 });
  await rpc("admin_set_clock", { p_admin_token: tokens.admin, p_at: "2026-10-31T20:00:00Z" });
  await page.goto("/#/");
  await page.reload();
  await expect(page.getByTestId("theme-name")).toHaveText("HALLOWEEN WEEK");
  await shot(page, "phone-halloween");
  await rpc("admin_set_clock", { p_admin_token: tokens.admin, p_at: "2026-12-25T20:00:00Z" });
  await page.reload();
  await expect(page.getByTestId("theme-name")).toHaveText("CHRISTMAS WEEK");
  await shot(page, "phone-christmas");

  await rpc("admin_set_clock", { p_admin_token: tokens.admin, p_at: null });
  await page.goto("/#/admin");
  await page.getByTestId("admin-note").fill("Start the next season");
  await page.getByTestId("new-season-year").fill("2027");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("start-season").click();
  await expect(page.getByTestId("admin-message")).toHaveText("Saved");
  await page.goto("/#/seasons");
  await expect(page.getByTestId("seasons")).toContainText("2026");
  await expect(page.getByTestId("seasons")).toContainText("archived");
  await expect(page.getByTestId("all-time")).toBeVisible();
  await shot(page, "phone-seasons");
});
