import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata = { title: "Needs input" };

export default function Page() {
  return (
    <>
      <PageHeader title="Needs input" />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <EmptyState title="Nothing needs you right now">When a form asks something Autoply can’t answer from your profile, the question waits here. Answer it once and it’s saved for every future application.</EmptyState>
      </div>
    </>
  );
}
