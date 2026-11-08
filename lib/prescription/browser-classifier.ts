import sampleManifest from "@/public/demo/classifier/manifest.json";
import type { SyntheticClassificationResult } from "./classification";
import { MODEL_SIDE, prepareClassifierInput } from "./browser-classifier-input";
import { MAX_PRESCRIPTION_BYTES } from "./types";

const MODEL_VERSION = "resnet18-caf5359a14d1";
const MODEL_HASH = "caf5359a14d1b47297f8d1a66a0786c3d2b8c80ae1dd089414cccf88ba7ee215";
const MODEL_URL = `/demo/classifier/${MODEL_VERSION}.onnx`;
const ALLOWED_HASHES = new Set([
  sampleManifest.samples.original_demo.sha256,
  sampleManifest.samples.altered_demo.sha256,
]);

type BrowserOptions = {
  signal?: AbortSignal;
  onStage?: (stage: "loading" | "classifying") => void;
};

async function sha256(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}

async function openModel() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  // The /wasm ESM entry bundles its JS loader. Point that loader at the matching binary.
  ort.env.wasm.wasmPaths = {
    wasm: new URL(`/demo/classifier/ort/${ort.env.versions.web}/ort-wasm-simd-threaded.wasm`, window.location.origin).href,
  };
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error("Model download failed.");
  const bytes = await response.arrayBuffer();
  if (await sha256(bytes) !== MODEL_HASH) throw new Error("Unexpected model version.");
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"] });
  return { ort, session };
}

// Share only the model across clicks. Individual image reads and tensors belong to each call.
let model: ReturnType<typeof openModel> | undefined;
function getModel() {
  model ??= openModel().catch(() => {
    model = undefined;
    throw new Error("The demo model could not load. Check your connection and retry. If the problem continues, refresh the page.");
  });
  return model;
}

async function imagePixels(file: Blob): Promise<ImageData> {
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error();
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error("Your browser could not read this sample image. Load the demo again and retry.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function classifyDemoInBrowser(
  file: Blob, { signal, onStage }: BrowserOptions = {},
): Promise<SyntheticClassificationResult> {
  signal?.throwIfAborted();
  if (!globalThis.crypto?.subtle || typeof WebAssembly === "undefined") {
    throw new Error("Open the demo over HTTPS or localhost in a browser that supports WebAssembly.");
  }
  if (file.size > MAX_PRESCRIPTION_BYTES || !ALLOWED_HASHES.has(await sha256(await file.arrayBuffer()))) {
    throw new Error("This demo accepts only its supplied sample images. Choose Load original demo or Load altered demo, then try again.");
  }
  signal?.throwIfAborted();
  onStage?.("loading");
  const { ort, session } = await getModel();
  signal?.throwIfAborted();
  onStage?.("classifying");
  const started = performance.now();
  const pixels = await imagePixels(file);
  signal?.throwIfAborted();
  const input = new ort.Tensor("float32", prepareClassifierInput(pixels), [1, 3, MODEL_SIDE, MODEL_SIDE]);
  try {
    const { logits } = await session.run({ image: input }, ["logits"]);
    try {
      signal?.throwIfAborted();
      if (logits.type !== "float32" || logits.dims.length !== 2 || logits.dims[0] !== 1 || logits.dims[1] !== 2) {
        throw new Error();
      }
      const [original, altered] = logits.data as Float32Array;
      if (!Number.isFinite(original) || !Number.isFinite(altered)) throw new Error();
      const max = Math.max(original, altered);
      const originalExp = Math.exp(original - max);
      const alteredExp = Math.exp(altered - max);
      const total = originalExp + alteredExp;
      return {
        schemaVersion: 2, mode: "synthetic_demo", validationStatus: "synthetic_demo_only",
        modelVersion: MODEL_VERSION, authenticityAssessed: false, reviewRequired: true,
        predictedLabel: original > altered ? "original_demo" : "altered_demo",
        scores: { original_demo: originalExp / total, altered_demo: alteredExp / total },
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      logits.dispose();
    }
  } catch {
    signal?.throwIfAborted();
    throw new Error("Your browser could not finish the prediction. Refresh the page and try again.");
  } finally {
    input.dispose();
  }
}
