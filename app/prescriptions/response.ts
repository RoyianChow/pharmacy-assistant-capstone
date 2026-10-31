import type { PrescriptionAvailability, PrescriptionResult } from "@/lib/prescription/types";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max = 5000): value is string { return typeof value === "string" && value.length <= max; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function confidence(value: unknown) { return finite(value) && value >= 0 && value <= 1; }
function nullableText(value: unknown) { return value === null || text(value); }
function invalid(): never { throw new Error("The extraction service returned incomplete information. Please try again."); }
const fieldKeys = new Set(["patient", "dateOfBirth", "dateIssued", "prescriber", "licence", "clinicPhone", "medication", "strength", "directions", "quantity", "refills", "signature"]);

export function parseAvailability(value: unknown): PrescriptionAvailability {
  if (!object(value) || typeof value.configured !== "boolean" || !finite(value.maxBytes) || value.maxBytes <= 0 || !Array.isArray(value.acceptedTypes) || !value.acceptedTypes.every(item => typeof item === "string")) invalid();
  return value as PrescriptionAvailability;
}

export function parsePrescriptionResponse(value: unknown): PrescriptionResult {
  if (!object(value) || value.reviewRequired !== true || typeof value.isDemo !== "boolean" || !object(value.ocr)) invalid();
  const ocr = value.ocr;
  if (ocr.engine !== "PaddleOCR" || !text(ocr.model, 200) || !finite(ocr.durationMs) || ocr.durationMs < 0 || !object(ocr.image) || !finite(ocr.image.width) || !finite(ocr.image.height) || ocr.image.width <= 0 || ocr.image.height <= 0 || !Array.isArray(ocr.lines) || ocr.lines.length > 1000) invalid();
  for (const line of ocr.lines) {
    if (!object(line) || !text(line.text) || !confidence(line.confidence) || !Array.isArray(line.box) || line.box.length !== 4 || !line.box.every(point => Array.isArray(point) && point.length === 2 && point.every(finite))) invalid();
  }
  if (!Array.isArray(value.fields) || value.fields.length !== fieldKeys.size || !Array.isArray(value.checks) || value.checks.length > 50) invalid();
  const keys = new Set<string>();
  for (const field of value.fields) {
    if (!object(field) || !text(field.key, 30) || !fieldKeys.has(field.key) || keys.has(field.key) || !text(field.label, 100) || !nullableText(field.value) || !(field.confidence === null || confidence(field.confidence)) || !nullableText(field.sourceText) || typeof field.needsReview !== "boolean") invalid();
    keys.add(field.key);
  }
  for (const check of value.checks) {
    if (!object(check) || !text(check.code, 100) || !["warning", "info"].includes(String(check.severity)) || !text(check.message, 1000)) invalid();
  }
  return value as PrescriptionResult;
}

export function requestError(status: number) {
  if (status === 401) return "Your staff session has ended. Sign in again to continue.";
  if (status === 403) return "This request requires an approved staff account and the fictional-data acknowledgement.";
  if (status === 413) return "This image is too large. Choose a PNG or JPEG no larger than 4 MB.";
  if (status === 415 || status === 400 || status === 422) return "This image could not be processed. Choose a clear PNG or JPEG of a fictional typed prescription.";
  if (status === 429) return "The extraction service is busy. Wait a moment, then try again.";
  if (status === 503) return "PaddleOCR is unavailable. Your image is still selected; please try again when the service is connected.";
  return "Text extraction could not be completed. Please try again.";
}
