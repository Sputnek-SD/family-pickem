import { displayName } from "../lib/names";
import type { Boot } from "../lib/types";
import { Crown } from "../widgets";

export function SeasonsScreen({ boot }: { boot: Boot }) {
  const seasons = boot.seasons ?? [];
  return (
    <div className="screen" data-testid="seasons">
      <header className="hero compact">
        <p className="kicker">Archive</p>
        <h1>Seasons</h1>
      </header>
      {seasons.map((season) => (
        <section className="panel" key={season.id}>
          <h2>
            {season.year} {season.status === "active" ? "· this season" : "· archived"}
          </h2>
          {season.status === "archived" && season.champions.length > 0 && (
            <p>
              <Crown size={16} /> Champion{season.champions.length > 1 ? "s" : ""}:{" "}
              {season.champions.map((player) => `${displayName(player, season.champions)} (${player.total})`).join(", ")}
            </p>
          )}
          {season.status === "active" && <p>The season champion is named when Brad starts the next season.</p>}
        </section>
      ))}
      {!boot.all_time && <p className="lede">All-time records show up once a second season is on the books.</p>}
      {boot.all_time && (
        <section className="panel" data-testid="all-time">
          <h2>All-time</h2>
          <Record title="Titles" rows={boot.all_time.titles.map((row) => `${row.full_name} · ${row.titles}`)} />
          <Record title="Best season" rows={boot.all_time.best_season.map((row) => `${row.full_name} · ${row.total} in ${row.year}`)} />
          <Record title="Weekly wins" rows={boot.all_time.weekly_wins.map((row) => `${row.full_name} · ${row.wins}`)} />
          <Record title="Best week" rows={boot.all_time.best_week.map((row) => `${row.full_name} · ${row.score} in ${row.year} ${row.label}`)} />
        </section>
      )}
    </div>
  );
}

function Record({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? <p>None yet.</p> : rows.map((row) => <p key={row}>{row}</p>)}
    </div>
  );
}
