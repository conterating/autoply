import { cn } from "@/lib/cn";

/**
 * The daily cap as a strip of punch slots: one slot per application allowed
 * today, punched (filled) as applications go out. Caps above 100 fall back to
 * proportional fill so the strip stays one line.
 */
export function PunchStrip({
  used,
  cap,
  size = "md",
  className,
}: {
  used: number;
  cap: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const slots = Math.min(cap, 100);
  const punched = cap <= 100 ? Math.min(used, cap) : Math.round((Math.min(used, cap) / cap) * slots);
  return (
    <div
      role="meter"
      aria-label="Applications sent today"
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(used, cap)}
      aria-valuetext={`${used} of ${cap}`}
      className={cn("grid w-full", size === "md" ? "gap-[3px]" : "gap-[2px]", className)}
      style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "block rounded-[2px]",
            size === "md" ? "h-5" : "h-2",
            i < punched ? "bg-carbon" : "border border-dashed border-line-strong bg-transparent",
            i < punched && i === punched - 1 && "shadow-[0_0_0_2px_var(--carbon-soft)]",
          )}
        />
      ))}
    </div>
  );
}
