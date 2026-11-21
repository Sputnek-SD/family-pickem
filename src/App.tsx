import { useCallback, useEffect, useState } from "react";
import { bootstrap, clearToken, readTokens, writeToken } from "./lib/api";
import { THEMES, themeForDate } from "./lib/theme";
import type { Boot } from "./lib/types";
import { AdminScreen } from "./screens/Admin";
import { BoardScreen } from "./screens/BoardScreen";
import { PlayerScreen } from "./screens/Player";
import { SeasonsScreen } from "./screens/Seasons";
import { StandingsScreen } from "./screens/Standings";
import { WeekScreen } from "./screens/Week";

type Route =
  | { name: "week" }
  | { name: "board" }
  | { name: "standings" }
  | { name: "history"; week?: string }
  | { name: "player"; id: string }
  | { name: "seasons" }
  | { name: "admin" }
  | { name: "more" }
  | { name: "enter-player"; token: string }
  | { name: "enter-admin"; token: string };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) return { name: "enter-player", token: decodeURIComponent(parts[1]) };
  if (parts[0] === "a" && parts[1]) return { name: "enter-admin", token: decodeURIComponent(parts[1]) };
  if (parts[0] === "board") return { name: "board" };
  if (parts[0] === "standings") return { name: "standings" };
  if (parts[0] === "history") return { name: "history", week: parts[1] };
  if (parts[0] === "player" && parts[1]) return { name: "player", id: parts[1] };
  if (parts[0] === "seasons") return { name: "seasons" };
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "more") return { name: "more" };
  return { name: "week" };
}

function go(path: string) {
  if (location.hash !== path) location.hash = path;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [tokens, setTokens] = useState(readTokens);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (next = tokens) => {
    const data = await bootstrap(next.player, next.admin);
    if (next.admin && data.authenticated && !data.is_admin) {
      clearToken("admin");
      next = { ...next, admin: "" };
      setTokens(next);
    }
    setBoot(data);
    setError("");
    return data;
  }, [tokens]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (route.name === "enter-player") {
      writeToken("player", route.token);
      const next = { ...readTokens(), player: route.token };
      setTokens(next);
      go("#/");
      return;
    }
    if (route.name === "enter-admin") {
      writeToken("admin", route.token);
      const next = { ...readTokens(), admin: route.token };
      setTokens(next);
      go("#/admin");
    }
  }, [route]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not reach the pool"));
  }, [load]);

  useEffect(() => {
    if (!boot?.now) return;
    const theme = themeForDate(new Date(boot.now), boot.phase ?? "regular");
    const colors = THEMES[theme];
    const root = document.documentElement;
    root.dataset.theme = theme;
    const pairs: [string, string][] = [
      ["--bg", colors.bg],
      ["--bg-elev", colors.bgElev],
      ["--card", colors.card],
      ["--text", colors.text],
      ["--muted", colors.muted],
      ["--faint", colors.faint],
      ["--accent", colors.accent],
      ["--accent-ink", colors.accentInk],
      ["--good", colors.good],
      ["--bad", colors.bad],
      ["--gold", colors.gold],
      ["--line", colors.line],
    ];
    for (const [name, value] of pairs) root.style.setProperty(name, value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.bg);
    const kicker = document.querySelector("[data-theme-name]");
    if (kicker) kicker.textContent = colors.kicker;
  }, [boot?.now, boot?.phase]);

  useEffect(() => {
    if (!boot?.current_week_id) return;
    const week = boot.weeks.find((item) => item.id === boot.current_week_id);
    if (!week || week.complete) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [boot?.current_week_id, boot?.weeks, load]);

  const themeName = boot ? THEMES[themeForDate(new Date(boot.now), boot.phase ?? "regular")].kicker : "GAMEDAY";

  const signedIn = !!boot?.authenticated;
  const latestFinished = [...(boot?.weeks ?? [])].reverse().find((week) => week.complete);

  return (
    <div className={signedIn ? "app" : "app solo"}>
      <div className="theme-mark" data-testid="theme-name" data-theme-name="">
        {themeName}
      </div>
      {signedIn && <nav className="nav">
        <button type="button" data-testid="nav-week" aria-current={route.name === "week"} onClick={() => go("#/")}>
          Week
        </button>
        <button type="button" data-testid="nav-board" aria-current={route.name === "board"} onClick={() => go("#/board")}>
          Picks
        </button>
        <button type="button" data-testid="nav-standings" aria-current={route.name === "standings"} onClick={() => go("#/standings")}>
          Standings
        </button>
        <button type="button" data-testid="nav-more" aria-current={route.name === "more"} onClick={() => go("#/more")}>
          More
        </button>
      </nav>}
      <main>
        {error && <p className="save error">{error}</p>}
        {!boot && !error && <p className="lede">Loading the week…</p>}
        {boot && !boot.authenticated && <Welcome bad={!!boot.bad_token} />}
        {boot && boot.authenticated && route.name === "week" && (
          <WeekScreen boot={boot} token={tokens.player} />
        )}
        {boot && boot.authenticated && route.name === "board" && <BoardScreen boot={boot} tokens={tokens} />}
        {boot && boot.authenticated && route.name === "standings" && (
          <StandingsScreen boot={boot} onOpen={(id) => go(`#/player/${id}`)} />
        )}
        {boot && boot.authenticated && route.name === "history" && (
          <BoardScreen
            boot={boot}
            tokens={tokens}
            weekId={
              route.week
                ? boot.weeks.find((week) => String(week.week_number) === route.week && week.complete)?.id
                  ?? boot.weeks.find((week) => String(week.week_number) === route.week)?.id
                : latestFinished?.id
            }
            onWeek={(id) => {
              const week = boot.weeks.find((item) => item.id === id);
              go(`#/history/${week?.week_number ?? ""}`);
            }}
          />
        )}
        {boot && boot.authenticated && route.name === "player" && (
          <PlayerScreen boot={boot} tokens={tokens} playerId={route.id} />
        )}
        {boot && boot.authenticated && route.name === "seasons" && <SeasonsScreen boot={boot} />}
        {boot && boot.authenticated && route.name === "admin" && boot.is_admin && (
          <AdminScreen boot={boot} admin={tokens.admin} onChanged={async () => { await load(); }} />
        )}
        {boot && boot.authenticated && route.name === "admin" && !boot.is_admin && (
          <section className="panel"><h2>That admin link is not active on this phone.</h2></section>
        )}
        {boot && boot.authenticated && route.name === "more" && (
          <More boot={boot} onForget={() => { clearToken("player"); clearToken("admin"); setTokens({ player: "", admin: "" }); go("#/"); }} />
        )}
      </main>
    </div>
  );
}

function Welcome({ bad }: { bad: boolean }) {
  return (
    <section className="welcome" data-testid="welcome">
      <p className="kicker">Family NFL</p>
      <h1>Pick’em</h1>
      <p>Straight-up winners, one point each. Open the private link Brad sent you. This phone will remember you.</p>
      {bad && <p className="save error">That link doesn’t match anyone in the pool.</p>}
    </section>
  );
}

function More({ boot, onForget }: { boot: Boot; onForget: () => void }) {
  return (
    <div className="screen">
      <header className="hero compact">
        <p className="kicker">{boot.me ? boot.me.full_name : "Admin"}</p>
        <h1>More</h1>
      </header>
      <div className="menu">
        <button
          type="button"
          onClick={() => go(`#/history/${[...(boot.weeks ?? [])].reverse().find((week) => week.complete)?.week_number ?? ""}`)}
          data-testid="nav-history"
        >
          History
        </button>
        <button type="button" onClick={() => go("#/seasons")} data-testid="nav-seasons">Seasons</button>
        {boot.me && (
          <button type="button" onClick={() => go(`#/player/${boot.me?.player_id}`)} data-testid="nav-me">
            Your season
          </button>
        )}
        {boot.is_admin && (
          <button type="button" onClick={() => go("#/admin")} data-testid="nav-admin">Admin</button>
        )}
        <button type="button" className="secondary" onClick={onForget}>Forget this phone</button>
      </div>
    </div>
  );
}
