export type ResearchClassificationResult = {
  schemaVersion: 1;
  modelVersion: string;
  predictedLabel: "real" | "fake";
  scores: { real: number; fake: number };
  reviewRequired: true;
  validationStatus: "research_only";
  durationMs: number;
};

export type SyntheticClassificationResult = {
  schemaVersion: 2;
  mode: "synthetic_demo";
  modelVersion: string;
  predictedLabel: "original_demo" | "altered_demo";
  scores: { original_demo: number; altered_demo: number };
  reviewRequired: true;
  validationStatus: "synthetic_demo_only";
  authenticityAssessed: false;
  durationMs: number;
};

export type ClassificationResult = ResearchClassificationResult | SyntheticClassificationResult;
export type ClassifierAvailability = { configured: boolean; mode: "research" | "synthetic_demo" };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function invalid(): never { throw new Error("The classifier returned an incomplete result."); }

export function parseClassifierAvailability(value: unknown): ClassifierAvailability {
  if (!object(value) || typeof value.configured !== "boolean" ||
    (value.mode !== undefined && value.mode !== "research" && value.mode !== "synthetic_demo")) invalid();
  return { configured: value.configured, mode: value.mode === "synthetic_demo" ? "synthetic_demo" : "research" };
}

// Project only the public contract; never pass provider diagnostics or document data through.
export function parseClassificationResult(value: unknown): ClassificationResult {
  if (!object(value) || value.reviewRequired !== true ||
    typeof value.modelVersion !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.modelVersion) ||
    !object(value.scores) ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 120_000) invalid();
  if (value.schemaVersion === 1) {
    if (value.validationStatus !== "research_only" || !score(value.scores.real) || !score(value.scores.fake) ||
      Math.abs(value.scores.real + value.scores.fake - 1) > 0.00001) invalid();
    const label = value.scores.real > value.scores.fake ? "real" : "fake";
    if (value.predictedLabel !== label) invalid();
    return {
      schemaVersion: 1, modelVersion: value.modelVersion, predictedLabel: label,
      scores: { real: value.scores.real, fake: value.scores.fake },
      reviewRequired: true, validationStatus: "research_only", durationMs: value.durationMs,
    };
  }
  if (value.schemaVersion === 2) {
    if (value.mode !== "synthetic_demo" || value.validationStatus !== "synthetic_demo_only" || value.authenticityAssessed !== false ||
      !score(value.scores.original_demo) || !score(value.scores.altered_demo) ||
      Math.abs(value.scores.original_demo + value.scores.altered_demo - 1) > 0.00001) invalid();
    const label = value.scores.original_demo > value.scores.altered_demo ? "original_demo" : "altered_demo";
    if (value.predictedLabel !== label) invalid();
    return {
      schemaVersion: 2, mode: "synthetic_demo", modelVersion: value.modelVersion, predictedLabel: label,
      scores: { original_demo: value.scores.original_demo, altered_demo: value.scores.altered_demo },
      reviewRequired: true, validationStatus: "synthetic_demo_only", authenticityAssessed: false, durationMs: value.durationMs,
    };
  }
  return invalid();
}
