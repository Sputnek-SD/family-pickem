import { useEffect, useState } from "react";
import { weekBoard } from "../lib/api";
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

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    weekBoard(tokens.player, tokens.admin, id)
      .then((next) => {
        if (!cancel) setBoard(next);
      })
      .catch((reason) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load picks");
      });
    return () => {
      cancel = true;
    };
  }, [id, tokens.player, tokens.admin]);

  const weeks = boot.weeks.filter((week) => week.released);
  const winners = board?.rows.filter((row) => row.winner) ?? [];

  return (
    <div className="screen">
      <header className="hero compact">
        <p className="kicker">Who picked who</p>
        <h1>{board?.week.label ?? "Picks"}</h1>
      </header>
      {onWeek && (
        <div className="chips">
          {weeks.map((week) => (
            <button
              key={week.id}
              type="button"
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
        <div className="winner-banner" data-testid="week-winner">
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
        <p className="lede center">Monday total was {board.week.mnf_total}. The guess column is each player’s number.</p>
      )}
    </div>
  );
}
