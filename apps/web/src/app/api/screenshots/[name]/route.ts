import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { dataPaths } from "@autoply/core/paths";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!name.endsWith(".png") || name !== basename(name) || name.includes("\0") || name.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }
  const dir = resolve(dataPaths().screenshots);
  const file = resolve(dir, name);
  if (!file.startsWith(dir + sep)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
