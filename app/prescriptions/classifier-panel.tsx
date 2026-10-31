"use client";

import { useEffect, useRef, useState } from "react";
import { parseClassifierAvailability, parseClassificationResult, type ClassificationResult } from "@/lib/prescription/classification";

type ClassifierStatus = "checking" | "configured" | "unconfigured" | "error";
type Props = { file: File | null; consent: boolean; disabled: boolean };

class ClassificationRequestError extends Error {}

function errorForStatus(status: number) {
  if (status === 401) return "Your staff session has ended. Sign in again before requesting a prediction.";
  if (status === 403) return "An approved staff account and the fictional-data acknowledgement are required.";
  if (status === 413) return "Choose a PNG or JPEG image no larger than 4 MB.";
  if ([400, 415, 422].includes(status)) return "This image could not be classified. Choose a clear PNG or JPEG of a fictional prescription.";
  if (status === 429) return "The classification service is busy. Wait a moment, then try again.";
  if (status === 503) return "The classification model is unavailable. Your image is still selected; please try again when the service is available.";
  if (status === 504) return "The classification request took too long. Your image is still selected; please try again.";
  return "The classification service could not complete this prediction. Please try again.";
}

export default function ClassifierPanel({ file, consent, disabled }: Props) {
  const [status, setStatus] = useState<ClassifierStatus>("checking");
  const [statusKey, setStatusKey] = useState(0);
  const [prediction, setPrediction] = useState<{ file: File; data: ClassificationResult } | null>(null);
  const [failure, setFailure] = useState<{ file: File; message: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const request = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    async function checkConfiguration() {
      try {
        const response = await fetch("/api/prescriptions/classify", { cache: "no-store", redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error("Configuration unavailable");
        const availability = parseClassifierAvailability(await response.json());
        if (active && !controller.signal.aborted) setStatus(availability.configured ? "configured" : "unconfigured");
      } catch { if (active) setStatus("error"); }
      finally { clearTimeout(timer); }
    }
    void checkConfiguration();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [statusKey]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) { setPrediction(null); setFailure(null); setPendingFile(null); }
    });
    return () => {
      active = false;
      request.current?.abort();
      request.current = null;
    };
  }, [file]);

  const result = prediction && prediction.file === file ? prediction.data : null;
  const error = failure && failure.file === file ? failure.message : "";
  const busy = !!file && pendingFile === file;

  async function classify() {
    if (!file || !consent || disabled || busy || status !== "configured" || request.current) return;
    const selectedFile = file;
    const controller = new AbortController();
    request.current = controller;
    setPrediction(null); setFailure(null); setPendingFile(selectedFile);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    try {
      const response = await fetch("/api/prescriptions/classify", {
        method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": selectedFile.type, "X-Demo-Consent": "true" }, body: selectedFile,
      });
      if (!response.ok) throw new ClassificationRequestError(errorForStatus(response.status));
      let data: ClassificationResult;
      try { data = parseClassificationResult(await response.json()); }
      catch { throw new ClassificationRequestError("The model returned an incomplete or invalid result. No prediction was accepted. Please try again."); }
      if (request.current === controller && !controller.signal.aborted) {
        setPrediction({ file: selectedFile, data });
        requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
      }
    } catch (err) {
      if (request.current === controller) setFailure({
        file: selectedFile,
        message: timedOut ? "The classification request took too long. Your image is still selected; please try again." : err instanceof ClassificationRequestError ? err.message : "We couldn’t reach the classification service. Check your connection and try again.",
      });
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setPendingFile(null); }
    }
  }

  function checkAgain() { setStatus("checking"); setStatusKey(key => key + 1); }

  return <section className="rx-classifier" aria-labelledby="rx-classifier-title" aria-busy={busy}>
    <div className="rx-classifier-heading"><div><p className="rx-eyebrow">IMAGE CLASSIFICATION · RESEARCH</p><h2 id="rx-classifier-title">Real / fake classification</h2><p>A separate model can classify the selected fictional image using its training labels.</p></div><span className="rx-classifier-research">RESEARCH ONLY</span></div>
    <div className="rx-classifier-body">
      <div className="rx-classifier-controls">
        <div className={`rx-classifier-status rx-classifier-status-${status}`} role="status"><i aria-hidden="true" /><strong>{status === "checking" ? "Checking model configuration…" : status === "configured" ? "Model configured" : status === "unconfigured" ? "Model not connected" : "Model status unavailable"}</strong></div>
        {status === "unconfigured" ? <p className="rx-classifier-description">A trained model has not been connected. Verified, labelled real/fake examples, training, and evaluation are needed before this feature can provide meaningful predictions.</p> : status === "error" ? <p className="rx-classifier-description">The model configuration could not be checked. Retry the check to enable a prediction request.</p> : <p className="rx-classifier-description">Use the image selected above to request a research prediction. Text extraction is optional and does not determine this model’s result.</p>}
        {status !== "checking" && <button type="button" className="rx-classifier-recheck" onClick={checkAgain} disabled={busy} aria-label="Check classifier configuration again">Check model configuration again</button>}
        <button type="button" className="rx-classifier-run" onClick={classify} disabled={!file || !consent || disabled || busy || status !== "configured"}>{busy ? <><i className="rx-spinner" aria-hidden="true" />Classifying image…</> : <>Classify selected image <span aria-hidden="true">↗</span></>}</button>
        <p className="rx-classifier-input-hint">{!file ? "Choose a fictional prescription image above." : !consent ? "Confirm the fictional-data acknowledgement above to continue." : "The selected image is sent to the classifier when you run this model."}</p>
        {busy && <p className="rx-classifier-wait" role="status">Waiting for a model response. This can take up to 45 seconds.</p>}
        {error && <p className="rx-classifier-error" role="alert">{error}</p>}
      </div>

      <div className="rx-classifier-output" ref={resultRef} tabIndex={-1}>
        {result ? <>
          <p className="rx-classifier-prediction">Model prediction: <strong>{result.predictedLabel === "real" ? "Real" : "Fake"}</strong></p>
          <dl className="rx-classifier-scores" aria-label="Classifier model scores"><div><dt>Real model score</dt><dd>{result.scores.real.toFixed(4)}</dd></div><div><dt>Fake model score</dt><dd>{result.scores.fake.toFixed(4)}</dd></div></dl>
          <p className="rx-classifier-score-note">These are model scores, not probabilities that the prescription is authentic. The model can be wrong.</p>
          <p className="rx-classifier-model">Model {result.modelVersion} · {(result.durationMs / 1000).toFixed(1)} seconds · Research only</p>
        </> : <div className="rx-classifier-empty"><span aria-hidden="true">?</span><h3>No model prediction yet</h3><p>Real and fake scores will appear only after a connected model returns a valid result.</p></div>}
        <div className="rx-classifier-review"><strong>Pharmacist verification is required.</strong><p>A prediction cannot prove authenticity or authorize dispensing. Confirm the original prescription, prescriber, and clinical appropriateness separately.</p></div>
      </div>
    </div>
    <p className="rx-classifier-retention">Classification results stay on this page and clear when you change the image or leave.</p>
  </section>;
}
