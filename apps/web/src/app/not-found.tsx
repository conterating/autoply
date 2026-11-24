import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-3 px-6">
      <p className="font-mono text-xs text-ink-3">404</p>
      <h1 className="font-display-wide text-xl font-semibold">Nothing here</h1>
      <p className="text-[13px] text-ink-2">That page or application doesn’t exist. It may have been deleted with your data.</p>
      <Button asChild variant="primary">
        <Link href="/">Go to Home</Link>
      </Button>
    </main>
  );
}
