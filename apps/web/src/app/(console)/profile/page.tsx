import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata = { title: "Profile" };

export default function Page() {
  return (
    <>
      <PageHeader title="Profile" />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <EmptyState title="No profile yet">Your profile is built from your resume during setup.</EmptyState>
      </div>
    </>
  );
}
