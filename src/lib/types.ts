export type Team = {
  id: string;
  name: string;
  short_name: string;
  location: string;
  color: string;
  logo: string;
};

export type Person = {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  kind?: string;
  active?: boolean;
};

export type Game = {
  id: string;
  week_id: string;
  slot: number;
  kickoff: string | null;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "excluded";
  is_tie: boolean;
  is_mnf: boolean;
  neutral: boolean;
  away_score: number | null;
  home_score: number | null;
  winner_team_id: string | null;
  locked: boolean;
  away: Team;
  home: Team;
};

export type WeekSummary = {
  id: string;
  season_type: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  scheduled_open_at: string | null;
  complete: boolean;
  mnf_total: number | null;
  released: boolean;
  winner_ids: string[];
};

export type WeekScore = {
  week_id: string;
  season_type: number;
  week_number: number;
  label: string;
  entered: boolean;
  score: number | null;
  winner: boolean;
};

export type Standing = Person & {
  total: number;
  wins: number;
  weeks: WeekScore[];
};

export type Leader = Person & {
  correct: number;
  guess: number | null;
  diff: number | null;
  winner: boolean;
};

export type SeasonSummary = {
  id: string;
  year: number;
  name: string;
  status: string;
  champions: (Person & { total: number })[];
};

export type AllTime = {
  titles: (Person & { titles: number })[];
  best_season: (Person & { total: number; year: number })[];
  weekly_wins: (Person & { wins: number })[];
  best_week: (Person & { score: number; label: string; year: number })[];
};

export type Boot = {
  now: string;
  authenticated: boolean;
  bad_token?: boolean;
  me: Person | null;
  is_admin: boolean;
  phase: "regular" | "playoffs" | "superbowl";
  season: null | {
    id: string;
    year: number;
    name: string;
    status: string;
    lock_mode: "deadline" | "kickoff";
    lock_time: string;
    lock_weekday: number;
    lock_timezone: string;
  };
  current_week_id: string | null;
  live_week_id: string | null;
  weeks: WeekSummary[];
  games: Game[];
  my_picks: Record<string, string>;
  my_guess: number | null;
  my_entry: boolean;
  missing: Person[];
  leaderboard: Leader[] | null;
  standings: Standing[];
  seasons: SeasonSummary[];
  all_time: AllTime | null;
  roster: Person[] | null;
};

export type BoardRow = Person & {
  entered: boolean;
  guess: number | null;
  correct: number | null;
  diff: number | null;
  winner: boolean;
  picks: Record<string, string>;
};

export type Board = {
  week: {
    id: string;
    label: string;
    week_number: number;
    lock_at: string | null;
    complete: boolean;
    mnf_total: number | null;
    visible: boolean;
  };
  games: Game[];
  rows: BoardRow[];
  missing: Person[];
};

export type PlayerPage = {
  player: Person;
  season_id: string;
  total: number;
  wins: number;
  weeks: {
    week_id: string;
    label: string;
    week_number: number;
    season_type: number;
    entered: boolean;
    visible: boolean;
    score: number | null;
    guess: number | null;
    winner: boolean;
  }[];
};
