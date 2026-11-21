import { useEffect, useRef } from "react";

const HUNG_MS = 15000;

/** Poll on an interval, and refetch once when the tab is shown again. */
export function useLiveRefresh(refresh: () => Promise<unknown>, poll: boolean) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const busy = useRef(false);
  const generation = useRef(0);
  const wait = useRef(0);
  const runRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let hung = 0;
    const run = () => {
      if (busy.current) return;
      busy.current = true;
      const mine = ++generation.current;
      window.clearTimeout(hung);
      hung = window.setTimeout(() => {
        if (generation.current === mine) busy.current = false;
      }, HUNG_MS);
      refreshRef.current().catch(() => undefined).finally(() => {
        if (generation.current !== mine) return;
        window.clearTimeout(hung);
        busy.current = false;
      });
    };
    runRef.current = run;
    const kick = () => {
      window.clearTimeout(wait.current);
      wait.current = window.setTimeout(() => runRef.current(), 200);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(hung);
      window.clearTimeout(wait.current);
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      runRef.current();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [poll]);
}
