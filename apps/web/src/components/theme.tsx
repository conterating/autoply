"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

type Theme = "light" | "dark" | "system";
const KEY = "autoply-theme";

/** Runs before paint (inlined in <head>) so there's no flash of the wrong theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function readTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();
let memoryTheme: Theme | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (readTheme() === "system") apply("system");
  };
  mq.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystemChange);
  };
}

function setTheme(next: Theme) {
  memoryTheme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private mode: theme still applies for this page view
  }
  apply(next);
  listeners.forEach((l) => l());
}

export function ThemeSwitch() {
  const theme = useSyncExternalStore(
    subscribe,
    () => memoryTheme ?? readTheme(),
    () => "system" as Theme,
  );

  const choose = setTheme;

  const options = [
    { value: "light", label: "Light theme", icon: Sun },
    { value: "system", label: "Match system theme", icon: Monitor },
    { value: "dark", label: "Dark theme", icon: Moon },
  ] as const;

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            "grid size-6 place-items-center rounded text-ink-3 hover:text-ink",
            theme === value && "bg-surface-2 text-ink",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
