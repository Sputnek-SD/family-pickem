export type NormalizedEvent = {
  espn_id: string;
  kickoff: string | null;
  state: "final" | "in_progress" | "scheduled" | "postponed";
  away_abbr: string;
  home_abbr: string;
  away_score: number | null;
  home_score: number | null;
  away_color: string | null;
  home_color: string | null;
  away_logo: string | null;
  home_logo: string | null;
  neutral: boolean;
};

export type NormalizedBoard = {
  season_year: number;
  season_type: number;
  week: number;
  events: NormalizedEvent[];
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" ? (value as Json) : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventState(status: Json | null): NormalizedEvent["state"] {
  const type = asRecord(status?.type);
  const name = String(type?.name ?? "");
  const state = String(type?.state ?? "");
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(name)) return "postponed";
  if (state === "post" || type?.completed === true || name === "STATUS_FINAL") return "final";
  if (state === "in" || /IN_PROGRESS|HALFTIME|END_PERIOD|DELAYED/.test(name)) return "in_progress";
  return "scheduled";
}

export function normalizeScoreboard(payload: unknown): NormalizedBoard | null {
  const root = asRecord(payload);
  if (!root) return null;
  const season = asRecord(root.season);
  const week = asRecord(root.week);
  const events = Array.isArray(root.events) ? root.events : null;
  if (!season || !week || !events) return null;
  const seasonYear = Number(season.year);
  const seasonType = Number(season.type);
  const weekNumber = Number(week.number);
  if (!seasonYear || !seasonType || !weekNumber) return null;

  const normalized: NormalizedEvent[] = [];
  for (const item of events) {
    const event = asRecord(item);
    if (!event) continue;
    const competitions = Array.isArray(event.competitions) ? event.competitions : [];
    const competition = asRecord(competitions[0]);
    if (!competition) continue;
    const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
    const away = asRecord(competitors.find((row) => asRecord(row)?.homeAway === "away"));
    const home = asRecord(competitors.find((row) => asRecord(row)?.homeAway === "home"));
    const awayTeam = asRecord(away?.team);
    const homeTeam = asRecord(home?.team);
    if (!awayTeam || !homeTeam) continue;
    const awayAbbr = String(awayTeam.abbreviation ?? "");
    const homeAbbr = String(homeTeam.abbreviation ?? "");
    if (!awayAbbr || !homeAbbr) continue;
    normalized.push({
      espn_id: String(event.id ?? ""),
      kickoff: typeof event.date === "string" ? event.date : null,
      state: eventState(asRecord(competition.status) ?? asRecord(event.status)),
      away_abbr: awayAbbr,
      home_abbr: homeAbbr,
      away_score: numberOrNull(away?.score),
      home_score: numberOrNull(home?.score),
      away_color: typeof awayTeam.color === "string" ? awayTeam.color : null,
      home_color: typeof homeTeam.color === "string" ? homeTeam.color : null,
      away_logo: typeof awayTeam.logo === "string" ? awayTeam.logo : null,
      home_logo: typeof homeTeam.logo === "string" ? homeTeam.logo : null,
      neutral: competition.neutralSite === true,
    });
  }

  return { season_year: seasonYear, season_type: seasonType, week: weekNumber, events: normalized };
}

export function scoreboardUrl(year?: number, seasonType?: number, week?: number): string {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
  if (year) url.searchParams.set("dates", String(year));
  if (seasonType) url.searchParams.set("seasontype", String(seasonType));
  if (week) url.searchParams.set("week", String(week));
  return url.toString();
}
