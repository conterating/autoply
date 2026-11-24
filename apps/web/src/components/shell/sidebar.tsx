"use client";

import { Activity, BookText, Home, Inbox, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PunchStrip } from "@/components/punch-strip";
import { ThemeSwitch } from "@/components/theme";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { WorkerView } from "@/lib/shell";
import { KeyboardNav, NAV_SHORTCUTS } from "./keyboard-nav";
import { WorkerDot } from "./worker-control";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/pipeline", label: "Pipeline", icon: Activity },
  { href: "/needs-input", label: "Needs input", icon: Inbox },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/answers", label: "Answer bank", icon: BookText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({
  worker,
  waiting,
  sentToday,
  dailyCap,
  dryRun,
}: {
  worker: WorkerView;
  waiting: number;
  sentToday: number;
  dailyCap: number;
  dryRun: boolean;
}) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface">
      <KeyboardNav />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-2 focus:py-1"
      >
        Skip to content
      </a>
      <div className="flex h-12 items-center px-4">
        <Link href="/" className="font-display-wide text-[17px] font-[650] tracking-tight text-ink">
          autoply
        </Link>
        {dryRun && (
          <span
            title="Forms are filled but never submitted. Turn this off in Settings."
            className="ml-auto rounded border border-dashed border-warn/60 px-1.5 py-px font-mono text-2xs text-warn uppercase"
          >
            Dry run
          </span>
        )}
      </div>

      <nav aria-label="Main" className="flex flex-col gap-px px-2 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const shortcut = NAV_SHORTCUTS[href];
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink",
                active && "bg-surface-2 font-medium text-ink",
              )}
            >
              <Icon className={cn("size-4 text-ink-3", active && "text-carbon")} aria-hidden />
              <span className="flex-1">{label}</span>
              {href === "/needs-input" && waiting > 0 ? (
                <span className="rounded-full bg-warn-soft px-1.5 font-mono text-2xs font-medium text-warn tabular">
                  {waiting}
                </span>
              ) : (
                shortcut && (
                  <span className="hidden gap-0.5 group-hover:flex" aria-hidden>
                    <Kbd>G</Kbd>
                    <Kbd>{shortcut.toUpperCase()}</Kbd>
                  </span>
                )
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-line p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink-3">Sent today</span>
          <span className="font-mono text-ink-2 tabular">
            {sentToday}/{dailyCap}
          </span>
        </div>
        <PunchStrip used={sentToday} cap={dailyCap} size="sm" />
        <div className="flex items-center justify-between">
          <WorkerDot worker={worker} />
          <ThemeSwitch />
        </div>
      </div>
    </aside>
  );
}
