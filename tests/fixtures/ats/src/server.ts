import http from "node:http";
import type { AddressInfo } from "node:net";
import { handleAshby } from "./ashby.ts";
import type { Ctx, Parsed, Reply, Submission } from "./core.ts";
import { FIXTURE_BOARDS } from "./data.ts";
import { handleGreenhouse } from "./greenhouse.ts";
import { esc, htmlReply, jsonReply, layout } from "./html.ts";
import { handleLever } from "./lever.ts";
import { parseBody } from "./multipart.ts";

const MAX_BODY = 25 * 1024 * 1024;

export type FixtureServer = {
  url: string;
  port: number;
  close(): Promise<void>;
  submissions(): Submission[];
  reset(): void;
};

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function indexPage(): Reply {
  const items = Object.values(FIXTURE_BOARDS)
    .map((b) => `<li>${esc(b.ats)}: ${esc(b.company)} (${esc(b.token)}), ${b.postings.length} postings</li>`)
    .join("");
  return htmlReply(200, layout({ title: "Fixture ATS", body: `<h1>Fixture ATS server</h1><ul>${items}</ul>` }));
}

export async function startFixtureServer(opts: { port?: number } = {}): Promise<FixtureServer> {
  let subs: Submission[] = [];
  let counter = 0;
  let origin = "";

  const server = http.createServer((req, res) => {
    void (async () => {
      let reply: Reply | undefined;
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const method = req.method ?? "GET";
        let form: Parsed | null = null;
        if (method === "POST") form = parseBody(await readBody(req), req.headers["content-type"] ?? "");
        const ctx: Ctx = {
          method,
          path: url.pathname,
          query: url.searchParams,
          origin,
          form,
          record: ({ ats, board, jobId, parsed }) => {
            counter += 1;
            const sub: Submission = {
              id: `FX-${String(counter).padStart(4, "0")}`,
              ats,
              board,
              jobId,
              fields: parsed.fields,
              files: parsed.files,
              at: new Date().toISOString(),
            };
            subs.push(sub);
            return sub;
          },
        };
        if (url.pathname === "/__submissions" && method === "GET") reply = jsonReply(200, subs);
        else if (url.pathname === "/__reset" && method === "POST") {
          subs = [];
          counter = 0;
          reply = jsonReply(200, { ok: true });
        } else if (url.pathname === "/" && method === "GET") reply = indexPage();
        else {
          reply = (await handleGreenhouse(ctx)) ?? (await handleLever(ctx)) ?? (await handleAshby(ctx));
        }
        reply ??= htmlReply(404, layout({ title: "Not found", body: "<h1>Not found</h1>" }));
      } catch (err) {
        reply = htmlReply(500, layout({ title: "Error", body: `<h1>Fixture server error</h1><pre>${esc(String(err))}</pre>` }));
      }
      res.writeHead(reply.status, { "content-type": reply.type ?? "text/plain", "cache-control": "no-store" });
      res.end(reply.body);
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  return {
    url: origin,
    port,
    submissions: () => subs.map((s) => ({ ...s })),
    reset: () => {
      subs = [];
      counter = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
