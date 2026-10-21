import "server-only";
import { assess, summarize, validateAnswers } from "../assessment/engine";
import { canSubmitAssessment } from "./types";
import type { Answer, AssessmentResult, SummaryItem } from "../assessment/types";
import type { CaseStatus, PatientDetails } from "./types";

export class PharmacyError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type ValidSubmission = {
  submissionKey: string;
  patient: PatientDetails;
  answers: Answer[];
  result: AssessmentResult;
  summary: SummaryItem[];
  concern: string;
};
export type ValidReview = { status: CaseStatus; reviewerName: string; reviewNotes: string; version: number };

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PharmacyError("Please send a valid request.");
  return input as Record<string, unknown>;
}

function text(input: unknown, label: string, max: number, required = true): string {
  if (typeof input !== "string" || input.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)) throw new PharmacyError(`${label} must be text of no more than ${max} characters.`);
  const value = input.trim();
  if (required && !value) throw new PharmacyError(`${label} is required.`);
  return value;
}

export function validateId(input: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) throw new PharmacyError("Assessment not found.", 404);
  return input.toLowerCase();
}

export function validateSubmission(input: unknown): ValidSubmission {
  const body = object(input);
  if (body.consentToShare !== true) throw new PharmacyError("Please agree to share this assessment with the demo pharmacy.");
  if (typeof body.submissionKey !== "string") throw new PharmacyError("A valid submission key is required.");
  let submissionKey: string;
  try { submissionKey = validateId(body.submissionKey); }
  catch { throw new PharmacyError("A valid submission key is required."); }
  const details = object(body.patient);
  const displayName = text(details.displayName, "Fictional patient name", 80);
  const contactPreference = details.contactPreference;
  if (contactPreference !== "in_person" && contactPreference !== "phone" && contactPreference !== "email") throw new PharmacyError("Choose in-person, phone, or email follow-up.");
  // Never retain a stale contact field when the patient switches to in-person follow-up.
  const contact = contactPreference === "in_person" ? "" : text(details.contact, "Contact details", 254);
  if (contactPreference === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new PharmacyError("Enter a valid fictional email address.");
  if (contactPreference === "phone" && (!/^\+?[\d\s().-]+$/.test(contact) || contact.replace(/\D/g, "").length < 7 || contact.replace(/\D/g, "").length > 15 || contact.length > 30)) throw new PharmacyError("Enter a valid fictional phone number.");
  let answers: Answer[];
  try { answers = validateAnswers(body.answers); }
  catch (error) { throw new PharmacyError(error instanceof Error ? error.message : "Invalid assessment answers."); }
  const result = assess(answers);
  if (!result) throw new PharmacyError("Finish the assessment before sending it to the pharmacy.");
  if (!canSubmitAssessment(answers, result)) throw new PharmacyError("This assessment cannot join the routine pharmacy queue. Follow the care guidance shown in your assessment.");
  const summary = summarize(answers);
  const concern = summary.find(item => item.questionId === "concern")?.value ?? "Other concern";
  return { submissionKey, patient: { displayName, contactPreference, contact }, answers, result, summary, concern };
}

export function validateStatus(input: unknown): CaseStatus {
  if (input !== "new" && input !== "in_review" && input !== "completed") throw new PharmacyError("Choose a valid review status.");
  return input;
}

export function validateReview(input: unknown): ValidReview {
  const body = object(input);
  const status = validateStatus(body.status);
  const reviewerName = text(body.reviewerName, "Reviewer name", 80);
  const reviewNotes = text(body.reviewNotes, "Review notes", 4000, false);
  if (status === "completed" && !reviewNotes) throw new PharmacyError("Add review notes before marking this assessment complete.");
  if (!Number.isSafeInteger(body.version) || (body.version as number) < 1) throw new PharmacyError("A valid assessment version is required. Refresh the assessment and try again.");
  return { status, reviewerName, reviewNotes, version: body.version as number };
}

export function validateFilters(url: URL): { q: string; status?: CaseStatus } {
  const q = text(url.searchParams.get("q") ?? "", "Search", 120, false);
  const status = url.searchParams.get("status");
  return { q, status: !status || status === "all" ? undefined : validateStatus(status) };
}
