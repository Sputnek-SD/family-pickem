import { useEffect, useRef, useState, type CSSProperties } from "react";
import { savePicks } from "../lib/api";
import { displayName } from "../lib/names";
import { rankBy } from "../lib/rank";
import { showScore } from "../lib/scores";
import { luminance, readableTeamColor } from "../lib/theme";
import { formatCountdown, formatKickoff } from "../lib/time";
import type { Boot, Game } from "../lib/types";
import { Confetti, Crown, Logo, Missing } from "../widgets";

export function WeekScreen({ boot, token }: { boot: Boot; token: string }) {
  const week = boot.weeks?.find((item) => item.id === boot.current_week_id) ?? null;
  const [picks, setPicks] = useState(boot.my_picks ?? {});
  const [guess, setGuess] = useState(boot.my_guess == null ? "" : String(boot.my_guess));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => new Date(boot.now).getTime());
  const picksRef = useRef(picks);
  const guessRef = useRef<number | null>(boot.my_guess);
  const queue = useRef(Promise.resolve());
  picksRef.current = picks;

  useEffect(() => {
    setPicks(boot.my_picks ?? {});
    picksRef.current = boot.my_picks ?? {};
    setGuess(boot.my_guess == null ? "" : String(boot.my_guess));
    guessRef.current = boot.my_guess;
  }, [boot.current_week_id]);

  useEffect(() => {
    const skew = new Date(boot.now).getTime() - Date.now();
    const timer = window.setInterval(() => setNow(Date.now() + skew), 1000);
    return () => window.clearInterval(timer);
  }, [boot.now]);

  const games = (boot.games ?? []).filter((game) => game.status !== "excluded");
  const picked = games.filter((game) => picks[game.id]).length;
  const guessNumber = guess.trim() === "" ? null : Number(guess);
  const guessOk = guessNumber == null || (Number.isInteger(guessNumber) && guessNumber >= 0 && guessNumber <= 150);
  const poolLocked = week?.lock_at ? now >= new Date(week.lock_at).getTime() : false;
  const remain = week?.lock_at ? new Date(week.lock_at).getTime() - now : 0;
  const winners = (boot.leaderboard ?? []).filter((row) => row.winner);
  const meMissing = !!boot.me && (picked < games.length || guessNumber == null);

  function enqueue(nextPicks: Record<string, string>, nextGuess: number | null) {
    if (!token || !week) return;
    setState("saving");
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await savePicks(token, week.id, nextPicks, nextGuess);
          setState("saved");
          setMessage("Saved");
        } catch (error) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "Could not save");
        }
      });
  }

  function choose(game: Game, teamId: string) {
    if (game.locked || !boot.me) return;
    const next = { ...picksRef.current, [game.id]: teamId };
    picksRef.current = next;
    setPicks(next);
    enqueue(next, guessRef.current);
  }

  return (
    <div className="screen">
      <header className="hero week poster">
        <p className="kicker" data-testid="theme-kicker">
          {boot.season?.year} · {boot.season?.lock_mode === "kickoff" ? "Locks at kickoff" : "Thursday lock"}
        </p>
        <h1 data-testid="week-title">{week?.label ?? "This week"}</h1>
        {week?.lock_at && boot.season?.lock_mode !== "kickoff" && (
          <p className="countdown" data-testid="countdown">
            {poolLocked ? "Locked" : `Locks in ${formatCountdown(remain)}`}
            <span>{formatKickoff(week.lock_at)}</span>
          </p>
        )}
        {boot.season?.lock_mode === "kickoff" && (
          <p className="countdown" data-testid="countdown">
            Each game locks at kickoff
          </p>
        )}
        <div className="progress" data-testid="progress">
          <span>
            {picked} of {games.length} picked
          </span>
          <div className="bar">
            <i style={{ width: games.length ? `${(picked / games.length) * 100}%` : "0%" }} />
          </div>
        </div>
        {meMissing && !poolLocked && (
          <p className="nudge" data-testid="you-need">
            You haven’t finished this week yet.
          </p>
        )}
        <Missing people={boot.missing ?? []} />
        <p className={`save ${state}`} data-testid="saved-state">
          {message}
        </p>
      </header>

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

      {!boot.me && (
        <section className="panel">
          <h2>Open your player link to make picks</h2>
          <p>The admin link can run the pool. Picks use your own private link, and this phone will remember it.</p>
        </section>
      )}

      {boot.leaderboard && boot.leaderboard.length > 0 && poolLocked && (
        <WeekBoard rows={boot.leaderboard} meId={boot.me?.player_id} />
      )}

      <div className="games">
        {games.map((game) => {
          const mine = picks[game.id];
          const decided = game.status === "final";
          return (
            <article key={game.id} className="game" data-testid={`game-${game.slot}`}>
              <header>
                <span>{formatKickoff(game.kickoff)}</span>
                <span className={game.status === "in_progress" ? "live" : ""}>
                  {game.status === "final" && game.is_tie
                    ? "Tie"
                    : game.status === "final"
                      ? "Final"
                      : game.status === "in_progress"
                        ? "Live"
                        : game.locked
                          ? "Locked"
                          : game.is_mnf
                            ? "Monday night"
                            : ""}
                </span>
              </header>
              <div className="match">
                {[game.away, game.home].map((team) => {
                  const selected = mine === team.id;
                  const winner = decided && !game.is_tie && game.winner_team_id === team.id;
                  let result = "";
                  if (selected && decided && game.is_tie) result = " tie";
                  else if (selected && decided && winner) result = " right";
                  else if (selected && decided) result = " wrong";
                  else if (!selected && winner) result = " winner";
                  const raw = team.id === game.away.id ? game.away_score : game.home_score;
                  const score = showScore(game.status) ? raw : null;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      className={`team${selected ? " selected" : ""}${result}`}
                      style={{ "--team": readableTeamColor(team.color), "--ink": luminance(readableTeamColor(team.color)) > 0.45 ? "#16120a" : "#fffaf0" } as CSSProperties}
                      aria-pressed={selected}
                      disabled={game.locked || !boot.me}
                      data-testid={`pick-${game.slot}-${team.id}`}
                      onClick={() => choose(game, team.id)}
                    >
                      <Logo src={team.logo} size={36} />
                      <span className="team-name">
                        <small>{team.location}</small>
                        <strong>{team.short_name}</strong>
                      </span>
                      {!selected && winner && <span className="winner-mark">W</span>}
                      {score != null && <b className="score">{score}</b>}
                      {selected && !decided && <em className="pick-badge">Your pick ✓</em>}
                      {selected && decided && game.is_tie && <em className="pick-badge tie">Tie</em>}
                      {selected && decided && !game.is_tie && winner && <em className="pick-badge right">✓ Right</em>}
                      {selected && decided && !game.is_tie && !winner && <em className="pick-badge wrong">✗ Wrong</em>}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <section className="panel mnf">
        <h2>Monday total</h2>
        <p>Combined points in the Monday night game. 0 to 150. Closest guess breaks a tie for the week.</p>
        <input
          data-testid="mnf-guess"
          inputMode="numeric"
          aria-label="Monday night total"
          value={guess}
          disabled={!boot.me || (boot.season?.lock_mode === "kickoff"
            ? !!(boot.games ?? []).find((game) => game.is_mnf)?.locked
            : poolLocked)}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, "").slice(0, 3);
            setGuess(next);
            guessRef.current = next.trim() === "" ? null : Number(next);
          }}
          onBlur={() => {
            if (!guessOk) {
              setMessage("Monday total must be 0–150");
              setState("error");
              return;
            }
            if (guessNumber !== boot.my_guess) enqueue(picksRef.current, guessNumber);
          }}
        />
      </section>
    </div>
  );
}

function WeekBoard({ rows, meId }: { rows: NonNullable<Boot["leaderboard"]>; meId?: string }) {
  const [open, setOpen] = useState(false);
  const ranked = rankBy(rows, (row) => row.correct, (row) => row.full_name);
  const top = ranked.slice(0, 3);
  const me = ranked.find((row) => row.player_id === meId);
  if (!open) {
    return (
      <div className="strip" data-testid="live-board">
        <div className="strip-top">
          {top.map((row) => (
            <span className="strip-person" key={row.player_id}>
              <b>{row.place}</b>
              {row.tied && <em className="tied-pill">TIED</em>}
              {displayName(row, ranked)}
              <strong>{row.correct}</strong>
            </span>
          ))}
        </div>
        <div className="strip-you">
          {me && (
            <strong className="strip-you-line">
              <span>You: {me.place}</span>
              {me.tied && <em className="tied-pill">TIED</em>}
            </strong>
          )}
          <button type="button" onClick={() => setOpen(true)}>
            See all
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="strip open" data-testid="live-board">
      <ol>
        {ranked.map((row) => (
          <li key={row.player_id} className={row.player_id === meId ? "me" : undefined}>
            <span>
              {row.place}
              {row.tied && <em className="tied-pill">TIED</em>}
              {row.winner && <Crown size={14} />}
              {displayName(row, ranked)}
            </span>
            <b>{row.correct}</b>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setOpen(false)}>
        Show less
      </button>
    </div>
  );
}
