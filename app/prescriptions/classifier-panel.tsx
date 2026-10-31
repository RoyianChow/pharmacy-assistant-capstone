"use client";

import { useEffect, useRef, useState } from "react";
import { parseClassifierAvailability, parseClassificationResult, type ClassificationResult, type ClassifierAvailability } from "@/lib/prescription/classification";

type ClassifierStatus = "checking" | "configured" | "unconfigured" | "error";
type Props = { file: File | null; consent: boolean; disabled: boolean };

class ClassificationRequestError extends Error {}

function errorForStatus(status: number, syntheticDemo: boolean) {
  if (status === 401) return "Your staff session has ended. Sign in again before requesting a prediction.";
  if (status === 403) return "An approved staff account and the fictional-data acknowledgement are required.";
  if (status === 413) return "Choose a PNG or JPEG image no larger than 4 MB.";
  if (status === 422 && syntheticDemo) return "This demo accepts only its supplied sample images. Use Load original demo or Load altered demo above, then try again. The Ontario OCR sample is for text extraction.";
  if ([400, 415, 422].includes(status)) return "This image could not be classified. Choose a valid PNG or JPEG image.";
  if (status === 429) return "The demo’s monthly prediction limit has been reached. No prediction was made. Predictions become available again next month.";
  if (status === 503) return "The classification model is unavailable. Your image is still selected; please try again when the service is available.";
  if (status === 504) return "The classification request took too long. Your image is still selected; please try again.";
  return "The classification service could not complete this prediction. Please try again.";
}

export default function ClassifierPanel({ file, consent, disabled }: Props) {
  const [status, setStatus] = useState<ClassifierStatus>("checking");
  const [mode, setMode] = useState<ClassifierAvailability["mode"]>("synthetic_demo");
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
        if (active && !controller.signal.aborted) { setStatus(availability.configured ? "configured" : "unconfigured"); setMode(availability.mode); }
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
  const researchMode = result ? result.schemaVersion === 1 : status === "configured" && mode === "research";
  const syntheticResult = result?.schemaVersion === 2 ? result : null;
  const researchResult = result?.schemaVersion === 1 ? result : null;

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
      if (!response.ok) throw new ClassificationRequestError(errorForStatus(response.status, mode === "synthetic_demo"));
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
    <div className="rx-classifier-heading"><div><p className="rx-eyebrow">{researchMode ? "IMAGE CLASSIFICATION · RESEARCH" : "SYNTHETIC DOCUMENTS · MODEL DEMO"}</p><h2 id="rx-classifier-title">{researchMode ? "Real / fake research classification" : "Synthetic alteration demo"}</h2><p>{researchMode ? "A separate model classifies the selected fictional image using its research labels." : "Classify the supplied original and altered samples. Prescription authenticity is not assessed."}</p></div><span className="rx-classifier-research">{researchMode ? "RESEARCH ONLY" : "SYNTHETIC SAMPLES ONLY"}</span></div>
    <div className="rx-classifier-body">
      <div className="rx-classifier-controls">
        <div className={`rx-classifier-status rx-classifier-status-${status}`} role="status"><i aria-hidden="true" /><strong>{status === "checking" ? "Checking model configuration…" : status === "configured" ? "Model configured" : status === "unconfigured" ? "Model not connected" : "Model status unavailable"}</strong></div>
        {status === "unconfigured" ? <p className="rx-classifier-description">The synthetic demo model is not connected yet. You can preview the original and altered samples above. This demonstration is limited to generated images and cannot identify genuine or forged prescriptions.</p> : status === "error" ? <p className="rx-classifier-description">The model configuration could not be checked. Retry the check to enable a prediction request.</p> : <p className="rx-classifier-description">{researchMode ? "Use the selected fictional image to request a research prediction." : "Use Load original demo or Load altered demo above. Only these two supplied images are accepted by this demonstration."} Text extraction is optional and does not determine this model’s result.</p>}
        {status !== "checking" && <button type="button" className="rx-classifier-recheck" onClick={checkAgain} disabled={busy} aria-label="Check classifier configuration again">Check model configuration again</button>}
        <button type="button" className="rx-classifier-run" onClick={classify} disabled={!file || !consent || disabled || busy || status !== "configured"}>{busy ? <><i className="rx-spinner" aria-hidden="true" />Classifying image…</> : <>{researchMode ? "Classify selected image" : "Classify demo sample"} <span aria-hidden="true">↗</span></>}</button>
        <p className="rx-classifier-input-hint">{!file ? researchMode ? "Choose a fictional prescription image above." : "Load one of the two classifier demo samples above." : !consent ? "Confirm the fictional-data acknowledgement above to continue." : "The selected image is sent to the classifier when you run this model."}</p>
        {busy && <p className="rx-classifier-wait" role="status">Waiting for a model response. This can take up to 45 seconds.</p>}
        {error && <p className="rx-classifier-error" role="alert">{error}</p>}
      </div>

      <div className="rx-classifier-output" ref={resultRef} tabIndex={-1}>
        {result ? <>
          <p className="rx-classifier-prediction">Model prediction: <strong>{syntheticResult ? syntheticResult.predictedLabel === "original_demo" ? "Original sample" : "Altered sample" : researchResult?.predictedLabel === "real" ? "Real" : "Fake"}</strong></p>
          <dl className="rx-classifier-scores" aria-label="Classifier model scores"><div><dt>{syntheticResult ? "Original sample score" : "Real model score"}</dt><dd>{(syntheticResult ? syntheticResult.scores.original_demo : researchResult!.scores.real).toFixed(4)}</dd></div><div><dt>{syntheticResult ? "Altered sample score" : "Fake model score"}</dt><dd>{(syntheticResult ? syntheticResult.scores.altered_demo : researchResult!.scores.fake).toFixed(4)}</dd></div></dl>
          <p className="rx-classifier-score-note">{syntheticResult ? "These scores compare synthetic original and altered classes. They are not probabilities of prescription authenticity. The model can be wrong." : "These are model scores, not probabilities that the prescription is authentic. The model can be wrong."}</p>
          <p className="rx-classifier-model">Model {result.modelVersion} · {result.durationMs < 1000 ? `${Math.round(result.durationMs)} ms` : `${(result.durationMs / 1000).toFixed(1)} seconds`} · {syntheticResult ? "Synthetic demo only" : "Research only"}</p>
        </> : <div className="rx-classifier-empty"><span aria-hidden="true">?</span><h3>No model prediction yet</h3><p>{researchMode ? "Real and fake scores" : "Original and altered sample scores"} will appear only after a connected model returns a valid result.</p></div>}
        <div className="rx-classifier-review"><strong>{researchMode ? "Pharmacist verification is required." : "Authenticity is not assessed."}</strong><p>{researchMode ? "A prediction cannot prove authenticity or authorize dispensing. Confirm the original prescription, prescriber, and clinical appropriateness separately." : "This result is only for synthetic samples. It cannot verify a real prescription or authorize dispensing; pharmacist verification remains required."}</p></div>
      </div>
    </div>
    <p className="rx-classifier-retention">Classification results stay on this page and clear when you change the image or leave.</p>
  </section>;
}
