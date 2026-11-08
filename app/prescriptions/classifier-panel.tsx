"use client";

import { useEffect, useRef, useState } from "react";
import type { SyntheticClassificationResult } from "@/lib/prescription/classification";

type Props = { file: File | null; consent: boolean; disabled: boolean };
type RunState =
  | { stage: "idle" | "loading" | "classifying" }
  | { stage: "complete"; result: SyntheticClassificationResult }
  | { stage: "error"; message: string };

export default function ClassifierPanel({ file, consent, disabled }: Props) {
  const [run, setRun] = useState<RunState>({ stage: "idle" });
  const request = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => request.current?.abort(), []);

  const busy = run.stage === "loading" || run.stage === "classifying";
  const result = run.stage === "complete" ? run.result : null;

  async function classify() {
    if (!file || !consent || disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRun({ stage: "loading" });

    try {
      const { classifyDemoInBrowser } = await import("@/lib/prescription/browser-classifier").catch(() => {
        throw new Error("The classifier could not load. Check your connection and try again.");
      });
      if (controller.signal.aborted) return;
      const data = await classifyDemoInBrowser(file, {
        signal: controller.signal,
        onStage: stage => {
          if (!controller.signal.aborted) setRun({ stage });
        },
      });
      if (!controller.signal.aborted) {
        setRun({ stage: "complete", result: data });
        requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRun({
          stage: "error",
          message: error instanceof Error ? error.message : "Classification failed. Try the sample again.",
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return <section id="rx-classifier" className="rx-classifier" aria-labelledby="rx-classifier-title">
    <div className="rx-classifier-heading">
      <h2 id="rx-classifier-title" tabIndex={-1}>Synthetic alteration demo</h2>
      <p>See whether the model recognizes an edit in a fictional prescription.</p>
    </div>
    <div className="rx-classifier-body">
      <div className="rx-classifier-controls">
        <p className="rx-classifier-description">Classification runs on your device. The first run downloads the model (about 45 MB) and its browser runtime.</p>
        <button type="button" className="rx-classifier-run" onClick={classify} disabled={!file || !consent || disabled || busy}>
          {busy && <i className="rx-spinner" aria-hidden="true" />}
          {run.stage === "loading" ? "Loading classifier…" : run.stage === "classifying" ? "Classifying sample…" : "Classify demo sample"}
        </button>
        {!file ? <p className="rx-classifier-input-hint"><a href="#rx-demo-samples">Choose the original or altered demo sample</a> to get started.</p>
          : !consent ? <p className="rx-classifier-input-hint"><a href="#rx-fictional-consent">Confirm the fictional image above</a> to continue.</p>
          : null}
        <p className="rx-sr-only" role="status">
          {run.stage === "loading" ? "Loading the classifier on this device." : run.stage === "classifying" ? "Classifying the selected sample." : ""}
        </p>
        {run.stage === "error" && <p className="rx-classifier-error" role="alert">{run.message}</p>}
      </div>
      <div className="rx-classifier-output" ref={resultRef} tabIndex={-1} aria-busy={busy}>
        {result ? <>
          <p className="rx-classifier-prediction">Model prediction <strong>{result.predictedLabel === "original_demo" ? "Original sample" : "Altered sample"}</strong></p>
          <dl className="rx-classifier-scores" aria-label="Classifier model scores">
            <div><dt>Original sample score</dt><dd>{result.scores.original_demo.toFixed(4)}</dd></div>
            <div><dt>Altered sample score</dt><dd>{result.scores.altered_demo.toFixed(4)}</dd></div>
          </dl>
          <p className="rx-classifier-score-note">The higher score is the model’s prediction for this sample.</p>
          <p className="rx-classifier-model">Model {result.modelVersion} · {Math.round(result.durationMs).toLocaleString()} ms</p>
        </> : <div className="rx-classifier-empty">
          <h3>No model prediction yet</h3>
          <p>Run the classifier to see both sample scores.</p>
        </div>}
        <div className="rx-classifier-review">
          <strong>For fictional samples only</strong>
          <p>The model missed 17 of 48 synthetic alterations in testing. A pharmacist must verify the authenticity of real prescriptions.</p>
        </div>
      </div>
    </div>
  </section>;
}
