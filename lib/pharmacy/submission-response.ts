import type { SubmissionReceipt } from "./types";

export type SubmissionResponse =
  | { ok: true; receipt: SubmissionReceipt }
  | { ok: false; canCorrect: boolean; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isReceipt(value: unknown): value is SubmissionReceipt {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.reference === "string" &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.status === "string" && ["new", "in_review", "completed"].includes(value.status);
}

/** Interpret the HTTP status even when an intermediary returns an empty or HTML body. */
export async function readSubmissionResponse(response: Response): Promise<SubmissionResponse> {
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) {
    if (isRecord(data) && isReceipt(data.receipt)) return { ok: true, receipt: data.receipt };
    return { ok: false, canCorrect: false, message: "We couldn’t confirm the pharmacy reference. Please retry to retrieve it." };
  }

  // These statuses are definitive validation rejections, before storage is called.
  // All other failures retain the exact payload and key for an uncertain retry.
  const canCorrect = response.status === 400 || response.status === 422;
  let message = canCorrect
    ? "Please check your fictional details and try sending your assessment again."
    : "We couldn’t confirm that your assessment was saved. Please retry the same submission.";
  if (canCorrect && isRecord(data) && typeof data.error === "string" && data.error.trim() && data.error.length <= 240 && !/[<>\u0000-\u001f]/.test(data.error)) {
    message = data.error;
  } else if (response.status === 403) {
    message = "Please use this site's pharmacy pages.";
  } else if (response.status === 409) {
    message = "This submission key was already used for different details. Start a new submission.";
  } else if (response.status === 429) {
    message = "Please wait a minute before retrying this same submission.";
  } else if (response.status >= 500) {
    // Never show upstream service bodies, which can contain implementation details.
    message = "The pharmacy service is unavailable. Please try again.";
  }
  return { ok: false, canCorrect, message };
}
