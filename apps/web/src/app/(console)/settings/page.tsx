import { ModelSettingsSchema } from "@autoply/core";
import { getSettings, schema } from "@autoply/core/db";
import { getApiKey, maskKey } from "@autoply/core/secrets";
import { asc } from "drizzle-orm";
import { ApiKeyForm, ModelsForm } from "@/components/settings/api-key-form";
import { ApplyingForm } from "@/components/settings/applying-form";
import { DataPanel } from "@/components/settings/data-panel";
import { CommunityLists, SourcesPanel } from "@/components/settings/sources-panel";
import { PageHeader } from "@/components/shell/page-header";
import { Section } from "@/components/ui/field";
import { db } from "@/lib/db";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const d = db();
  const s = getSettings(d);
  const { key, source } = await getApiKey();
  const sources = d.select().from(schema.sources).orderBy(asc(schema.sources.companyName)).all();
  const defaults = ModelSettingsSchema.parse({});
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-6">
        <Section title="Applying" description="How and how fast Autoply applies.">
          <ApplyingForm
            initial={{
              mode: s.mode,
              dryRun: s.dryRun,
              dailyCap: s.dailyCap,
              pacing: s.pacing,
              matchThreshold: s.matchThreshold,
              autopilotMatchThreshold: s.autopilotMatchThreshold,
              answerConfidenceThreshold: s.answerConfidenceThreshold,
            }}
          />
        </Section>
        <Section title="Claude API key" description="Used to read your resume, score jobs and write answers.">
          <ApiKeyForm masked={key ? maskKey(key) : null} source={source} />
          <ModelsForm initial={s.models} defaults={defaults} />
        </Section>
        <Section title="Sources" description="Where Autoply looks for jobs.">
          <SourcesPanel sources={sources.map((x) => ({ id: x.id, ats: x.ats, boardToken: x.boardToken, companyName: x.companyName, enabled: x.enabled, lastPolledAt: x.lastPolledAt, lastError: x.lastError }))} />
          <CommunityLists initial={s.communityLists} />
        </Section>
        <Section title="Your data" description="Everything is stored on this computer.">
          <DataPanel />
        </Section>
      </div>
    </>
  );
}
