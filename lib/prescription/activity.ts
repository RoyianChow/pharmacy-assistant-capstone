import type { PrescriptionResult } from "./types";

export const PRESCRIPTION_ACTIVITY_EVENT = "pharmacy:prescription-activity";
const STORAGE_KEY = "pharmacy:prescription-activity:v1";

export type PrescriptionActivity = {
  version: 1;
  scanCount: number;
  lastScan: {
    at: string;
    fieldCount: number;
    extractedCount: number;
    flaggedCount: number;
    durationMs: number;
  };
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function parseActivity(value: unknown): PrescriptionActivity | null {
  if (!object(value) || value.version !== 1 || !count(value.scanCount, 1_000_000) || value.scanCount < 1 || !object(value.lastScan)) return null;
  const last = value.lastScan;
  if (typeof last.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(last.at) ||
    !Number.isFinite(Date.parse(last.at)) || new Date(last.at).toISOString() !== last.at ||
    !count(last.fieldCount, 100) || last.fieldCount < 1 ||
    !count(last.extractedCount, last.fieldCount) || !count(last.flaggedCount, last.fieldCount) ||
    last.flaggedCount < last.fieldCount - last.extractedCount ||
    typeof last.durationMs !== "number" || !Number.isFinite(last.durationMs) || last.durationMs < 0 || last.durationMs > 3_600_000) return null;
  // Project only aggregate values, even if session storage was edited manually.
  return { version: 1, scanCount: value.scanCount, lastScan: {
    at: last.at, fieldCount: last.fieldCount, extractedCount: last.extractedCount,
    flaggedCount: last.flaggedCount, durationMs: last.durationMs,
  } };
}

export function readPrescriptionActivity(): PrescriptionActivity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw && raw.length <= 2048 ? parseActivity(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function recordPrescriptionActivity(result: PrescriptionResult): void {
  if (typeof window === "undefined") return;
  try {
    const previous = readPrescriptionActivity();
    const hasValue = (value: string | null) => !!value?.trim();
    const activity = parseActivity({ version: 1, scanCount: Math.min((previous?.scanCount ?? 0) + 1, 1_000_000), lastScan: {
      at: new Date().toISOString(), fieldCount: result.fields.length,
      extractedCount: result.fields.filter(field => hasValue(field.value)).length,
      flaggedCount: result.fields.filter(field => field.needsReview || !hasValue(field.value)).length,
      durationMs: result.ocr.durationMs,
    } });
    if (!activity) return;
    // Keep only counts/timing in this tab. Never store the image, OCR text,
    // field values, file name, or a patient/prescriber identifier.
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activity));
    window.dispatchEvent(new CustomEvent(PRESCRIPTION_ACTIVITY_EVENT));
  } catch {
    // Blocked storage must not turn a successful OCR extraction into an error.
  }
}
