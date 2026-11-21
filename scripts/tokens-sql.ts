/**
 * Make private links without a database password.
 * The links go in a local file. The SQL file has only hashes.
 * This command prints the two paths and nothing else.
 *
 *   APP_URL=https://your-pages-site npm run tokens:sql
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ROSTER } from "./lib/roster.ts";

function token() {
  return randomBytes(32).toString("base64url");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
if (!appUrl) {
  process.stderr.write("Set APP_URL to the site address, then run this again.\n");
  process.exit(1);
}

const linksPath = path.resolve(process.env.LINKS_FILE ?? ".tokens.local.txt");
const sqlPath = path.resolve(process.env.TOKENS_SQL ?? "tokens.sql");

const linkLines = [
  "Private links for the family pool. Do not commit this file or paste it into chat.",
  `Site: ${appUrl}`,
  "",
];
const sql = [
  "-- Hashes only. Running this replaces the current links.",
  "begin;",
];

for (const name of ROSTER) {
  const value = token();
  linkLines.push(name);
  linkLines.push(`${appUrl}/#/p/${value}`);
  linkLines.push("");
  sql.push(
    `update private.players set token_hash = ${sqlQuote(hash(value))} where full_name = ${sqlQuote(name)};`,
  );
}

const admin = token();
linkLines.push("ADMIN (Brad)");
linkLines.push(`${appUrl}/#/a/${admin}`);
linkLines.push("");
sql.push(`update private.secrets set token_hash = ${sqlQuote(hash(admin))} where name = 'admin';`);
sql.push("commit;");
sql.push("");

writeFileSync(linksPath, linkLines.join("\n"));
writeFileSync(sqlPath, sql.join("\n"));
process.stdout.write(`${linksPath}\n${sqlPath}\n`);
