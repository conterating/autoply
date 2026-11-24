import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { getShellState } from "@/lib/shell";

export const dynamic = "force-dynamic";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const shell = getShellState();
  return (
    <div className="flex min-h-dvh">
      <Sidebar {...shell} />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
