import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHABLE_KEY, callerAllowed } from "../../supabase/functions/_shared/sync-auth.ts";

describe("score sync caller", () => {
  it("accepts the public publishable key and rejects anything else", () => {
    expect(callerAllowed(PUBLISHABLE_KEY, null)).toBe(true);
    expect(callerAllowed(null, `Bearer ${PUBLISHABLE_KEY}`)).toBe(true);
    expect(callerAllowed("sb_secret_nope", null)).toBe(false);
    expect(callerAllowed(null, null)).toBe(false);
    expect(callerAllowed("local-key", null, ["local-key"])).toBe(true);
  });

  it("schedules ESPN with the public URL and publishable key, not a secret", () => {
    const sql = readFileSync("supabase/migrations/20261121002632_schedule.sql", "utf8");
    expect(sql).toContain("https://yqbepfcgyzrvsicvxukb.supabase.co/functions/v1/sync-nfl");
    expect(sql).toContain(PUBLISHABLE_KEY);
    expect(sql).not.toContain("secret_key");
    expect(sql).not.toContain("vault.");
  });
});
