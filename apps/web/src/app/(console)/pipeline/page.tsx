import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata = { title: "Pipeline" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pipeline" />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <EmptyState title="No applications yet">Every job the worker finds appears here with its match score and status.</EmptyState>
      </div>
    </>
  );
}
