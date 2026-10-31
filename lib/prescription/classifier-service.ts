import "server-only";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { parseClassificationResult } from "./classification";
import { MAX_PRESCRIPTION_BYTES, PRESCRIPTION_TYPES } from "./types";

export class ClassifierError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); }
}
const unavailable = () => new ClassifierError("The prescription classifier is unavailable. No prediction was made.");
type Config = { kind: "local"; url: URL } | { kind: "aws"; region: string; functionName: string; roleArn?: string };

function config(): Config | null {
  const localUrl = process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL?.trim();
  if (localUrl) {
    if (process.env.NODE_ENV !== "development" || process.env.VERCEL) return null;
    try {
      const url = new URL(localUrl);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/2015-03-31/functions/function/invocations") return null;
      return { kind: "local", url };
    } catch { return null; }
  }
  const region = process.env.PRESCRIPTION_CLASSIFIER_AWS_REGION?.trim();
  const functionName = process.env.PRESCRIPTION_CLASSIFIER_FUNCTION_NAME?.trim();
  const roleArn = process.env.PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN?.trim();
  if (!region || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region) || !functionName || !/^[a-zA-Z0-9_-]{1,64}(?::[a-zA-Z0-9_-]{1,128})?$/.test(functionName)) return null;
  if (roleArn && !/^arn:aws:iam::\d{12}:role\/[a-zA-Z0-9+=,.@_/-]{1,512}$/.test(roleArn)) return null;
  // Hosted requests use short-lived OIDC credentials, never a browser key.
  if ((process.env.VERCEL || process.env.NODE_ENV === "production") && !roleArn) return null;
  return { kind: "aws", region, functionName, roleArn };
}

export function classifierAvailability() { return { configured: config() !== null }; }

async function bounded(body: ReadableStream<Uint8Array> | null, limit: number, status: number) {
  if (!body) throw new ClassifierError("An image or service response was missing.", status);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ClassifierError("The image or response is too large.", status); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, size);
}

function unwrap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const envelope = value as { statusCode?: unknown; body?: unknown };
  if (envelope.statusCode !== 200) {
    if ([400, 413, 415, 422].includes(Number(envelope.statusCode))) throw new ClassifierError("The image could not be classified. Choose a clear PNG or JPEG.", Number(envelope.statusCode));
    throw unavailable();
  }
  try { return parseClassificationResult(envelope.body); } catch { throw unavailable(); }
}

export async function classifyPrescription(request: Request) {
  const settings = config();
  if (!settings) throw unavailable();
  if (request.headers.get("x-demo-consent") !== "true") throw new ClassifierError("Confirm that the image contains fictional details.", 403);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!PRESCRIPTION_TYPES.includes(contentType)) throw new ClassifierError("Choose a PNG or JPEG image.", 415);
  if (Number(request.headers.get("content-length")) > MAX_PRESCRIPTION_BYTES) throw new ClassifierError("Choose an image no larger than 4 MB.", 413);
  const bytes = await bounded(request.body, MAX_PRESCRIPTION_BYTES, 413);
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((contentType === "image/png" && !png) || (contentType === "image/jpeg" && !jpeg)) throw new ClassifierError("The file does not match its image format.", 415);
  const event = { schemaVersion: 1, contentType, imageBase64: bytes.toString("base64") };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) throw new ClassifierError("The request was cancelled.", 499);
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 35_000);
  let client: LambdaClient | undefined;
  try {
    let payload: Uint8Array;
    if (settings.kind === "local") {
      const response = await fetch(settings.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event), cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
      payload = await bounded(response.body, 16_384, 502);
    } else {
      client = new LambdaClient({ region: settings.region, maxAttempts: 1,
        ...(settings.roleArn ? { credentials: awsCredentialsProvider({ roleArn: settings.roleArn }) } : {}),
      });
      const response = await client.send(new InvokeCommand({ FunctionName: settings.functionName, InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify(event)) }), { abortSignal: controller.signal });
      if (response.FunctionError || response.StatusCode !== 200 || !response.Payload || response.Payload.length > 16_384) throw unavailable();
      payload = response.Payload;
    }
    return unwrap(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  } catch (error) {
    if (error instanceof ClassifierError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", abort); client?.destroy();
  }
}
