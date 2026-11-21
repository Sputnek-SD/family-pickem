import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildImportSql } from "../../scripts/lib/importSql.ts";
import { loadExport } from "../../scripts/lib/parseExport.ts";

describe("offline SQL", () => {
  it("prints a 2026 import that ends in a sheet check and has no secrets", () => {
    const sql = buildImportSql(loadExport(path.resolve("data/2026")));
    expect(sql).toContain("private.bypass_lock");
    expect(sql).toContain("Toby Spurlock");
    expect(sql).toContain("private.award_week");
    expect(sql).toContain("no rows means");
    expect(sql).not.toContain("sb_secret");
    expect(sql).not.toContain("service_role");
    expect(sql).not.toMatch(/postgresql:\/\//);
  });

  it("writes links to a file and hashes to SQL, and prints only the paths", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pickem-tokens-"));
    const links = path.join(dir, "links.txt");
    const hashes = path.join(dir, "hashes.sql");
    const stdout = execFileSync(path.resolve("node_modules/.bin/tsx"), ["scripts/tokens-sql.ts"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        APP_URL: "https://example.test/pickem",
        LINKS_FILE: links,
        TOKENS_SQL: hashes,
      },
      encoding: "utf8",
    });
    expect(stdout.trim().split("\n")).toEqual([links, hashes]);
    expect(stdout).not.toContain("#/p/");
    expect(stdout).not.toContain("#/a/");

    const linkText = readFileSync(links, "utf8");
    const sql = readFileSync(hashes, "utf8");
    const playerLink = linkText.match(/https:\/\/example\.test\/pickem\/#\/p\/([A-Za-z0-9_-]+)/);
    const adminLink = linkText.match(/https:\/\/example\.test\/pickem\/#\/a\/([A-Za-z0-9_-]+)/);
    expect(playerLink).toBeTruthy();
    expect(adminLink).toBeTruthy();
    expect(sql).not.toContain(playerLink![1]);
    expect(sql).not.toContain(adminLink![1]);
    expect(sql).toContain("token_hash");
    expect(sql).toContain("Brad Lipetzky");
    expect(sql).toMatch(/token_hash = '[0-9a-f]{64}'/);
  });
});
