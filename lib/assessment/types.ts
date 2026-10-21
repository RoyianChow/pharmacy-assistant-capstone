export type Mode = "demo" | "guided" | "jev" | "fallback";
export type Section = "Getting started" | "Your symptoms" | "Health history";
export type Question = {
  id: string;
  section: Section;
  text: string;
  hint?: string;
  kind: "choice" | "text";
  options?: { value: string; label: string }[];
};
export type Answer = { questionId: string; value: string };
export type SummaryItem = { questionId: string; label: string; value: string };
export type AssessmentResult = {
  kind: "emergency" | "urgent" | "pharmacist" | "outside_scope" | "incomplete";
  title: string;
  message: string;
  prescription: string;
  nextSteps: string[];
  sources: { title: string; url: string }[];
};
export type ChatResponse = {
  mode: Mode;
  notice?: string;
  reply?: string;
  retryAnswer?: boolean;
  question?: Question;
  result?: AssessmentResult;
  progress: { answered: number; total: number };
  summary: SummaryItem[];
};
