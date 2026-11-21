import { useEffect, useState, type CSSProperties } from "react";
import { displayName, type Named } from "./lib/names";
import { rankBy } from "./lib/rank";
import { helmetUrl } from "./lib/teams";
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
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!show || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOn(false);
      return;
    }
    setOn(true);
    const timer = window.setTimeout(() => setOn(false), 900);
    return () => window.clearTimeout(timer);
  }, [show]);
  if (!on) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 7 }, (_, piece) => (
        <i key={piece} style={{ "--i": piece } as CSSProperties} />
      ))}
    </div>
  );
}

export function Helmet({ id, width = 40, lazy = false }: { id: string; width?: number; lazy?: boolean }) {
  const height = Math.round(width / 0.9);
  return (
    <span className="helmet" style={{ "--helmet-w": `${width}px` } as CSSProperties}>
      <img
        src={helmetUrl(id)}
        alt=""
        width={width}
        height={height}
        loading={lazy ? "lazy" : "eager"}
        decoding="async"
      />
    </span>
  );
}

export function TeamFace({ team, selected }: { team: Game["away"]; selected?: boolean }) {
  const color = readableTeamColor(team.color);
  return (
    <span className={selected ? "face on" : "face"} style={{ "--team": color } as CSSProperties}>
      <Helmet id={team.id} width={36} />
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
  const ranked = rankBy(
    board.rows.filter((row) => row.correct != null),
    (row) => row.correct ?? 0,
    (row) => row.full_name,
  );
  const placeOf = new Map(ranked.map((row) => [row.player_id, row]));
  const ordered = [
    ...ranked,
    ...board.rows.filter((row) => row.correct == null),
  ];
  const columns = { "--games": games.length } as CSSProperties;
  return (
    <div className="grid-scroll">
      <p className="scroll-hint">Scroll sideways for every game and the Monday guess.</p>
      <div className="gridwrap" data-testid="pick-grid">
        <div className="gridrow head" style={columns}>
          <div className="sticky">Player</div>
          {games.map((game) => (
            <div key={game.id} className="gh" title={`${game.away.name} at ${game.home.name}`}>
              <Helmet id={game.away.id} width={28} lazy />
              <b>{game.away.id}</b>
              <span>@ {game.home.id}</span>
              {game.status === "final" && game.is_tie && <em className="tied-pill">TIE</em>}
            </div>
          ))}
          <div className="gh mnf">
            <b>MNF</b>
            <span>{board.week.mnf_total ?? "—"}</span>
          </div>
        </div>
        {ordered.map((row) => {
          const place = placeOf.get(row.player_id);
          return (
            <div className={row.player_id === meId ? "gridrow me" : "gridrow"} style={columns} key={row.player_id}>
              <div className="sticky">
                <span className="who-rank">
                  {place ? place.place : ""}
                  {place?.tied && <em className="tied-pill">TIED</em>}
                  {row.winner && <Crown size={12} />}
                </span>
                <span className="who-name">{displayName(row, board.rows)}</span>
                <b className="who-pts">{row.correct ?? "–"}</b>
              </div>
              {games.map((game) => {
                const pick = row.picks[game.id];
                const team = pick === game.away.id ? game.away : pick === game.home.id ? game.home : null;
                let mark = "pending";
                if (game.status === "final" && game.is_tie) mark = "tie";
                else if (game.status === "final" && pick && pick === game.winner_team_id) mark = "good";
                else if (game.status === "final" && pick) mark = "bad";
                const color = team ? readableTeamColor(team.color) : "transparent";
                return (
                  <div key={game.id} className={`cell ${mark}`} style={{ "--pick": color } as CSSProperties}>
                    {team ? <Helmet id={team.id} width={22} lazy /> : null}
                    <span>{team ? team.id : "–"}</span>
                  </div>
                );
              })}
              <div className="cell guess">{row.guess ?? "–"}</div>
            </div>
          );
        })}
      </div>
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
