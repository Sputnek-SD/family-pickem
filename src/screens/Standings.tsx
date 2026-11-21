import { displayName } from "../lib/names";
import { rankByTotal } from "../lib/rank";
import type { Boot } from "../lib/types";
import { Crown } from "../widgets";

export function StandingsScreen({ boot, onOpen }: { boot: Boot; onOpen: (id: string) => void }) {
  const ranked = rankByTotal(boot.standings);
  const latest = [...boot.weeks].reverse().find((week) => week.complete && week.winner_ids.length);
  return (
    <div className="screen">
      <header className="hero compact">
        <p className="kicker">Season {boot.season?.year}</p>
        <h1>Standings</h1>
        <p className="lede">One point per correct pick. Ties on the season total stay tied.</p>
      </header>
      <ol className="standings" data-testid="standings">
        {ranked.map((row) => (
          <li key={row.player_id}>
            <button
              type="button"
              className={row.player_id === boot.me?.player_id ? "me" : undefined}
              onClick={() => onOpen(row.player_id)}
              data-testid={`standing-${row.full_name}`}
            >
              <span className="place">
                {row.place}
                {row.tied && <em>TIED</em>}
              </span>
              <span className="who">
                {(row.rank === 1 || latest?.winner_ids.includes(row.player_id)) && <Crown />}
                {displayName(row, ranked)}
              </span>
              <span className="stat">
                <b>{row.total}</b>
                <small>{row.wins} weekly {row.wins === 1 ? "win" : "wins"}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
