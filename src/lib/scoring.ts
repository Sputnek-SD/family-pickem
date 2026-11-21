/**
 * Pool scoring, matching Brad's sheet.
 *
 * A week is awarded only when every game that counts has a final result
 * (a winner or a tie) and the Monday night total is filled in.
 * High score wins. Ties on score go to the smallest |guess - actual|.
 * If that is still tied, each of those players gets a weekly win.
 * A missed week scores 0 and is not in that week's race.
 * A tie game is a result and nobody gets the point.
 * A game with no result holds the week open.
 * An excluded game is left out of the score and does not hold the week open.
 * Season total is the sum of weekly correct picks. There is no season-total tiebreak.
 */

export type ScoreGame = {
  id: string;
  final: boolean;
  tie: boolean;
  excluded: boolean;
  winner: string | null;
};

export type ScoreEntry = {
  playerId: string;
  entered: boolean;
  picks: Record<string, string | null | undefined>;
  guess: number | null;
};

export type ScoredEntry = {
  playerId: string;
  entered: boolean;
  correct: number;
  diff: number | null;
};

export function weekComplete(games: ScoreGame[], mnfTotal: number | null): boolean {
  const counting = games.filter((game) => !game.excluded);
  if (counting.length === 0 || mnfTotal == null) return false;
  return counting.every((game) => game.final);
}

export function scoreEntry(games: ScoreGame[], entry: ScoreEntry, mnfTotal: number | null): ScoredEntry {
  if (!entry.entered) {
    return { playerId: entry.playerId, entered: false, correct: 0, diff: null };
  }
  let correct = 0;
  for (const game of games) {
    if (!game.final || game.tie || game.excluded || !game.winner) continue;
    if (entry.picks[game.id] === game.winner) correct += 1;
  }
  const diff =
    entry.guess == null || mnfTotal == null ? null : Math.abs(entry.guess - mnfTotal);
  return { playerId: entry.playerId, entered: true, correct, diff };
}

/** Player ids who earn the weekly win. Empty when the week is not complete or nobody is eligible. */
export function weeklyWinners(scored: ScoredEntry[], complete: boolean): string[] {
  if (!complete) return [];
  const field = scored.filter((row) => row.entered);
  if (field.length === 0) return [];
  const high = Math.max(...field.map((row) => row.correct));
  const eligible = field.filter((row) => row.correct === high && row.diff != null);
  if (eligible.length === 0) return [];
  const best = Math.min(...eligible.map((row) => row.diff as number));
  return eligible.filter((row) => row.diff === best).map((row) => row.playerId);
}

export function seasonTotal(weekly: Array<number | null | undefined>): number {
  return weekly.reduce<number>((sum, score) => sum + (score ?? 0), 0);
}

export function highScoreWasTied(scored: ScoredEntry[]): boolean {
  const field = scored.filter((row) => row.entered);
  if (field.length === 0) return false;
  const high = Math.max(...field.map((row) => row.correct));
  return field.filter((row) => row.correct === high).length > 1;
}
