import type { CSSProperties } from "react";
import { displayName, type Named } from "./lib/names";
import { readableTeamColor } from "./lib/theme";
import type { Board, Game, Person } from "./lib/types";

export function Crown({ size = 18 }: { size?: number }) {
  return (
    <svg className="crown" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 17.2 4.8 8.2l4.4 4.2L12 5l2.8 7.4 4.4-4.2L21 17.2H3Zm0 2.1h18v2.2H3v-2.2Z" />
    </svg>
  );
}

export function Confetti({ show }: { show: boolean }) {
  if (!show || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const pieces = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <i key={piece} style={{ "--i": piece } as CSSProperties} />
      ))}
    </div>
  );
}

export function TeamFace({ team, selected }: { team: Game["away"]; selected?: boolean }) {
  const color = readableTeamColor(team.color);
  return (
    <span className={selected ? "face on" : "face"} style={{ "--team": color } as CSSProperties}>
      <img src={team.logo} alt="" width={36} height={36} />
    </span>
  );
}

export function statusLabel(game: Game): string {
  if (game.status === "excluded") return "Excluded";
  if (game.status === "postponed") return "Postponed";
  if (game.status === "in_progress") return "Live";
  if (game.status === "final") return game.is_tie ? "Tie" : "Final";
  return "Upcoming";
}

export function PickGrid({ board, meId }: { board: Board; meId?: string }) {
  if (!board.week.visible) {
    return (
      <section className="panel">
        <h2>Picks are still private</h2>
        <p>Everyone’s picks show up together once the pool locks. You can still see your own on This week.</p>
        {board.missing.length > 0 && <Missing people={board.missing} />}
      </section>
    );
  }
  const games = board.games.filter((game) => game.status !== "excluded");
  const cols = `132px repeat(${games.length + 1}, 76px)`;
  return (
    <div className="gridwrap" data-testid="pick-grid">
      <div className="gridrow head" style={{ gridTemplateColumns: cols }}>
        <div className="sticky">Player</div>
        {games.map((game) => (
          <div key={game.id} className="gh" title={`${game.away.name} at ${game.home.name}`}>
            <b>{game.away.id}</b>
            <span>{game.home.id}</span>
          </div>
        ))}
        <div className="gh">
          <b>MNF</b>
          <span>{board.week.mnf_total ?? "—"}</span>
        </div>
      </div>
      {board.rows.map((row) => (
        <div
          className={row.player_id === meId ? "gridrow me" : "gridrow"}
          style={{ gridTemplateColumns: cols }}
          key={row.player_id}
        >
          <div className="sticky">
            {displayName(row, board.rows)}
            {row.winner && <Crown size={14} />}
          </div>
          {games.map((game) => {
            const pick = row.picks[game.id];
            const team = pick === game.away.id ? game.away : pick === game.home.id ? game.home : null;
            let mark = "";
            if (game.status === "final" && game.is_tie) mark = "tie";
            else if (game.status === "final" && pick && pick === game.winner_team_id) mark = "good";
            else if (game.status === "final" && pick) mark = "bad";
            return (
              <div key={game.id} className={`cell ${mark}`}>
                {team ? team.id : "–"}
              </div>
            );
          })}
          <div className="cell">{row.guess ?? "–"}</div>
        </div>
      ))}
    </div>
  );
}

export function Missing({ people }: { people: Person[] }) {
  if (!people.length) return null;
  const names = people.map((person) => displayName(person, people));
  return (
    <p className="missing" data-testid="missing">
      Still need picks: {names.join(", ")}
    </p>
  );
}

export function namesOf(people: Named[]): string {
  return people.map((person) => displayName(person, people)).join(", ");
}
