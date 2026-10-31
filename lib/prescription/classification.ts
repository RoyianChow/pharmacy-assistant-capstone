export type ClassificationResult = {
  schemaVersion: 1;
  modelVersion: string;
  predictedLabel: "real" | "fake";
  scores: { real: number; fake: number };
  reviewRequired: true;
  validationStatus: "research_only";
  durationMs: number;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function invalid(): never { throw new Error("The classifier returned an incomplete result."); }

export function parseClassifierAvailability(value: unknown): { configured: boolean } {
  if (!object(value) || typeof value.configured !== "boolean") invalid();
  return { configured: value.configured };
}

// Project only the public contract; never pass provider diagnostics or document data through.
export function parseClassificationResult(value: unknown): ClassificationResult {
  if (!object(value) || value.schemaVersion !== 1 || value.reviewRequired !== true || value.validationStatus !== "research_only" ||
    typeof value.modelVersion !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.modelVersion) ||
    !["real", "fake"].includes(String(value.predictedLabel)) || !object(value.scores) ||
    !score(value.scores.real) || !score(value.scores.fake) || Math.abs(value.scores.real + value.scores.fake - 1) > 0.00001 ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 120_000) invalid();
  const label = value.scores.real > value.scores.fake ? "real" : "fake";
  if (value.predictedLabel !== label) invalid();
  return {
    schemaVersion: 1, modelVersion: value.modelVersion, predictedLabel: label,
    scores: { real: value.scores.real, fake: value.scores.fake },
    reviewRequired: true, validationStatus: "research_only", durationMs: value.durationMs,
  };
}
