import type { Answer, AssessmentResult, SummaryItem } from "../assessment/types";
import type { CaseListItem, DashboardResponse, PatientDetails, PharmacyCase, ReviewEvent } from "./types";
import { DashboardRequestError } from "./dashboard-request";

const statuses = new Set<unknown>(["new", "in_review", "completed"]);
const outcomes = new Set<unknown>(["emergency", "urgent", "pharmacist", "outside_scope", "incomplete"]);
const contactPreferences = new Set<unknown>(["in_person", "phone", "email"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isNonemptyText(value: unknown): value is string {
  return isText(value) && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isCount(value) && value > 0;
}

function isDate(value: unknown): value is string {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function isArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(predicate);
}

function isPatient(value: unknown): value is PatientDetails {
  return isRecord(value) && isNonemptyText(value.displayName) &&
    contactPreferences.has(value.contactPreference) && isText(value.contact);
}

function isCaseListItem(value: unknown): value is CaseListItem {
  return isRecord(value) && isNonemptyText(value.id) && isNonemptyText(value.reference) &&
    isPatient(value.patient) && isText(value.concern) && outcomes.has(value.outcome) &&
    statuses.has(value.status) && isDate(value.createdAt) && isDate(value.updatedAt) &&
    isPositiveInteger(value.version);
}

function isAnswer(value: unknown): value is Answer {
  return isRecord(value) && isNonemptyText(value.questionId) && isText(value.value);
}

function isSummaryItem(value: unknown): value is SummaryItem {
  return isRecord(value) && isText(value.label) && isAnswer(value);
}

function isSource(value: unknown): value is AssessmentResult["sources"][number] {
  return isRecord(value) && isText(value.title) && isText(value.url);
}

function isResult(value: unknown): value is AssessmentResult {
  return isRecord(value) && outcomes.has(value.kind) && isText(value.title) &&
    isText(value.message) && isText(value.prescription) &&
    isArrayOf(value.nextSteps, isText) && isArrayOf(value.sources, isSource);
}

function isReviewEvent(value: unknown): value is ReviewEvent {
  return isRecord(value) && statuses.has(value.status) && isText(value.reviewerName) &&
    isText(value.notes) && isDate(value.createdAt);
}

function isCase(value: unknown): value is PharmacyCase {
  return isRecord(value) &&
    isArrayOf(value.answers, isAnswer) && isArrayOf(value.summary, isSummaryItem) &&
    isResult(value.result) && isText(value.reviewerName) && isText(value.reviewNotes) &&
    isArrayOf(value.reviewHistory, isReviewEvent) && isCaseListItem(value);
}

function invalidResponse(): never {
  throw new DashboardRequestError(
    "The pharmacy service returned incomplete or unexpected information. Please try again.",
    200,
    "invalid_response",
  );
}

export function parseDashboardResponse(value: unknown): DashboardResponse {
  if (!isRecord(value) || !isArrayOf(value.cases, isCaseListItem) || !isRecord(value.counts) ||
    !isCount(value.counts.new) || !isCount(value.counts.in_review) || !isCount(value.counts.completed) ||
    !isCount(value.total) || !isCount(value.matchedTotal) || !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize)) invalidResponse();

  return {
    cases: value.cases,
    counts: { new: value.counts.new, in_review: value.counts.in_review, completed: value.counts.completed },
    total: value.total,
    matchedTotal: value.matchedTotal,
    page: value.page,
    pageSize: value.pageSize,
  };
}

export function parseCaseResponse(value: unknown): { case: PharmacyCase } {
  if (!isRecord(value) || !isCase(value.case)) invalidResponse();
  return { case: value.case };
}
