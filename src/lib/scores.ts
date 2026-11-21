/** Pregame ESPN zeroes are not a score. Show numbers only once the game has started. */
export function showScore(status: string): boolean {
  return status === "in_progress" || status === "final";
}
