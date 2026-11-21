import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const routes = ["/", "/#/p/bogus", "/#/not-a-real-page"];

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

const failures = [];
let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  for (const route of routes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(() => {
      const root = document.getElementById("root");
      const text = root?.innerText?.trim() ?? "";
      const box = root?.getBoundingClientRect();
      return text.length > 0 && !!box && box.height > 20;
    }, undefined, { timeout: 20000 });
    if (problems.length) failures.push(`${route}\n${problems.join("\n")}`);
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
console.log("Smoke passed for a signed-out visitor, a bad token, and an unknown route.");
