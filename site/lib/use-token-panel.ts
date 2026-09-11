"use client";

/* Shared by Live.tsx, Graduated.tsx and Graveyard.tsx: the one piece of state
   a board row toggles, and the one rule REVAMP.md 1.1's "depth" section sets
   for it -- the panel's open state lives in `?token=`, merged into whatever
   sort/filter/page params a board already carries, so a filtered, sorted,
   paged board with a token open is exactly as shareable as it looks.

   Sort, filter and page (lib/query-state.ts `mergeQuery`) replace the current
   history entry on every change -- there is no reason to let a reader step
   back through eleven filter edits one at a time. Opening the panel is
   different: it is a navigation in the ordinary sense, so it pushes a new
   entry (`pushQuery`) and carries a marker on it. Closing from inside the
   panel then asks "did I push the entry I'm standing on" -- if so,
   `history.back()` is the correct undo and leaves the browser's own Back/
   Forward pair intact; if the page simply loaded with `?token=` already in
   the address bar (a pasted, filtered link), there is no entry of ours to
   step back into, and the close falls back to `mergeQuery`'s replaceState so
   the reader's actual Back still leaves the page rather than bouncing inside
   it. */

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeQuery, pushQuery, readQuery } from "./query-state";

const PANEL_STATE_MARKER = { ledgePanel: true } as const;

function hasPanelMarker(state: unknown): boolean {
  return typeof state === "object" && state !== null && "ledgePanel" in state && (state as { ledgePanel?: unknown }).ledgePanel === true;
}

export interface TokenPanelController {
  /** The address the panel should show, or null when it is closed. */
  token: string | null;
  /** Opens the panel for `address`. `trigger` is the row that was clicked or
      activated, so focus can return to it when the panel closes. */
  open: (address: string, trigger: HTMLElement | null) => void;
  close: () => void;
  /** The element focus returns to when the panel closes -- null when the
      panel was opened by the URL already carrying `?token=` on load (no row
      was clicked), in which case there is nothing to return focus to. */
  returnFocusTo: HTMLElement | null;
}

export function useTokenPanel(): TokenPanelController {
  const [token, setToken] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setToken(readQuery("token"));
    function onPopState(): void {
      setToken(readQuery("token"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const open = useCallback((address: string, trigger: HTMLElement | null): void => {
    returnFocusRef.current = trigger;
    setToken(address);
    pushQuery({ token: address }, PANEL_STATE_MARKER);
  }, []);

  const close = useCallback((): void => {
    setToken(null);
    if (typeof window !== "undefined" && hasPanelMarker(window.history.state)) {
      window.history.back();
    } else {
      mergeQuery({ token: null });
    }
  }, []);

  return { token, open, close, returnFocusTo: returnFocusRef.current };
}
