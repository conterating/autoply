import { startFixtureServer } from "./index.ts";

const port = Number(process.env.FIXTURE_PORT ?? 4399);
const server = await startFixtureServer({ port });
console.log(`Fixture ATS server listening on ${server.url}`);
console.log(`  Greenhouse: ${server.url}/greenhouse/boards-api/v1/boards/northwind/jobs?content=true`);
console.log(`  Lever:      ${server.url}/lever/v0/postings/contoso?mode=json`);
console.log(`  Ashby:      ${server.url}/ashby/posting-api/job-board/fabrikam?includeCompensation=true`);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
