import { useEffect, useState } from "react";
import { playerPage } from "../lib/api";
import type { Boot, PlayerPage } from "../lib/types";
import { Crown } from "../widgets";

export function PlayerScreen({
  boot,
  tokens,
  playerId,
}: {
  boot: Boot;
  tokens: { player: string; admin: string };
  playerId: string;
}) {
  const [page, setPage] = useState<PlayerPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    playerPage(tokens.player, tokens.admin, playerId, boot.season?.id ?? null)
      .then((next) => {
        if (!cancel) setPage(next);
      })
      .catch((reason) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load");
      });
    return () => {
      cancel = true;
    };
  }, [playerId, tokens.player, tokens.admin, boot.season?.id]);

  if (error) return <p className="save error">{error}</p>;
  if (!page) return <p className="lede">Loading…</p>;

  const scored = page.weeks.filter((week) => week.score != null);
  const best = scored.reduce<(typeof scored)[number] | null>(
    (top, week) => (top == null || (week.score ?? 0) > (top.score ?? 0) ? week : top),
    null,
  );
  const max = Math.max(1, ...scored.map((week) => week.score ?? 0));
  const points = scored.map((week, index) => {
    const x = scored.length === 1 ? 50 : (index / (scored.length - 1)) * 100;
    const y = 100 - ((week.score ?? 0) / max) * 80 - 8;
    return `${x},${y}`;
  });

  return (
    <div className="screen" data-testid="player-page">
      <header className="hero compact">
        <p className="kicker">{boot.season?.year}</p>
        <h1>{page.player.full_name}</h1>
        <p className="lede">
          {page.total} correct · {page.wins} weekly {page.wins === 1 ? "win" : "wins"}
          {best ? ` · best week ${best.label} (${best.score})` : ""}
        </p>
      </header>
      {points.length > 1 && (
        <svg className="chart" viewBox="0 0 100 100" role="img" aria-label="Score trend">
          <polyline fill="none" stroke="currentColor" strokeWidth="2.5" points={points.join(" ")} />
        </svg>
      )}
      <ol className="weeks">
        {page.weeks.map((week) => (
          <li key={week.week_id}>
            <span>
              {week.label}
              {week.winner && <Crown size={14} />}
            </span>
            <b>{!week.entered ? "—" : week.score == null ? "…" : week.score}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
