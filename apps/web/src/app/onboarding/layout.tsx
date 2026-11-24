import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/theme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center border-b border-line bg-surface px-6">
        <span className="font-display-wide text-[17px] font-[650] tracking-tight">autoply</span>
        <span className="ml-3 text-xs text-ink-3">Profile setup · your progress saves after each page</span>
        <div className="ml-auto">
          <ThemeSwitch />
        </div>
      </header>
      {children}
    </div>
  );
}
