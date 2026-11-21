export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export type Ranked<T> = T & { rank: number; tied: boolean; place: string };

/** Competition ranking. Ties share a place and get a TIED tag. Never "T1". */
export function rankBy<T>(
  rows: T[],
  scoreOf: (row: T) => number,
  nameOf: (row: T) => string,
): Ranked<T>[] {
  const sorted = [...rows].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || nameOf(a).localeCompare(nameOf(b)),
  );
  return sorted.map((row, index) => {
    let rank = index + 1;
    for (let i = index - 1; i >= 0; i--) {
      if (scoreOf(sorted[i]) === scoreOf(row)) rank = i + 1;
      else break;
    }
    const tied = sorted.filter((other) => scoreOf(other) === scoreOf(row)).length > 1;
    return { ...row, rank, tied, place: ordinal(rank) };
  });
}

export function rankByTotal<T extends { total: number; full_name: string }>(rows: T[]): Ranked<T>[] {
  return rankBy(rows, (row) => row.total, (row) => row.full_name);
}
