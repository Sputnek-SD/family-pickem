import { useEffect, useState } from "react";
import {
  adminAudit,
  adminEntries,
  adminFixPick,
  adminOverride,
  adminSetLock,
  adminStartSeason,
  adminUpsertPlayer,
} from "../lib/api";
import type { Boot, Game } from "../lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AdminScreen({ boot, admin, onChanged }: { boot: Boot; admin: string; onChanged: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<{ id: number; at: string; action: string; note: string }[]>([]);
  const [mode, setMode] = useState(boot.season?.lock_mode ?? "deadline");
  const [time, setTime] = useState(boot.season?.lock_time ?? "17:10");
  const [weekday, setWeekday] = useState(boot.season?.lock_weekday ?? 4);
  const [year, setYear] = useState(String((boot.season?.year ?? 2026) + 1));
  const [fullName, setFullName] = useState("");
  const [kind, setKind] = useState("occasional");
  const [fixPlayer, setFixPlayer] = useState("");
  const [fixPicks, setFixPicks] = useState<Record<string, string>>({});
  const [fixGuess, setFixGuess] = useState("");
  const [entries, setEntries] = useState<
    { player_id: string; full_name: string; picks: Record<string, string>; guess: number | null }[]
  >([]);

  async function refreshAudit() {
    setAudit(await adminAudit(admin));
  }

  useEffect(() => {
    refreshAudit().catch(() => setAudit([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setMessage("Saved");
      await onChanged();
      await refreshAudit();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That didn’t save");
    }
  }

  const games = boot.games;
  const weekId = boot.current_week_id;

  return (
    <div className="screen" data-testid="admin">
      <header className="hero compact">
        <p className="kicker">Commissioner</p>
        <h1>Admin</h1>
        <p className="lede">Every change asks for a note and is written to the log.</p>
      </header>
      <label className="field">
        Note for the next change
        <input data-testid="admin-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why you’re changing it" />
      </label>
      {message && <p className="save saved" data-testid="admin-message">{message}</p>}

      <section className="panel">
        <h2>This week’s results</h2>
        {games.map((game) => (
          <GameEditor
            key={game.id}
            game={game}
            onSave={(patch) => run(() => adminOverride(admin, game.id, patch, note))}
          />
        ))}
      </section>

      <section className="panel">
        <h2>Fix a pick</h2>
        <button
          type="button"
          className="secondary"
          data-testid="load-entries"
          onClick={() => {
            if (!weekId) return;
            adminEntries(admin, weekId)
              .then((rows) => {
                const first = rows[0];
                setEntries(rows);
                setFixPlayer(first?.player_id ?? "");
                setFixPicks(first?.picks ?? {});
                setFixGuess(first?.guess == null ? "" : String(first.guess));
                setMessage("Loaded this week’s entries");
              })
              .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load entries"));
          }}
        >
          Load entries
        </button>
        <EntryFix
          games={games}
          entries={entries}
          playerId={fixPlayer}
          picks={fixPicks}
          guess={fixGuess}
          onPlayer={(id, picks, guess) => {
            setFixPlayer(id);
            setFixPicks(picks);
            setFixGuess(guess);
          }}
          onPick={(gameId, teamId) => setFixPicks({ ...fixPicks, [gameId]: teamId })}
          onGuess={setFixGuess}
          onSave={() =>
            run(() =>
              adminFixPick(
                admin,
                fixPlayer,
                weekId ?? "",
                fixPicks,
                fixGuess === "" ? null : Number(fixGuess),
                note,
              ),
            )
          }
        />
      </section>

      <section className="panel">
        <h2>Players</h2>
        <ul className="roster">
          {(boot.roster ?? []).map((player) => (
            <li key={player.player_id}>
              <span>
                {player.full_name}
                <small>{player.kind}{player.active ? "" : " · inactive"}</small>
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  run(() =>
                    adminUpsertPlayer(
                      admin,
                      {
                        player_id: player.player_id,
                        full_name: player.full_name,
                        kind: player.kind,
                        active: !player.active,
                      },
                      note || `Set ${player.full_name} ${player.active ? "inactive" : "active"}`,
                    ),
                  )
                }
              >
                {player.active ? "Deactivate" : "Activate"}
              </button>
            </li>
          ))}
        </ul>
        <label className="field">
          Full name
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="First Last" />
        </label>
        <label className="field">
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="regular">Regular</option>
            <option value="occasional">Occasional</option>
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={() =>
            run(async () => {
              await adminUpsertPlayer(admin, { full_name: fullName, kind, active: true }, note);
              setFullName("");
            })
          }
        >
          Add player
        </button>
        <p className="fine">New players still need a private link. Run the token script on your computer and send them only their link.</p>
      </section>

      <section className="panel">
        <h2>Lock</h2>
        <label className="check">
          <input type="radio" name="lock" checked={mode === "deadline"} onChange={() => setMode("deadline")} />
          All games lock at one time
        </label>
        <label className="check">
          <input type="radio" name="lock" checked={mode === "kickoff"} onChange={() => setMode("kickoff")} />
          Each game locks at kickoff
        </label>
        <div className="split">
          <label className="field">
            Day
            <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
              {DAYS.map((day, index) => (
                <option key={day} value={index + 1}>{day}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Time (Pacific)
            <input value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="primary"
          data-testid="save-lock"
          onClick={() => run(() => adminSetLock(admin, mode, time, weekday, note))}
        >
          Save lock rule
        </button>
      </section>

      <section className="panel">
        <h2>New season</h2>
        <p>Keeps the roster, archives this season, and opens an empty one. The score sync fills the new schedule.</p>
        <label className="field">
          Year
          <input data-testid="new-season-year" value={year} onChange={(event) => setYear(event.target.value)} />
        </label>
        <button
          type="button"
          className="primary danger"
          data-testid="start-season"
          onClick={() => {
            const next = Number(year);
            if (!window.confirm(`Archive ${boot.season?.year} and start ${next}? The roster stays.`)) return;
            void run(() => adminStartSeason(admin, next, `${next} season`, note || `Start ${next}`));
          }}
        >
          Start new season
        </button>
      </section>

      <section className="panel">
        <h2>Recent changes</h2>
        <ul className="audit" data-testid="audit">
          {audit.map((row) => (
            <li key={row.id}>
              <b>{row.action}</b> {row.note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GameEditor({ game, onSave }: { game: Game; onSave: (patch: Record<string, unknown>) => void }) {
  const [winner, setWinner] = useState(game.is_tie ? "TIE" : game.winner_team_id ?? "");
  const [status, setStatus] = useState(game.status);
  const [total, setTotal] = useState("");
  return (
    <div className="editor">
      <p>
        {game.away.short_name} at {game.home.short_name}
      </p>
      <div className="split">
        <select aria-label={`Result ${game.away.short_name} at ${game.home.short_name}`} value={winner} onChange={(event) => setWinner(event.target.value)}>
          <option value="">No winner</option>
          <option value={game.away.id}>{game.away.short_name}</option>
          <option value={game.home.id}>{game.home.short_name}</option>
          <option value="TIE">Tie</option>
        </select>
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as Game["status"])}>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">Live</option>
          <option value="final">Final</option>
          <option value="postponed">Postponed</option>
          <option value="excluded">Excluded</option>
        </select>
      </div>
      {game.is_mnf && (
        <input
          aria-label="Monday total"
          placeholder="Monday total"
          value={total}
          onChange={(event) => setTotal(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
        />
      )}
      <button
        type="button"
        className="secondary"
        data-testid={`override-${game.slot}`}
        onClick={() => {
          const tie = winner === "TIE";
          const patch: Record<string, unknown> = {
            status: tie || (winner && status === "scheduled") ? "final" : status,
            is_tie: tie,
            winner_team_id: tie ? "" : winner,
          };
          if (game.is_mnf && total !== "") patch.mnf_total = Number(total);
          onSave(patch);
        }}
      >
        Save result
      </button>
    </div>
  );
}

function EntryFix({
  games,
  entries,
  playerId,
  picks,
  guess,
  onPlayer,
  onPick,
  onGuess,
  onSave,
}: {
  games: Game[];
  entries: { player_id: string; full_name: string; picks: Record<string, string>; guess: number | null }[];
  playerId: string;
  picks: Record<string, string>;
  guess: string;
  onPlayer: (id: string, picks: Record<string, string>, guess: string) => void;
  onPick: (gameId: string, teamId: string) => void;
  onGuess: (value: string) => void;
  onSave: () => void;
}) {
  const rows = entries;
  return (
    <div>
      <label className="field">
        Player
        <select
          data-testid="fix-player"
          value={playerId}
          onChange={(event) => {
            const row = rows.find((item) => item.player_id === event.target.value);
            onPlayer(event.target.value, row?.picks ?? {}, row?.guess == null ? "" : String(row.guess));
          }}
        >
          <option value="">Choose</option>
          {rows.map((row) => (
            <option key={row.player_id} value={row.player_id}>
              {row.full_name}
            </option>
          ))}
        </select>
      </label>
      {games.map((game) => (
        <label className="field" key={game.id}>
          {game.away.short_name} at {game.home.short_name}
          <select value={picks[game.id] ?? ""} onChange={(event) => onPick(game.id, event.target.value)}>
            <option value="">No pick</option>
            <option value={game.away.id}>{game.away.short_name}</option>
            <option value={game.home.id}>{game.home.short_name}</option>
          </select>
        </label>
      ))}
      <label className="field">
        Monday total
        <input value={guess} onChange={(event) => onGuess(event.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
      </label>
      <button type="button" className="primary" data-testid="save-fix" onClick={onSave}>
        Save pick fix
      </button>
    </div>
  );
}
