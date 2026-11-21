import { useCallback, useEffect, useRef, useState } from "react";
import { weekBoard } from "../lib/api";
import { useLiveRefresh } from "../lib/liveRefresh";
import { displayName } from "../lib/names";
import type { Board, Boot } from "../lib/types";
import { Confetti, Crown, PickGrid } from "../widgets";

export function BoardScreen({
  boot,
  tokens,
  weekId,
  onWeek,
}: {
  boot: Boot;
  tokens: { player: string; admin: string };
  weekId?: string;
  onWeek?: (id: string) => void;
}) {
  const id = weekId || boot.current_week_id;
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const ticket = useRef(0);

  const loadBoard = useCallback(async () => {
    if (!id) return;
    const mine = ++ticket.current;
    try {
      const next = await weekBoard(tokens.player, tokens.admin, id);
      if (mine === ticket.current) {
        setBoard(next);
        setError("");
      }
    } catch (reason) {
      if (mine === ticket.current) setError(reason instanceof Error ? reason.message : "Could not load picks");
    }
  }, [id, tokens.player, tokens.admin]);

  useEffect(() => {
    loadBoard().catch(() => undefined);
  }, [loadBoard]);

  const weeks = (boot.weeks ?? []).filter((week) => week.released);
  const current = (boot.weeks ?? []).find((week) => week.id === boot.current_week_id);
  useLiveRefresh(loadBoard, !!current && !current.complete && id === current.id);
  const winners = board?.rows.filter((row) => row.winner) ?? [];
  const activeChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeChip.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [id, weeks.length]);

  return (
    <div className="screen">
      <header className="hero compact poster">
        <p className="kicker">Who picked who</p>
        <h1>{board?.week.label ?? "Picks"}</h1>
      </header>
      {onWeek && (
        <div className="chips">
          {weeks.map((week) => (
            <button
              key={week.id}
              type="button"
              ref={week.id === id ? activeChip : undefined}
              className={week.id === id ? "chip on" : "chip"}
              data-testid={`history-${week.week_number}`}
              onClick={() => onWeek(week.id)}
            >
              {week.week_number}
            </button>
          ))}
        </div>
      )}
      {winners.length > 0 && (
        <div className="winner-banner poster" data-testid="week-winner">
          <Confetti show />
          <Crown />
          <div>
            <p>Weekly winner</p>
            <strong>{winners.map((row) => displayName(row, winners)).join(" & ")}</strong>
          </div>
        </div>
      )}
      {error && <p className="save error">{error}</p>}
      {board && <PickGrid board={board} meId={boot.me?.player_id} />}
      {board?.week.mnf_total != null && board.week.visible && (
        <p className="lede center">
          MNF = each player’s Monday-night total guess. Actual: {board.week.mnf_total}.
        </p>
      )}
    </div>
  );
}
