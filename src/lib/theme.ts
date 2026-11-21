export type ThemeId =
  | "gameday"
  | "halloween"
  | "thanksgiving"
  | "christmas"
  | "newyear"
  | "playoffs"
  | "superbowl";

export type Phase = "regular" | "playoffs" | "superbowl";

export type ThemeColors = {
  bg: string;
  bgElev: string;
  card: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentInk: string;
  good: string;
  bad: string;
  gold: string;
  line: string;
  kicker: string;
};

export const THEMES: Record<ThemeId, ThemeColors> = {
  gameday: {
    bg: "#08110e",
    bgElev: "#102019",
    card: "#16281f",
    text: "#f6f3ea",
    muted: "#c9d5cc",
    faint: "#9aada2",
    accent: "#dff25a",
    accentInk: "#172006",
    good: "#b6ffcf",
    bad: "#ffb4bc",
    gold: "#ffd56a",
    line: "rgba(246,243,234,0.14)",
    kicker: "GAMEDAY",
  },
  halloween: {
    bg: "#140c09",
    bgElev: "#24140d",
    card: "#2c1910",
    text: "#fff4e8",
    muted: "#f0d2b8",
    faint: "#c9a88e",
    accent: "#ff8a2a",
    accentInk: "#2a1000",
    good: "#d8ffb0",
    bad: "#ffb1a8",
    gold: "#ffd27a",
    line: "rgba(255,244,232,0.14)",
    kicker: "HALLOWEEN WEEK",
  },
  thanksgiving: {
    bg: "#160e09",
    bgElev: "#27170e",
    card: "#321d11",
    text: "#fff6ea",
    muted: "#f0d7b8",
    faint: "#c9ae90",
    accent: "#ffb020",
    accentInk: "#2a1600",
    good: "#d7f5b8",
    bad: "#ffb6a8",
    gold: "#ffe0a3",
    line: "rgba(255,246,234,0.14)",
    kicker: "THANKSGIVING WEEK",
  },
  christmas: {
    bg: "#0c1412",
    bgElev: "#14211c",
    card: "#1a2b24",
    text: "#f7f4ec",
    muted: "#d5e4da",
    faint: "#a8c0b2",
    accent: "#ff5d6c",
    accentInk: "#2a060b",
    good: "#c8ffd8",
    bad: "#ffc1c6",
    gold: "#f3d48a",
    line: "rgba(247,244,236,0.14)",
    kicker: "CHRISTMAS WEEK",
  },
  newyear: {
    bg: "#0d1018",
    bgElev: "#171c2a",
    card: "#1e2536",
    text: "#f7f4ec",
    muted: "#d5d8e6",
    faint: "#a8aec4",
    accent: "#f3e2b3",
    accentInk: "#241c0c",
    good: "#c9ffe0",
    bad: "#ffc0c8",
    gold: "#ffe7ad",
    line: "rgba(247,244,236,0.14)",
    kicker: "NEW YEAR",
  },
  playoffs: {
    bg: "#100e09",
    bgElev: "#1c1810",
    card: "#262015",
    text: "#f8f4ea",
    muted: "#e2d3b4",
    faint: "#b7a78a",
    accent: "#e7c36a",
    accentInk: "#241c08",
    good: "#d9ffc2",
    bad: "#ffc1b8",
    gold: "#ffe1a0",
    line: "rgba(248,244,234,0.14)",
    kicker: "PLAYOFFS",
  },
  superbowl: {
    bg: "#090909",
    bgElev: "#16140f",
    card: "#221e14",
    text: "#fff8ea",
    muted: "#ead9b0",
    faint: "#c2b089",
    accent: "#ffd76a",
    accentInk: "#241c08",
    good: "#d8ffc4",
    bad: "#ffc4bc",
    gold: "#ffe7a8",
    line: "rgba(255,248,234,0.16)",
    kicker: "SUPER BOWL",
  },
};

function pacificParts(date: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function pacificStamp(date: Date): number {
  const { year, month, day } = pacificParts(date);
  return year * 10000 + month * 100 + day;
}

/** Fourth Thursday in November, as a Pacific calendar stamp YYYYMMDD, and the Mon–Sun window. */
export function thanksgivingWindow(year: number): { start: number; end: number } {
  let thursday = 0;
  for (let day = 1; day <= 30; day++) {
    const probe = new Date(Date.UTC(year, 10, day, 20));
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
    }).format(probe);
    if (weekday === "Thu") {
      thursday += 1;
      if (thursday === 4) {
        const start = new Date(probe);
        start.setUTCDate(probe.getUTCDate() - 3);
        const end = new Date(probe);
        end.setUTCDate(probe.getUTCDate() + 3);
        return { start: pacificStamp(start), end: pacificStamp(end) };
      }
    }
  }
  return { start: year * 10000 + 1123, end: year * 10000 + 1129 };
}

/**
 * Theme from the Pacific calendar date.
 * Holidays win over the playoff/Super Bowl phase.
 * Playoffs and Super Bowl come from the week the pool is on.
 */
export function themeForDate(date: Date, phase: Phase = "regular"): ThemeId {
  const { year, month, day } = pacificParts(date);
  const stamp = year * 10000 + month * 100 + day;
  if (month === 12 && day === 31) return "newyear";
  if (month === 1 && day <= 2) return "newyear";
  if (month === 12 && day >= 20 && day <= 26) return "christmas";
  if (month === 10 && day >= 24 && day <= 31) return "halloween";
  const thanks = thanksgivingWindow(year);
  if (stamp >= thanks.start && stamp <= thanks.end) return "thanksgiving";
  if (phase === "superbowl") return "superbowl";
  if (phase === "playoffs") return "playoffs";
  return "gameday";
}

function channel(hex: string, shift: number): number {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const pick = shift === 0 ? r : shift === 1 ? g : b;
  return pick;
}

function linear(channel8: number): number {
  const s = channel8 / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

export function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Team colors can be nearly black. Use a light edge so the card still reads. */
export function readableTeamColor(hex: string): string {
  const normalized = hex.startsWith("#") ? hex : `#${hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return "#d6ff4a";
  return luminance(normalized) < 0.04 ? "#d5dbe3" : normalized;
}
