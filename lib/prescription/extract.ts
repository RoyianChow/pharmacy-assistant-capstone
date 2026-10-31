import type { OcrLine, OcrResult, PrescriptionCheck, PrescriptionField, PrescriptionFieldKey, PrescriptionResult } from "./types";

const definitions: { key: PrescriptionFieldKey; label: string; pattern: RegExp }[] = [
  { key: "patient", label: "Patient name", pattern: /^(?:patient(?: name)?)\s*[:：]\s*(.*)$/i },
  { key: "dateOfBirth", label: "Date of birth", pattern: /^(?:date of birth|dob|birth date)\s*[:：]\s*(.*)$/i },
  { key: "dateIssued", label: "Date issued", pattern: /^(?:date issued|issue date|prescription date|date)\s*[:：]\s*(.*)$/i },
  { key: "prescriber", label: "Prescriber", pattern: /^(?:prescriber(?: name)?|physician(?: name)?)\s*[:：]\s*(.*)$/i },
  { key: "licence", label: "Prescriber licence", pattern: /^(?:licen[cs]e(?: number)?|registration(?: number)?|cpso(?: number)?)\s*[:：]\s*(.*)$/i },
  { key: "clinicPhone", label: "Clinic phone", pattern: /^(?:clinic phone|prescriber phone|phone|tel)\s*[:：]\s*(.*)$/i },
  { key: "medication", label: "Medication", pattern: /^(?:medication|drug(?: name)?)\s*[:：]\s*(.*)$/i },
  { key: "strength", label: "Strength", pattern: /^strength\s*[:：]\s*(.*)$/i },
  { key: "directions", label: "Directions", pattern: /^(?:directions|sig)\s*[:：]\s*(.*)$/i },
  { key: "quantity", label: "Quantity", pattern: /^(?:quantity|qty)\s*[:：]\s*(.*)$/i },
  { key: "refills", label: "Refills", pattern: /^(?:refills|repeats)\s*[:：]\s*(.*)$/i },
  { key: "signature", label: "Signature text", pattern: /^signature\s*[:：]\s*(.*)$/i },
];

// Join separately detected label/value boxes only when they occupy the same row.
// This does not infer clinical meaning or fill missing information from other fields.
function readingRows(lines: OcrLine[]): OcrLine[] {
  const rows: { top: number; bottom: number; parts: OcrLine[] }[] = [];
  for (const line of [...lines].sort((a, b) => Math.min(...a.box.map(p => p[1])) - Math.min(...b.box.map(p => p[1])))) {
    const top = Math.min(...line.box.map(p => p[1])), bottom = Math.max(...line.box.map(p => p[1]));
    const row = rows.find(item => Math.min(item.bottom, bottom) - Math.max(item.top, top) > Math.min(item.bottom - item.top, bottom - top) * 0.6);
    if (row) row.parts.push(line); else rows.push({ top, bottom, parts: [line] });
  }
  return rows.flatMap(row => {
    const parts = row.parts.sort((a, b) => Math.min(...a.box.map(p => p[0])) - Math.min(...b.box.map(p => p[0])));
    const groups: OcrLine[][] = [];
    for (const part of parts) {
      // A second labeled field starts a new column; only unlabeled boxes can
      // continue the preceding field's value on this row.
      if (!groups.length || definitions.some(definition => definition.pattern.test(part.text.trim()))) groups.push([part]);
      else groups[groups.length - 1].push(part);
    }
    return groups.map(group => ({ text: group.map(part => part.text).join(" "), confidence: Math.min(...group.map(part => part.confidence)), box: group[0].box }));
  });
}

export function extractPrescription(ocr: OcrResult): PrescriptionResult {
  const rows = readingRows(ocr.lines);
  const checks: PrescriptionCheck[] = [];
  const fields: PrescriptionField[] = definitions.map(definition => {
    const matches = rows.flatMap(row => {
      const match = row.text.trim().match(definition.pattern);
      return match?.[1]?.trim() ? [{ value: match[1].trim(), row }] : [];
    });
    const distinct = [...new Set(matches.map(match => match.value))];
    const match = distinct.length === 1 ? matches[0] : undefined;
    if (distinct.length > 1) checks.push({ code: `ambiguous_${definition.key}`, severity: "warning", message: `More than one ${definition.label.toLowerCase()} was found. Compare the original document; no value was selected automatically.` });
    return { key: definition.key, label: definition.label, value: match?.value ?? null, confidence: match?.row.confidence ?? null, sourceText: match?.row.text ?? null, needsReview: !match || match.row.confidence < 0.9 };
  });
  const text = ocr.lines.map(line => line.text).join("\n");
  const isDemo = /\bdemo\b|not valid for dispensing|fictional|do not administer/i.test(text);
  if (isDemo) checks.unshift({ code: "demo_document", severity: "warning", message: "Demonstration document detected. Not valid for dispensing." });
  if (!ocr.lines.length) checks.push({ code: "no_text", severity: "warning", message: "No text was recognized. Try a clearer, upright image of the complete document." });
  const missing = fields.filter(field => !field.value);
  if (missing.length) checks.push({ code: "missing_fields", severity: "warning", message: `Not reliably located: ${missing.map(field => field.label.toLowerCase()).join(", ")}. These may be missing, unlabeled, or unreadable; check the original.` });
  if (ocr.lines.some(line => line.confidence < 0.9)) checks.push({ code: "low_confidence", severity: "warning", message: "Some text has low OCR confidence. Compare names, decimal points, units, quantities, and directions carefully." });
  const signature = fields.find(field => field.key === "signature")?.value;
  if (!signature || /unsigned|demo|not signed/i.test(signature)) checks.push({ code: "signature_unverified", severity: "warning", message: "A prescriber signature has not been verified. Recognizing signature text does not authenticate a prescription." });
  checks.push({ code: "manual_review", severity: "info", message: "Pharmacist review is required for every document. OCR and field checks do not establish authenticity, legal validity, dose suitability, allergies, interactions, or authorization to dispense." });
  return { ocr, fields, checks, isDemo, reviewRequired: true };
}
