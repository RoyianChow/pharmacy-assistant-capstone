import "server-only";
import { MAX_PRESCRIPTION_BYTES, PRESCRIPTION_TYPES } from "./types";
import { parseOcrResult } from "./ocr-result";

export class PrescriptionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function serviceConfig() {
  const raw = process.env.PADDLEOCR_SERVICE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const token = process.env.PADDLEOCR_SERVICE_TOKEN?.trim();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) return null;
    if (url.protocol !== "https:" && !(local && process.env.NODE_ENV === "development" && !process.env.VERCEL)) return null;
    if ((!local || process.env.NODE_ENV !== "development" || process.env.VERCEL) && !token) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ocr`;
    return { url, token };
  } catch { return null; }
}

export function prescriptionAvailability() {
  return { configured: !!serviceConfig(), maxBytes: MAX_PRESCRIPTION_BYTES, acceptedTypes: PRESCRIPTION_TYPES };
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new PrescriptionError("Choose a PNG or JPEG image.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PrescriptionError("The image or OCR response is too large.", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function recognizePrescription(request: Request) {
  const config = serviceConfig();
  if (!config) throw new PrescriptionError("Prescription text extraction is not connected yet. The demo document is still available to preview and download.", 503);
  if (request.headers.get("x-demo-consent") !== "true") throw new PrescriptionError("Confirm that you are using fictional details before extracting text.");
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!PRESCRIPTION_TYPES.includes(contentType)) throw new PrescriptionError("Use a PNG or JPEG image. PDF upload is not supported in this version.", 415);
  if (Number(request.headers.get("content-length")) > MAX_PRESCRIPTION_BYTES) throw new PrescriptionError("Choose an image smaller than 4 MB.", 413);
  const bytes = await boundedBytes(request.body, MAX_PRESCRIPTION_BYTES);
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((contentType === "image/png" && !png) || (contentType === "image/jpeg" && !jpeg)) throw new PrescriptionError("This file does not match its image format. Choose a valid PNG or JPEG image.", 415);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (request.signal.aborted) throw new PrescriptionError("The request was cancelled.", 499);
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 80_000);
  try {
    const response = await fetch(config.url, {
      method: "POST", headers: { "Content-Type": contentType, ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: bytes, cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 413) throw new PrescriptionError("The image is too large. Choose a smaller image.", 413);
      if (response.status === 400 || response.status === 415 || response.status === 422) throw new PrescriptionError("The image could not be read. Try a clear, upright PNG or JPEG.", 422);
      if (response.status === 429 || response.status === 503) throw new PrescriptionError("The OCR service is busy or unavailable. Please try again shortly.", 503);
      throw new PrescriptionError("The OCR service could not complete extraction. Please try again.", 502);
    }
    const resultBytes = await boundedBytes(response.body, 1_000_000);
    try { return parseOcrResult(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resultBytes))); }
    catch { throw new PrescriptionError("The OCR service returned an incomplete response. Please try again.", 502); }
  } catch (error) {
    if (timedOut) throw new PrescriptionError("Text extraction took too long. The OCR service may still be warming up; please try again.", 504);
    if (error instanceof PrescriptionError) throw error;
    throw new PrescriptionError("The OCR service could not be reached. Please try again when it is available.", 503);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}
