import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeScoreboard, scoreboardUrl, type NormalizedBoard } from "../_shared/espn.ts";
import { callerAllowed } from "../_shared/sync-auth.ts";

async function fetchBoard(url: string): Promise<NormalizedBoard | null> {
  let last = "ESPN did not respond";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "family-pickem" },
      });
      if (!response.ok) throw new Error(`ESPN ${response.status}`);
      const board = normalizeScoreboard(await response.json());
      if (!board) throw new Error("ESPN payload was not a scoreboard");
      return board;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(last);
}

function extraPublishableKeys(): string[] {
  const many = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (many) {
    try {
      const parsed = JSON.parse(many) as Record<string, string>;
      return Object.values(parsed).filter((value) => typeof value === "string");
    } catch {
      return [];
    }
  }
  const single = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  return single ? [single] : [];
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Supabase did not inject SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (!callerAllowed(req.headers.get("apikey"), req.headers.get("authorization"), extraPublishableKeys())) {
      return Response.json({ ok: false, error: "Publishable key required" }, { status: 401 });
    }

    const db = adminClient();
    const claimed = await db.rpc("claim_sync");
    if (claimed.error) {
      return Response.json({ ok: false, error: claimed.error.message }, { status: 500 });
    }
    if (claimed.data !== true) {
      return Response.json({ ok: true, skipped: "rate_limit" });
    }

    const applied: unknown[] = [];
    const errors: string[] = [];
    try {
      const planResult = await db.rpc("sync_plan");
      if (planResult.error) throw new Error(planResult.error.message);
      const plan = planResult.data as {
        fetch_default?: boolean;
        season_year?: number;
        weeks?: { season_type: number; week: number }[];
      };

      const jobs: Promise<NormalizedBoard | null>[] = [];
      if (plan.fetch_default || !plan.weeks?.length) jobs.push(fetchBoard(scoreboardUrl()));
      for (const week of plan.weeks ?? []) {
        jobs.push(fetchBoard(scoreboardUrl(plan.season_year, week.season_type, week.week)));
      }

      const boards = await Promise.allSettled(jobs);
      for (const board of boards) {
        if (board.status === "rejected") {
          errors.push(board.reason instanceof Error ? board.reason.message : String(board.reason));
          continue;
        }
        if (!board.value || board.value.events.length === 0) continue;
        const saved = await db.rpc("apply_scoreboard", { p_payload: board.value });
        if (saved.error) errors.push(saved.error.message);
        else applied.push(saved.data);
      }

      const ok = errors.length === 0;
      await db.rpc("log_sync", { p_detail: { ok, applied: applied.length, errors } });
      return Response.json({ ok, applied, errors }, { status: ok ? 200 : 502 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.rpc("log_sync", { p_detail: { ok: false, errors: [message] } }).catch(() => undefined);
      return Response.json({ ok: false, error: message, applied }, { status: 502 });
    }
  },
};
