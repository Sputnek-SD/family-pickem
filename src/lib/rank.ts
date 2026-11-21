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

/** Competition ranking by season total. Ties share a place and are flagged. Never "T1". */
export function rankByTotal<T extends { total: number; full_name: string }>(rows: T[]): Ranked<T>[] {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || a.full_name.localeCompare(b.full_name),
  );
  return sorted.map((row, index) => {
    let rank = index + 1;
    for (let i = index - 1; i >= 0; i--) {
      if (sorted[i].total === row.total) rank = i + 1;
      else break;
    }
    const tied = sorted.filter((other) => other.total === row.total).length > 1;
    return { ...row, rank, tied, place: ordinal(rank) };
  });
}
