"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const NAV_SHORTCUTS: Record<string, string> = {
  "/": "h",
  "/pipeline": "p",
  "/needs-input": "n",
  "/profile": "r",
  "/answers": "a",
  "/settings": "s",
};

const BY_KEY = Object.fromEntries(Object.entries(NAV_SHORTCUTS).map(([href, key]) => [key, href]));

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** "g" then a letter jumps between sections, like Linear and GitHub. */
export function KeyboardNav() {
  const router = useRouter();
  useEffect(() => {
    let pendingG = 0;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "g") {
        pendingG = Date.now();
        return;
      }
      if (Date.now() - pendingG < 1000) {
        const href = BY_KEY[e.key];
        pendingG = 0;
        if (href) {
          e.preventDefault();
          router.push(href);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}
