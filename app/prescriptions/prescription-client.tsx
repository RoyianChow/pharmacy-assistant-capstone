"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SiteBrand from "../components/site-brand";
import { MAX_PRESCRIPTION_BYTES, PRESCRIPTION_TYPES, type PrescriptionAvailability, type PrescriptionResult } from "@/lib/prescription/types";
import { parseAvailability, parsePrescriptionResponse, requestError } from "./response";
import { recordPrescriptionActivity } from "@/lib/prescription/activity";
import ClassifierPanel from "./classifier-panel";

const DEMO_IMAGES = {
  ontario: { path: "/demo/ontario-demo-prescription.png", name: "ontario-demo-prescription.png" },
  original: { path: "/demo/classifier/original.png", name: "classifier-original-demo.png" },
  altered: { path: "/demo/classifier/altered.png", name: "classifier-altered-demo.png" },
} as const;

function ScanIcon({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5H5v6m16-6h6v6M5 21v6h6m16-6v6h-6M11 11h10M11 16h10M11 21h6" /></svg>;
}

export default function PrescriptionClient() {
  const [availability, setAvailability] = useState<PrescriptionAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityKey, setAvailabilityKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoBeingLoaded, setDemoBeingLoaded] = useState<keyof typeof DEMO_IMAGES | null>(null);
  const loadingDemo = demoBeingLoaded !== null;
  const [error, setError] = useState("");
  const [result, setResult] = useState<PrescriptionResult | null>(null);
  const [compared, setCompared] = useState<Set<string>>(new Set());
  const imageUrl = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const demoRequest = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      try {
        const response = await fetch("/api/prescriptions/verify", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(requestError(response.status));
        const data = parseAvailability(await response.json());
        if (!controller.signal.aborted) { setAvailability(data); setAvailabilityError(""); }
      } catch (err) {
        if (!disposed) setAvailabilityError(controller.signal.aborted ? "The extraction service could not be reached. Please check again." : err instanceof Error && !["SyntaxError", "TypeError"].includes(err.name) ? err.message : "The extraction service could not be checked. Please try again.");
      } finally { clearTimeout(timer); }
    }
    let disposed = false;
    void load();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [availabilityKey]);
  useEffect(() => () => {
    request.current?.abort(); request.current = null;
    demoRequest.current?.abort(); demoRequest.current = null;
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
  }, []);

  function selectFile(next: File | null) {
    setResult(null); setCompared(new Set()); setError(""); setConsent(false);
    if (imageUrl.current) { URL.revokeObjectURL(imageUrl.current); imageUrl.current = ""; }
    setPreview(""); setFile(null);
    if (!next) return;
    if (!PRESCRIPTION_TYPES.includes(next.type)) { setError("Choose a PNG or JPEG image. PDF files are available to download but cannot be uploaded here."); return; }
    if (!next.size || next.size > MAX_PRESCRIPTION_BYTES) { setError("Choose an image between 1 byte and 4 MB."); return; }
    imageUrl.current = URL.createObjectURL(next);
    setFile(next); setPreview(imageUrl.current);
  }

  async function loadDemo(kind: keyof typeof DEMO_IMAGES) {
    if (busy || loadingDemo) return;
    setDemoBeingLoaded(kind); setError("");
    const controller = new AbortController(); demoRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const demo = DEMO_IMAGES[kind];
      const response = await fetch(demo.path, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The demo image could not be loaded. Please try again.");
      const blob = await response.blob();
      if (demoRequest.current === controller) {
        selectFile(new File([blob], demo.name, { type: "image/png" }));
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch { if (demoRequest.current === controller) setError("The demo image could not be loaded. Please try again."); }
    finally { clearTimeout(timer); if (demoRequest.current === controller) { setDemoBeingLoaded(null); demoRequest.current = null; } }
  }

  async function extract() {
    if (!file || !consent || busy || !availability?.configured || request.current) return;
    setBusy(true); setError(""); setResult(null); setCompared(new Set());
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    try {
      const response = await fetch("/api/prescriptions/verify", { method: "POST", cache: "no-store", headers: { "Content-Type": file.type, "X-Demo-Consent": "true" }, body: file, signal: controller.signal });
      if (!response.ok) throw new Error(requestError(response.status));
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error("The extraction service returned an unreadable response. Please try again."); }
      const data = parsePrescriptionResponse(payload);
      if (request.current === controller) { setResult(data); recordPrescriptionActivity(data); requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true })); }
    } catch (err) {
      if (request.current === controller) setError(timedOut ? "Text extraction took too long. Your image is still selected; please try again." : err instanceof Error && err.name !== "TypeError" ? err.message : "We couldn’t reach the extraction service. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  function clear() { selectFile(null); if (inputRef.current) inputRef.current.value = ""; }
  const missingCount = result?.fields.filter(field => !field.value).length ?? 0;

  return <main className="rx-page">
    <header className="rx-topbar"><SiteBrand /><nav aria-label="Main navigation"><Link href="/">Overview</Link><Link href="/assessment">Patient assessment</Link><Link href="/pharmacy">Pharmacy dashboard</Link><Link href="/prescriptions" aria-current="page">Prescriptions</Link></nav><span className="rx-staff-badge">STAFF WORKSPACE</span></header>
    <section className="rx-intro"><div><p className="rx-eyebrow">ONTARIO · PRESCRIPTION REVIEW</p><h1>A clearer view of every detail<span>.</span></h1><p>Extract text from a prescription image, compare the fields, and prepare for a pharmacist’s review.</p></div><div className="rx-engine"><ScanIcon size={25} /><div><strong>Powered by PaddleOCR</strong><span>Text extraction for review</span></div></div></section>
    <aside className="rx-notice"><strong>DEMONSTRATION ONLY</strong><p>Use fictional documents only. OCR can misread text. A pharmacist must verify authenticity, legal requirements, and clinical appropriateness; this page cannot authorize dispensing.</p></aside>
    <ol className="rx-steps" aria-label="Prescription review steps"><li className="is-active"><span>01</span> Choose a document</li><li className={result ? "is-active" : ""}><span>02</span> Extract the text</li><li className={result ? "is-active" : ""}><span>03</span> Compare every field</li></ol>
    <div className="rx-workbench">
      <section className="rx-document" aria-labelledby="rx-document-title">
        <div className="rx-panel-heading"><div><p className="rx-eyebrow">THE ORIGINAL</p><h2 id="rx-document-title">Prescription image</h2></div><span className="rx-small-tag">PNG / JPEG</span></div>
        <div className="rx-upload-controls">
          <label className={`rx-file-label ${busy || loadingDemo ? "is-disabled" : ""}`}><ScanIcon size={25} /><span><strong>Choose an image</strong><small>A clear, typed document · up to 4 MB</small></span><input ref={inputRef} type="file" accept="image/png,image/jpeg" disabled={busy || loadingDemo} onChange={event => selectFile(event.target.files?.[0] ?? null)} aria-label="Upload fictional prescription image" /></label>
          <div className="rx-demo-actions"><button type="button" onClick={() => loadDemo("ontario")} disabled={busy || loadingDemo}>{demoBeingLoaded === "ontario" ? "Loading Ontario demo…" : "Load Ontario demo"}<span aria-hidden="true">↗</span></button><span><a href="/demo/ontario-demo-prescription.png" download>Demo PNG</a><a href="/demo/ontario-demo-prescription.pdf" download>Demo PDF</a></span></div>
          <div className="rx-classifier-demo-actions"><p>For the synthetic alteration demo</p><div><button type="button" onClick={() => loadDemo("original")} disabled={busy || loadingDemo}>{demoBeingLoaded === "original" ? "Loading original…" : "Load original demo"}</button><button type="button" onClick={() => loadDemo("altered")} disabled={busy || loadingDemo}>{demoBeingLoaded === "altered" ? "Loading altered…" : "Load altered demo"}</button></div><small>The classifier accepts these two generated samples only. The Ontario demo above is for OCR.</small></div>
        </div>
        {file && preview ? <><div className="rx-file-meta"><span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB</small></span><button type="button" onClick={clear} disabled={busy || loadingDemo} aria-label="Remove selected prescription image">Remove</button></div><a className="rx-image-link" href={preview} target="_blank" rel="noreferrer" aria-label="Open prescription image at full size"><Image src={preview} alt="Selected fictional prescription. Open the full-size image to compare its text with the extraction." width={1200} height={1600} unoptimized /></a><p className="rx-preview-caption">Select the preview to inspect the original at full size.</p></> : <div className="rx-upload-empty"><ScanIcon size={45} /><h3>Start with the original.</h3><p>Upload a fictional prescription for text extraction, or load one of the supplied demo images.</p><span>No real patient information</span></div>}
        <div className="rx-extract-controls">
          <label className="rx-consent"><input type="checkbox" checked={consent} disabled={!file || busy || loadingDemo} onChange={event => setConsent(event.target.checked)} /><span>I confirm this image contains fictional details and can be sent to the OCR or classification service when I run that feature.</span></label>
          <button type="button" className="rx-primary" onClick={extract} disabled={!file || !consent || busy || loadingDemo || !availability?.configured}>{busy ? <><i className="rx-spinner" />Extracting text…</> : <><ScanIcon size={19} />Extract with PaddleOCR</>}</button>
          <p className="rx-retention-note">Images and extracted fields are not saved to the case dashboard. Only scan counts and timing are kept in this browser tab for the dashboard overview. Comparison marks clear when you select another image or leave this page.</p>
        </div>
      </section>
      <section className="rx-results" aria-labelledby="rx-results-title" tabIndex={-1} ref={resultRef} aria-busy={busy}>
        <div className="rx-panel-heading"><div><p className="rx-eyebrow">READ, THEN COMPARE</p><h2 id="rx-results-title">Prescription verification</h2></div><span className="rx-small-tag">REVIEW REQUIRED</span></div>
        {!availability && !availabilityError && <p className="rx-service-note" role="status">Checking text extraction availability…</p>}
        {(availabilityError || availability?.configured === false) && <div className="rx-message rx-message-warning" role="status"><strong>{availabilityError ? "Couldn’t check the extraction service." : "Text extraction is not connected yet."}</strong><p>{availabilityError || "You can preview and download the demo document. Extraction will become available when the OCR service is connected."}</p><button type="button" onClick={() => { setAvailability(null); setAvailabilityError(""); setAvailabilityKey(key => key + 1); }}>Check again</button></div>}
        {error && <div className="rx-message rx-message-error" role="alert">{error}</div>}
        {busy ? <div className="rx-results-empty" role="status"><i className="rx-spinner rx-spinner-large" /><h3>Reading the document.</h3><p>PaddleOCR is finding text and preparing the fields for comparison. This can take up to 90 seconds.</p></div> : result ? <>
          <div className="rx-result-summary"><div><strong>{result.fields.filter(field => !!field.value).length}<span> / {result.fields.length}</span></strong><p>Fields extracted</p></div><div><strong>{missingCount}</strong><p>Fields not found</p></div><div><strong>{compared.size}<span> / {result.fields.length}</span></strong><p>Compared with image</p></div></div>
          {result.isDemo && <div className="rx-demo-document"><strong>Demo document detected</strong><span>Not valid for dispensing.</span></div>}
          <div className="rx-review-reminder"><strong>Pharmacist review is still required.</strong><p>Confidence describes OCR’s text recognition, not the validity of a prescription. Check the original, especially names, dates, strengths, quantities, and directions.</p></div>
          {!!result.checks.length && <ul className="rx-checks" aria-label="Items for review">{result.checks.map((check, index) => <li key={`${check.code}-${index}`} className={`rx-check-${check.severity}`}><span aria-hidden="true">{check.severity === "warning" ? "!" : "i"}</span><p>{check.message}</p></li>)}</ul>}
          <dl className="rx-fields">{result.fields.map(field => <div key={field.key} className={field.needsReview || !field.value ? "rx-field-review" : ""}><div className="rx-field-heading"><dt>{field.label}</dt><span>{field.confidence === null ? "Not found" : `${Math.round(field.confidence * 100)}% OCR confidence`}</span></div><dd>{field.value || "Not extracted — check the original document."}</dd><div className="rx-field-footer">{field.needsReview && <span className="rx-review-flag">Needs a closer look</span>}<label><input type="checkbox" checked={compared.has(field.key)} onChange={event => { const checked = event.target.checked; setCompared(current => { const next = new Set(current); if (checked) next.add(field.key); else next.delete(field.key); return next; }); }} /><span>Compared<span className="rx-sr-only"> {field.label} with the original image</span></span></label></div></div>)}</dl>
          <details className="rx-raw-text"><summary>Original OCR text <span>{result.ocr.lines.length} lines</span></summary><p>Compare this reading with the image. Extracted text may contain mistakes.</p><ol>{result.ocr.lines.map((line, index) => <li key={index}><span>{line.text}</span><small>{Math.round(line.confidence * 100)}%</small></li>)}</ol></details>
          <p className="rx-model-note">{result.ocr.engine} · {result.ocr.model} · {(result.ocr.durationMs / 1000).toFixed(1)} seconds</p>
        </> : <div className="rx-results-empty"><div className="rx-empty-art"><ScanIcon size={46} /><span aria-hidden="true">Aa</span></div><p className="rx-eyebrow">DETAILS WORTH DOUBLE-CHECKING</p><h3>The document, made easier to read.</h3><p>Extracted patient, prescriber, and medication fields will appear here alongside confidence scores and missing-field notices.</p><div className="rx-empty-fields"><span>Patient details</span><span>Prescriber details</span><span>Medication & directions</span></div><p className="rx-empty-footnote">Handwriting, image quality, and unusual layouts can affect recognition. Always compare with the original.</p></div>}
      </section>
    </div>
    <ClassifierPanel key={preview || "no-image"} file={file} consent={consent} disabled={busy || loadingDemo} />
    <footer className="rx-footer"><span>Pharmacy Assistant / Capstone demonstration</span><span>Fictional documents · Human review required</span></footer>
  </main>;
}
