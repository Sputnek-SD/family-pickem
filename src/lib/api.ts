import { createClient } from "@supabase/supabase-js";
import { safeAuthStorage, safeGetItem, safeRemoveItem, safeSetItem } from "./storage";
import type { Board, Boot, PlayerPage } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storage: safeAuthStorage,
  },
});

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*ERROR:\s*/, "").split("\n")[0]);
  return data as T;
}

export const PLAYER_KEY = "pickem.playerToken";
export const ADMIN_KEY = "pickem.adminToken";

export function readTokens(): { player: string; admin: string } {
  return {
    player: safeGetItem(PLAYER_KEY) ?? "",
    admin: safeGetItem(ADMIN_KEY) ?? "",
  };
}

export function writeToken(kind: "player" | "admin", token: string) {
  safeSetItem(kind === "player" ? PLAYER_KEY : ADMIN_KEY, token);
}

export function clearToken(kind: "player" | "admin") {
  safeRemoveItem(kind === "player" ? PLAYER_KEY : ADMIN_KEY);
}

export function bootstrap(player: string, admin: string) {
  return call<Boot>("bootstrap", {
    p_player_token: player || null,
    p_admin_token: admin || null,
  });
}

export function savePicks(player: string, weekId: string, picks: Record<string, string>, guess: number | null) {
  return call<{ ok: boolean }>("save_picks", {
    p_player_token: player,
    p_week_id: weekId,
    p_picks: Object.entries(picks).map(([game_id, team_id]) => ({ game_id, team_id })),
    p_mnf_guess: guess,
  });
}

export function weekBoard(player: string, admin: string, weekId: string) {
  return call<Board>("week_board", {
    p_player_token: player || null,
    p_admin_token: admin || null,
    p_week_id: weekId,
  });
}

export function playerPage(player: string, admin: string, playerId: string, seasonId: string | null) {
  return call<PlayerPage>("player_page", {
    p_player_token: player || null,
    p_admin_token: admin || null,
    p_player_id: playerId,
    p_season_id: seasonId,
  });
}

export function adminOverride(admin: string, gameId: string, patch: Record<string, unknown>, note: string) {
  return call("admin_override_game", {
    p_admin_token: admin,
    p_game_id: gameId,
    p_patch: patch,
    p_note: note,
  });
}

export function adminEntries(admin: string, weekId: string) {
  return call<
    { player_id: string; full_name: string; first_name: string; last_name: string; guess: number | null; picks: Record<string, string> }[]
  >("admin_entries", { p_admin_token: admin, p_week_id: weekId });
}

export function adminFixPick(
  admin: string,
  playerId: string,
  weekId: string,
  picks: Record<string, string>,
  guess: number | null,
  note: string,
) {
  return call("admin_fix_pick", {
    p_admin_token: admin,
    p_player_id: playerId,
    p_week_id: weekId,
    p_picks: Object.entries(picks).map(([game_id, team_id]) => ({ game_id, team_id })),
    p_mnf_guess: guess,
    p_note: note,
  });
}

export function adminUpsertPlayer(admin: string, patch: Record<string, unknown>, note: string) {
  return call("admin_upsert_player", { p_admin_token: admin, p_patch: patch, p_note: note });
}

export function adminSetLock(admin: string, mode: string, time: string, weekday: number, note: string) {
  return call("admin_set_lock", {
    p_admin_token: admin,
    p_mode: mode,
    p_time: time,
    p_weekday: weekday,
    p_note: note,
  });
}

export function adminStartSeason(admin: string, year: number, name: string, note: string) {
  return call("admin_start_season", {
    p_admin_token: admin,
    p_year: year,
    p_name: name,
    p_note: note,
  });
}

export function adminAudit(admin: string) {
  return call<{ id: number; at: string; action: string; note: string }[]>("admin_audit", {
    p_admin_token: admin,
  });
}
