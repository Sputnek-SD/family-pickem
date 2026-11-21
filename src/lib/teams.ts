export type Team = {
  id: string;
  name: string;
  short: string;
  location: string;
  color: string;
};

export const TEAMS: Team[] = [
  { id: "ARI", name: "Arizona Cardinals", short: "Cardinals", location: "Arizona", color: "#97233F" },
  { id: "ATL", name: "Atlanta Falcons", short: "Falcons", location: "Atlanta", color: "#A71930" },
  { id: "BAL", name: "Baltimore Ravens", short: "Ravens", location: "Baltimore", color: "#241773" },
  { id: "BUF", name: "Buffalo Bills", short: "Bills", location: "Buffalo", color: "#00338D" },
  { id: "CAR", name: "Carolina Panthers", short: "Panthers", location: "Carolina", color: "#0085CA" },
  { id: "CHI", name: "Chicago Bears", short: "Bears", location: "Chicago", color: "#0B162A" },
  { id: "CIN", name: "Cincinnati Bengals", short: "Bengals", location: "Cincinnati", color: "#FB4F14" },
  { id: "CLE", name: "Cleveland Browns", short: "Browns", location: "Cleveland", color: "#311D00" },
  { id: "DAL", name: "Dallas Cowboys", short: "Cowboys", location: "Dallas", color: "#003594" },
  { id: "DEN", name: "Denver Broncos", short: "Broncos", location: "Denver", color: "#FB4F14" },
  { id: "DET", name: "Detroit Lions", short: "Lions", location: "Detroit", color: "#0076B6" },
  { id: "GB", name: "Green Bay Packers", short: "Packers", location: "Green Bay", color: "#203731" },
  { id: "HOU", name: "Houston Texans", short: "Texans", location: "Houston", color: "#03202F" },
  { id: "IND", name: "Indianapolis Colts", short: "Colts", location: "Indianapolis", color: "#002C5F" },
  { id: "JAX", name: "Jacksonville Jaguars", short: "Jaguars", location: "Jacksonville", color: "#006778" },
  { id: "KC", name: "Kansas City Chiefs", short: "Chiefs", location: "Kansas City", color: "#E31837" },
  { id: "LV", name: "Las Vegas Raiders", short: "Raiders", location: "Las Vegas", color: "#000000" },
  { id: "LAC", name: "Los Angeles Chargers", short: "Chargers", location: "Los Angeles", color: "#0080C6" },
  { id: "LAR", name: "Los Angeles Rams", short: "Rams", location: "Los Angeles", color: "#003594" },
  { id: "MIA", name: "Miami Dolphins", short: "Dolphins", location: "Miami", color: "#008E97" },
  { id: "MIN", name: "Minnesota Vikings", short: "Vikings", location: "Minnesota", color: "#4F2683" },
  { id: "NE", name: "New England Patriots", short: "Patriots", location: "New England", color: "#002244" },
  { id: "NO", name: "New Orleans Saints", short: "Saints", location: "New Orleans", color: "#D3BC8D" },
  { id: "NYG", name: "New York Giants", short: "Giants", location: "New York", color: "#0B2265" },
  { id: "NYJ", name: "New York Jets", short: "Jets", location: "New York", color: "#125740" },
  { id: "PHI", name: "Philadelphia Eagles", short: "Eagles", location: "Philadelphia", color: "#004C54" },
  { id: "PIT", name: "Pittsburgh Steelers", short: "Steelers", location: "Pittsburgh", color: "#FFB612" },
  { id: "SEA", name: "Seattle Seahawks", short: "Seahawks", location: "Seattle", color: "#002244" },
  { id: "SF", name: "San Francisco 49ers", short: "49ers", location: "San Francisco", color: "#AA0000" },
  { id: "TB", name: "Tampa Bay Buccaneers", short: "Buccaneers", location: "Tampa Bay", color: "#D50A0A" },
  { id: "TEN", name: "Tennessee Titans", short: "Titans", location: "Tennessee", color: "#0C2340" },
  { id: "WSH", name: "Washington Commanders", short: "Commanders", location: "Washington", color: "#5A1414" },
];

const EXTRA: Record<string, string> = {
  "la rams": "LAR",
  "l a rams": "LAR",
  "st louis rams": "LAR",
  "la chargers": "LAC",
  "l a chargers": "LAC",
  "san diego chargers": "LAC",
  "washington": "WSH",
  "washington football team": "WSH",
  "football team": "WSH",
  "niners": "SF",
  "pats": "NE",
};

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES = new Map<string, string>();
for (const team of TEAMS) {
  ALIASES.set(norm(team.name), team.id);
  ALIASES.set(norm(team.short), team.id);
  ALIASES.set(norm(team.id), team.id);
}
for (const [alias, id] of Object.entries(EXTRA)) ALIASES.set(norm(alias), id);

export function teamById(id: string): Team | undefined {
  return TEAMS.find((team) => team.id === id);
}

export function logoUrl(id: string): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${id.toLowerCase()}.png`;
}

/** Map a sheet name (short or full) to a team id. "TIE" and blanks are not teams. */
export function resolveTeam(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^tie$/i.test(trimmed)) return null;
  const id = ALIASES.get(norm(trimmed));
  if (!id) throw new Error(`Unknown team name: ${raw}`);
  return id;
}

export function isTie(raw: string | null | undefined): boolean {
  return !!raw && /^tie$/i.test(raw.trim());
}
