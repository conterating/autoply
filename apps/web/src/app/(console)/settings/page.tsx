import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <EmptyState title="Settings">Mode, daily limit, pacing and sources.</EmptyState>
      </div>
    </>
  );
}
