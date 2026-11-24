import type { ReactNode } from "react";

export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-4 border-b border-line bg-paper/90 px-6 backdrop-blur">
      <h1 className="font-display-wide text-[15px] font-semibold text-ink">{title}</h1>
      {meta && <div className="text-xs text-ink-3">{meta}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong px-6 py-8">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-prose text-[13px] text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
