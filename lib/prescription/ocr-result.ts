import type { OcrResult } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseOcrResult(value: unknown): OcrResult {
  if (!record(value) || value.engine !== "PaddleOCR" || typeof value.model !== "string" || value.model.length > 200 ||
    !record(value.image) || !Number.isSafeInteger(value.image.width) || !Number.isSafeInteger(value.image.height) ||
    Number(value.image.width) < 1 || Number(value.image.height) < 1 || Number(value.image.width) * Number(value.image.height) > 16_000_000 ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 ||
    !Array.isArray(value.lines) || value.lines.length > 500) throw new Error("Invalid OCR result");

  const width = Number(value.image.width), height = Number(value.image.height);
  let characters = 0;
  const lines = value.lines.map(line => {
    if (!record(line) || typeof line.text !== "string" || line.text.length > 2000 ||
      typeof line.confidence !== "number" || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1 ||
      !Array.isArray(line.box) || line.box.length !== 4 || !line.box.every(point => Array.isArray(point) && point.length === 2 &&
        point.every(n => typeof n === "number" && Number.isFinite(n)) && point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height)) throw new Error("Invalid OCR line");
    characters += line.text.length;
    return { text: line.text, confidence: line.confidence, box: line.box as number[][] };
  });
  if (characters > 60_000) throw new Error("OCR result is too large");
  return { engine: "PaddleOCR", model: value.model, lines, durationMs: value.durationMs, image: { width, height } };
}
