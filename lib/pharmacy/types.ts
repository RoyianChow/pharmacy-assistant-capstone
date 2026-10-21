import type { Answer, AssessmentResult, SummaryItem } from "../assessment/types";

export type CaseStatus = "new" | "in_review" | "completed";
export type PatientDetails = { displayName: string; contactPreference: "in_person" | "phone" | "email"; contact: string };
export type CaseListItem = {
  id: string;
  reference: string;
  patient: PatientDetails;
  concern: string;
  outcome: AssessmentResult["kind"];
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type ReviewEvent = { status: CaseStatus; reviewerName: string; notes: string; createdAt: string };
export type PharmacyCase = CaseListItem & {
  answers: Answer[];
  summary: SummaryItem[];
  result: AssessmentResult;
  reviewNotes: string;
  reviewerName: string;
  reviewHistory: ReviewEvent[];
};
export type DashboardResponse = { cases: CaseListItem[]; counts: Record<CaseStatus, number>; total: number };
export type SubmissionReceipt = { id: string; reference: string; createdAt: string; status: CaseStatus };

export function canSubmitAssessment(answers: Answer[], result: AssessmentResult | undefined) {
  const values = Object.fromEntries(answers.map(a => [a.questionId, a.value]));
  return !!result && result.kind !== "emergency" && result.kind !== "urgent" && values.ontario === "yes" && values.age !== "under18" && !!values.concern;
}
