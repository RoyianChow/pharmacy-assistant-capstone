import "server-only";
import { PharmacyError } from "./validation";

export const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 48_000;

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new PharmacyError("Please use this site's pharmacy pages.", 403);
}

export async function readJson(request: Request): Promise<unknown> {
  checkOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new PharmacyError("Expected a JSON request.", 415);
  if (!request.body) throw new PharmacyError("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new PharmacyError("Assessment request is too large.", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new PharmacyError("Please send valid JSON."); }
}

export function errorResponse(error: unknown) {
  // Keep database errors, paths and submitted health details out of responses and logs.
  return Response.json({ error: error instanceof PharmacyError ? error.message : "The pharmacy service is unavailable. Please try again." }, { status: error instanceof PharmacyError ? error.status : 503, headers: privateHeaders });
}
