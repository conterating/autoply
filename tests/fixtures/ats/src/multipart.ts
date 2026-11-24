import type { Parsed } from "./core.ts";

function addField(fields: Record<string, string | string[]>, name: string, value: string): void {
  const prev = fields[name];
  if (prev === undefined) fields[name] = value;
  else if (Array.isArray(prev)) prev.push(value);
  else fields[name] = [prev, value];
}

export function parseUrlencoded(body: Buffer): Parsed {
  const fields: Parsed["fields"] = {};
  for (const [k, v] of new URLSearchParams(body.toString("utf8"))) addField(fields, k, v);
  return { fields, files: {} };
}

/** Minimal multipart/form-data parser (RFC 7578) over a fully buffered body. */
export function parseMultipart(body: Buffer, boundary: string): Parsed {
  const fields: Parsed["fields"] = {};
  const files: Parsed["files"] = {};
  const delim = Buffer.from(`--${boundary}`);
  const crlf2 = Buffer.from("\r\n\r\n");
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    // "--" right after a delimiter marks the closing boundary.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    // Part spans from after the delimiter's CRLF to the CRLF preceding the next delimiter.
    const part = body.subarray(start + 2, next - 2);
    const headerEnd = part.indexOf(crlf2);
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + 4);
      const disp = /^content-disposition:[^\r\n]*$/im.exec(headers)?.[0] ?? "";
      const name = /[;\s]name="([^"]*)"/i.exec(disp)?.[1];
      const filename = /filename="([^"]*)"/i.exec(disp)?.[1];
      const ctype = /^content-type:\s*([^\r\n]+)$/im.exec(headers)?.[1]?.trim();
      if (name !== undefined) {
        if (filename !== undefined) {
          // Browsers send filename="" with an empty body for an untouched file input.
          if (filename !== "" || content.length > 0) {
            files[name] = { filename, size: content.length, contentType: ctype ?? "application/octet-stream" };
          }
        } else {
          addField(fields, name, content.toString("utf8"));
        }
      }
    }
    pos = next;
  }
  return { fields, files };
}

export function parseBody(body: Buffer, contentType: string): Parsed {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const boundary = m?.[1] ?? m?.[2];
    if (!boundary) return { fields: {}, files: {} };
    return parseMultipart(body, boundary);
  }
  if (ct.startsWith("application/x-www-form-urlencoded")) return parseUrlencoded(body);
  return { fields: {}, files: {} };
}
