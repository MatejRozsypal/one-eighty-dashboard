"use client";

/**
 * The presence heartbeat. Mounted once in the app shell, for internal roles
 * only, and renders nothing.
 *
 * Pings `/api/presence`:
 *   - once on load and once each time the tab becomes visible again;
 *   - then every 60 s, but only while the tab is visible AND there was input
 *     (pointer, key, scroll, wheel, touch) in the last 5 minutes.
 * A hidden tab or an idle one sends nothing, so a dashboard left open over
 * lunch does not count as working. Two tabs both ping; the server counts at
 * most one minute per clock minute, so they add up to one.
 *
 * No payload: the server takes the person from the session.
 */

import { useEffect } from "react";

const INTERVAL_MS = 60_000;
const IDLE_MS = 5 * 60_000;
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"] as const;

export function Heartbeat() {
  useEffect(() => {
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };

    const ping = () => {
      fetch("/api/presence", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {
        // Offline or signed out: presence is best effort.
      });
    };

    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < IDLE_MS) ping();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab is itself input.
      lastInput = Date.now();
      ping();
    };

    // Capture on document: scroll does not bubble, but it is still captured.
    for (const e of INPUT_EVENTS) document.addEventListener(e, onInput, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") ping();
    const timer = window.setInterval(tick, INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of INPUT_EVENTS) document.removeEventListener(e, onInput, { capture: true });
    };
  }, []);

  return null;
}
