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

  const finished = page.weeks.filter((week) => {
    const meta = (boot.weeks ?? []).find((item) => item.id === week.week_id);
    return meta ? meta.complete : week.score != null;
  });
  const scored = finished.filter((week) => week.entered);
  const best = scored.reduce<(typeof scored)[number] | null>(
    (top, week) => (top == null || (week.score ?? 0) > (top.score ?? 0) ? week : top),
    null,
  );
  const max = Math.max(1, ...finished.map((week) => (week.entered ? week.score ?? 0 : 0)));
  const plot = finished.map((week, index) => {
    const x = finished.length === 1 ? 180 : 48 + (index / (finished.length - 1)) * 250;
    const value = week.entered ? week.score ?? 0 : 0;
    const y = 146 - (value / max) * 112;
    return { x, y, label: String(week.week_number), value };
  });

  return (
    <div className="screen" data-testid="player-page">
      <header className="hero compact">
        <p className="kicker">{page.player.full_name} · {boot.season?.year}</p>
        <h1>{page.player.first_name}</h1>
        <p className="lede">
          {page.total} correct · {page.wins} weekly {page.wins === 1 ? "win" : "wins"}
          {best ? ` · best week ${best.label} (${best.score})` : ""}
        </p>
      </header>
      {plot.length > 1 && (
        <svg className="chart" viewBox="0 0 320 180" role="img" aria-label="Score trend for finished weeks">
          <line x1="40" y1="24" x2="40" y2="146" />
          <line x1="40" y1="146" x2="308" y2="146" />
          <text x="6" y="28">{max}</text>
          <text x="6" y="150">0</text>
          <polyline fill="none" stroke="currentColor" strokeWidth="3" points={plot.map((point) => `${point.x},${point.y}`).join(" ")} />
          {plot.map((point) => (
            <g key={point.label}>
              <circle cx={point.x} cy={point.y} r="3.5" />
              <text x={point.x} y="168" textAnchor="middle">{point.label}</text>
            </g>
          ))}
        </svg>
      )}
      {page.weeks.some((week) => (boot.weeks ?? []).find((item) => item.id === week.week_id && !item.complete)) && (
        <p className="fine">The chart skips the week still in progress.</p>
      )}
      <ol className="weeks">
        {page.weeks.map((week) => (
          <li key={week.week_id}>
            <span>
              {week.label}
              {week.winner && <Crown size={14} />}
            </span>
            <b>
              {!week.entered
                ? "—"
                : (boot.weeks ?? []).find((item) => item.id === week.week_id && !item.complete)
                  ? `${week.score ?? 0} so far`
                  : week.score == null
                    ? "…"
                    : week.score}
            </b>
          </li>
        ))}
      </ol>
    </div>
  );
}
