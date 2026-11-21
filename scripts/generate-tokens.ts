/**
 * Print each player's private link, and Brad's admin link.
 * Tokens are stored only as hashes. Nothing here is written into git.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   APP_URL=https://your-name.github.io/family-pickem \
 *   npm run tokens
 *
 * Add --rotate to replace links that already exist.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";

function token() {
  return randomBytes(32).toString("base64url");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL to the Postgres connection string.");
  const appUrl = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
  const rotate = process.argv.includes("--rotate");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const lines: string[] = [];
  const local: Record<string, string> = {};
  try {
    const players = await client.query(
      `select id, full_name, token_hash from private.players order by full_name`,
    );
    for (const player of players.rows) {
      if (player.token_hash && !rotate) continue;
      const value = token();
      await client.query("update private.players set token_hash = $1 where id = $2", [
        hash(value),
        player.id,
      ]);
      const link = `${appUrl}/#/p/${value}`;
      lines.push(`${player.full_name}\n${link}`);
      local[player.full_name] = value;
    }

    const admin = await client.query(
      "select token_hash from private.secrets where name = 'admin'",
    );
    if (!admin.rows[0]?.token_hash || rotate) {
      const value = token();
      await client.query("update private.secrets set token_hash = $1 where name = 'admin'", [
        hash(value),
      ]);
      lines.push(`ADMIN (Brad)\n${appUrl}/#/a/${value}`);
      local.admin = value;
    }

    if (!lines.length) {
      console.log("Everyone already has a link. Run with --rotate to make new ones.");
      return;
    }
    console.log("Give each person only their own link. Do not commit this output.\n");
    console.log(lines.join("\n\n"));
    if (process.argv.includes("--write-local")) {
      writeFileSync(".tokens.local.json", JSON.stringify(local, null, 2));
      console.log("\nAlso wrote .tokens.local.json for the local tests. It is gitignored.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
