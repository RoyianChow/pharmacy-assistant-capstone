export type OcrLine = { text: string; confidence: number; box: number[][] };
export type OcrResult = {
  engine: "PaddleOCR";
  model: string;
  lines: OcrLine[];
  durationMs: number;
  image: { width: number; height: number };
};

export type PrescriptionFieldKey = "patient" | "dateOfBirth" | "dateIssued" | "prescriber" | "licence" | "clinicPhone" | "medication" | "strength" | "directions" | "quantity" | "refills" | "signature";
export type PrescriptionField = {
  key: PrescriptionFieldKey;
  label: string;
  value: string | null;
  confidence: number | null;
  sourceText: string | null;
  needsReview: boolean;
};
export type PrescriptionCheck = { code: string; severity: "warning" | "info"; message: string };
export type PrescriptionResult = {
  ocr: OcrResult;
  fields: PrescriptionField[];
  checks: PrescriptionCheck[];
  isDemo: boolean;
  reviewRequired: true;
};
export type PrescriptionAvailability = { configured: boolean; maxBytes: number; acceptedTypes: string[] };

export const MAX_PRESCRIPTION_BYTES = 4 * 1024 * 1024;
export const PRESCRIPTION_TYPES = ["image/png", "image/jpeg"];
