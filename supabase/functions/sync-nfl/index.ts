import { withSupabase } from "npm:@supabase/server@1";
import { normalizeScoreboard, scoreboardUrl, type NormalizedBoard } from "../_shared/espn.ts";

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

export default {
  fetch: withSupabase({ auth: "secret" }, async (_req, ctx) => {
    const applied: unknown[] = [];
    const errors: string[] = [];
    try {
      const planResult = await ctx.supabaseAdmin.rpc("sync_plan");
      if (planResult.error) throw new Error(planResult.error.message);
      const plan = planResult.data as {
        fetch_default?: boolean;
        season_year?: number;
        weeks?: { season_type: number; week: number }[];
      };

      const jobs: Promise<NormalizedBoard | null>[] = [];
      if (plan.fetch_default || !plan.weeks?.length) {
        jobs.push(fetchBoard(scoreboardUrl()));
      }
      for (const week of plan.weeks ?? []) {
        jobs.push(fetchBoard(scoreboardUrl(plan.season_year, week.season_type, week.week)));
      }

      const boards = await Promise.allSettled(jobs);
      for (const board of boards) {
        if (board.status === "rejected") {
          errors.push(String(board.reason?.message ?? board.reason));
          continue;
        }
        if (!board.value || board.value.events.length === 0) continue;
        const saved = await ctx.supabaseAdmin.rpc("apply_scoreboard", { p_payload: board.value });
        if (saved.error) errors.push(saved.error.message);
        else applied.push(saved.data);
      }

      const ok = errors.length === 0;
      await ctx.supabaseAdmin.rpc("log_sync", {
        p_detail: { ok, applied: applied.length, errors },
      });
      return Response.json({ ok, applied, errors }, { status: ok ? 200 : 502 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.supabaseAdmin.rpc("log_sync", { p_detail: { ok: false, errors: [message] } }).catch(() => {});
      return Response.json({ ok: false, error: message, applied }, { status: 502 });
    }
  }),
};
