import { AILMENTS, EMERGENCY_SOURCE, QUESTIONS, SOURCES, detailQuestion, safetyQuestion } from "./questions";
import type { Answer, AssessmentResult, Question, SummaryItem } from "./types";

export const MAX_ANSWERS = 32;
export const MAX_ANSWER_LENGTH = 1200;
const HISTORY_IDS = ["pregnancy", "medicines", "allergies", "conditions", "tried"];
const UNKNOWN = /^(not sure|unsure|unknown|i don'?t know|idk|prefer not to say|skip|n\/?a)[.! ]*$/i;
// A conservative text trigger prompts explicit confirmation; it is not a clinical NLP classifier.
const EMERGENCY_MENTION = /chest (pain|pressure|tight)|can'?t breathe|cannot breathe|struggl\w* to breathe|short\w* of breath|difficulty breathing|trouble breathing|breathless|passed? out|faint\w*|unconscious|confus\w*|lips? (are )?blue|throat (is )?(clos\w*|swell\w*)/i;
const URGENT_MENTION = /vision (loss|change)|blurry vision|eye pain|blood in (my |the )?(vomit|stool)|vomit\w* blood|black stool|severe pain|worst headache|fever.{0,35}(back|side|flank) pain|(?:back|side|flank) pain.{0,35}fever/i;

export function answerMap(answers: Answer[]): Record<string, string> {
  return Object.fromEntries(answers.map(a => [a.questionId, a.value]));
}

export function getQuestion(id: string, answers: Answer[]): Question | undefined {
  if (id === "details") return detailQuestion(answerMap(answers).concern);
  if (id.startsWith("safety_")) return safetyQuestion(id);
  return QUESTIONS.find(q => q.id === id);
}

export function nextQuestions(answers: Answer[]): Question[] {
  const values = answerMap(answers);
  // A fresh potentially urgent disclosure requires fresh confirmation, even after an earlier denial.
  for (const a of answers) {
    if (getQuestion(a.questionId, answers)?.kind === "text" && EMERGENCY_MENTION.test(a.value) && !values[`safety_${a.questionId}`]) return [safetyQuestion(`safety_${a.questionId}`)];
  }
  const first = QUESTIONS.filter(q => !HISTORY_IDS.includes(q.id)).find(q => !values[q.id]);
  if (first) return [first];
  if (!values.details) return [detailQuestion(values.concern)];
  return QUESTIONS.filter(q => HISTORY_IDS.includes(q.id) && !values[q.id]);
}

function result(kind: AssessmentResult["kind"], title: string, message: string, nextSteps: string[]): AssessmentResult {
  return { kind, title, message, nextSteps, prescription: "Whether you need a prescription has not been determined. A pharmacist or other qualified clinician must assess you.", sources: kind === "emergency" ? [EMERGENCY_SOURCE] : SOURCES };
}

export function assess(answers: Answer[]): AssessmentResult | undefined {
  const v = answerMap(answers);
  if (v.emergency === "yes" || Object.entries(v).some(([k, val]) => k.startsWith("safety_") && val === "yes")) {
    return result("emergency", "Get emergency help now", "These symptoms may need emergency care. Call 911 now. Do not wait for a chat reply or a pharmacy visit.", ["Call 911 now, or ask someone nearby to call for you."]);
  }
  if (v.emergency === "unsure" || Object.entries(v).some(([k, val]) => k.startsWith("safety_") && val === "unsure")) {
    return result("emergency", "Get immediate medical help", "You are unsure about symptoms that could be an emergency. If severe chest pain, breathing difficulty, loss of consciousness, or new confusion may be present, call 911 now.", ["Do not continue the assessment while emergency symptoms may be present."]);
  }
  if (nextQuestions(answers)[0]?.id.startsWith("safety_")) return undefined;
  if (v.severity === "severe" || v.warnings === "yes") {
    return result("urgent", "Please seek prompt medical assessment", "You reported severe, worsening, or concerning symptoms. This chat cannot safely assess them or recommend treatment.", ["Contact urgent care or a clinician today. Call 811 if you need help finding the right care.", "If you develop emergency symptoms or feel seriously unwell, call 911."]);
  }
  // Even a negated textual mention is conservatively referred; the prototype cannot interpret clinical context reliably.
  if (answers.some(a => getQuestion(a.questionId, answers)?.kind === "text" && URGENT_MENTION.test(a.value))) {
    return result("urgent", "A clinician should clarify these symptoms", "Your description mentions a potentially concerning symptom. This prototype cannot reliably interpret its context, so a clinician should review it promptly.", ["Contact a clinician today; call 811 for help deciding where to go.", "Call 911 for emergency symptoms."]);
  }
  if (v.age === "under18") return result("outside_scope", "Speak with a pharmacist about care for a child", "This demo only collects adult assessments. Ontario does not have a blanket minor-ailment prescribing age cutoff; a pharmacist must assess age-specific suitability.", ["Ask a pharmacist or the child's clinician for an age-appropriate assessment.", "Call 811 if you need help finding care."]);
  if (v.ontario && v.ontario !== "yes") return result("outside_scope", "Check the services where you are", "This assessment uses Ontario's pharmacist scope. Services and prescribing rules differ by location.", ["Contact a local pharmacist or clinician to discuss your symptoms."]);
  if (v.warnings === "unsure" || v.severity === "unsure") return result("incomplete", "A clinician can help clarify your symptoms", "You are unsure about severity or warning signs. This chat cannot rule out a more serious condition.", ["Speak with a pharmacist or call 811 promptly to discuss your symptoms.", "Call 911 for emergency symptoms."]);
  if (nextQuestions(answers).length > 0) return undefined;
  if (v.concern === "other") return result("outside_scope", "Start with a pharmacist or clinician", "We could not match your selected concern to an Ontario minor ailment pathway. A professional can assess the symptoms and direct you to appropriate care.", ["Bring your summary to a pharmacist or clinician.", "Call 811 if you are unsure where to go."]);
  if (answers.some(a => getQuestion(a.questionId, answers)?.kind === "text" && UNKNOWN.test(a.value)) || v.pregnancy === "unsure") return result("incomplete", "A few details need a pharmacist's review", "Some answers are unknown. They have been kept as unknown, and treatment suitability has not been assessed.", ["Bring your summary and medicine list to a pharmacist to fill in the missing details.", "Discuss prescription, non-prescription, and self-care options after that assessment."]);
  const condition = AILMENTS.find(a => a.value === v.concern)?.label;
  return result("pharmacist", "A pharmacist may be able to help", `Your selected concern (${condition}) is on Ontario's minor ailment list. Your answers do not establish a diagnosis or treatment eligibility. A pharmacist must confirm the condition and whether it is suitable for pharmacy care.`, [
    v.concern === "tick" ? "Contact a pharmacist promptly today about the tick bite; prevention decisions can be time-sensitive." : "Arrange an assessment with an Ontario pharmacist and bring this summary.",
    "The pharmacist may discuss an authorized prescription, a non-prescription product, self-care, or referral. A prescription is not always needed.",
    "Ask what to do if symptoms persist or get worse. This screening does not rule out serious illness.",
  ]);
}

export function summarize(answers: Answer[]): SummaryItem[] {
  const labels: Record<string, string> = { emergency: "Emergency symptoms", age: "Age group", ontario: "Currently in Ontario", concern: "Selected concern", symptoms: "Symptoms", duration: "Duration and changes", severity: "Severity", warnings: "Warning signs", details: "Additional details", pregnancy: "Pregnancy / breastfeeding", medicines: "Medicines and supplements", allergies: "Allergies and reactions", conditions: "Health history", tried: "Treatments tried" };
  return answers.map(a => ({ questionId: a.questionId, label: labels[a.questionId] ?? "Safety clarification", value: getQuestion(a.questionId, answers)?.options?.find(o => o.value === a.value)?.label ?? a.value }));
}

export function validateAnswers(input: unknown): Answer[] {
  if (!Array.isArray(input) || input.length > MAX_ANSWERS) throw new Error("Invalid assessment answers.");
  const accepted: Answer[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof item.questionId !== "string" || typeof item.value !== "string") throw new Error("Each answer needs a question and a text value.");
    if (!item.value.trim() || item.value.length > MAX_ANSWER_LENGTH) throw new Error(`Please keep each answer between 1 and ${MAX_ANSWER_LENGTH} characters.`);
    if (assess(accepted)) throw new Error("This assessment has ended. Start a new assessment to make changes.");
    const question = nextQuestions(accepted).find(q => q.id === item.questionId);
    if (!question) throw new Error("Answers are out of order. Please restart the assessment.");
    if (question.kind === "choice" && !question.options?.some(o => o.value === item.value)) throw new Error("Please choose one of the available answers.");
    accepted.push({ questionId: item.questionId, value: item.value.trim() });
  }
  return accepted;
}
