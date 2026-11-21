import { useEffect, useRef } from "react";

/** Poll on an interval, and refetch once when the tab is shown again. */
export function useLiveRefresh(refresh: () => Promise<unknown>, poll: boolean) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const busy = useRef(false);
  const wait = useRef(0);

  useEffect(() => {
    const run = () => {
      if (busy.current) return;
      busy.current = true;
      refreshRef.current().catch(() => undefined).finally(() => {
        busy.current = false;
      });
    };
    const kick = () => {
      window.clearTimeout(wait.current);
      wait.current = window.setTimeout(run, 200);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(wait.current);
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      refreshRef.current().catch(() => undefined).finally(() => {
        busy.current = false;
      });
    }, 60000);
    return () => window.clearInterval(timer);
  }, [poll]);
}
