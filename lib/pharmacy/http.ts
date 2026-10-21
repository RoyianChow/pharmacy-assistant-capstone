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
  // Log only allowlisted categories: database messages can contain credentials or patient input.
  const categories: Record<string, string> = {
    "28P01": "database_authentication_failed", "28000": "database_authentication_failed",
    "3D000": "database_not_found", "42501": "database_permission_denied",
    "42P01": "database_schema_missing", "53300": "database_connection_limit",
    "57014": "database_query_timeout", ECONNREFUSED: "database_connection_refused",
    ENOTFOUND: "database_host_not_found", ETIMEDOUT: "database_connection_timeout",
    EROFS: "database_filesystem_readonly", EACCES: "database_filesystem_denied",
    database_not_configured: "database_not_configured", database_configuration_invalid: "database_configuration_invalid",
  };
  if (!(error instanceof PharmacyError) || error.status >= 500) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    console.error("[pharmacy-storage]", typeof code === "string" && Object.hasOwn(categories, code) ? categories[code] : "database_operation_failed");
  }
  return Response.json({ error: error instanceof PharmacyError ? error.message : "The pharmacy service is unavailable. Please try again." }, { status: error instanceof PharmacyError ? error.status : 503, headers: privateHeaders });
}
