"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readPrescriptionActivity, PRESCRIPTION_ACTIVITY_EVENT, type PrescriptionActivity } from "@/lib/prescription/activity";
import { parseAvailability } from "../prescriptions/response";
import "./prescription-overview.css";

type ServiceStatus = "loading" | "configured" | "unconfigured" | "error";

const STATUS_LABEL: Record<ServiceStatus, string> = {
  loading: "Checking OCR configuration…",
  configured: "OCR configured",
  unconfigured: "OCR not connected",
  error: "Status unavailable",
};

function ScanIcon() {
  return <svg width="25" height="25" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5H5v6m16-6h6v6M5 21v6h6m16-6v6h-6M11 11h10M11 16h10M11 21h6" /></svg>;
}

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/Toronto", timeZoneName: "short",
  }).format(new Date(value));
}

export default function PrescriptionOverview() {
  const [activity, setActivity] = useState<PrescriptionActivity | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("loading");
  const [statusKey, setStatusKey] = useState(0);

  useEffect(() => {
    let active = true;
    const refreshActivity = () => { if (active) setActivity(readPrescriptionActivity()); };
    queueMicrotask(refreshActivity);
    window.addEventListener(PRESCRIPTION_ACTIVITY_EVENT, refreshActivity);
    window.addEventListener("pageshow", refreshActivity);
    return () => {
      active = false;
      window.removeEventListener(PRESCRIPTION_ACTIVITY_EVENT, refreshActivity);
      window.removeEventListener("pageshow", refreshActivity);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function checkService() {
      try {
        const response = await fetch("/api/prescriptions/verify", {
          cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Configuration check failed");
        const availability = parseAvailability(await response.json());
        if (active && !controller.signal.aborted) setServiceStatus(availability.configured ? "configured" : "unconfigured");
      } catch {
        if (active) setServiceStatus("error");
      } finally { clearTimeout(timeout); }
    }
    void checkService();
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [statusKey]);

  const latest = activity?.lastScan;
  function retryStatus() { setServiceStatus("loading"); setStatusKey(value => value + 1); }

  return <section className="ph-rx-overview" aria-labelledby="ph-rx-title">
    <div className="ph-rx-heading">
      <div className="ph-rx-title-group">
        <span className="ph-rx-icon"><ScanIcon /></span>
        <div><p className="ph-rx-eyebrow">PRESCRIPTION TOOLS</p><h2 id="ph-rx-title">Prescription verification</h2><p className="ph-rx-description">Read an image with PaddleOCR, then compare the extracted details.</p></div>
      </div>
      <Link href="/prescriptions" className="ph-rx-open">Open prescription verification <span aria-hidden="true">↗</span></Link>
    </div>

    <div className="ph-rx-scope-row">
      <p>This browser tab <span>· activity totals</span></p>
      <div className="ph-rx-service">
        <span className={`ph-rx-status ph-rx-status-${serviceStatus}`} role="status"><i aria-hidden="true" />{STATUS_LABEL[serviceStatus]}</span>
        {serviceStatus === "error" && <button type="button" onClick={retryStatus} aria-label="Retry OCR configuration check">Retry</button>}
      </div>
    </div>

    <dl className="ph-rx-metrics">
      <div><dt>Documents scanned</dt><dd>{activity ? activity.scanCount.toLocaleString("en-CA") : "0"}</dd><dd className="ph-rx-metric-caption">Successful extractions in this tab</dd></div>
      <div><dt>Latest fields extracted</dt><dd>{latest ? <>{latest.extractedCount}<span> / {latest.fieldCount}</span></> : "—"}</dd><dd className="ph-rx-metric-caption">Fields found in the latest scan</dd></div>
      <div><dt>Fields needing a closer look</dt><dd>{latest ? latest.flaggedCount : "—"}</dd><dd className="ph-rx-metric-caption">Missing or flagged in the latest scan</dd></div>
    </dl>

    <div className="ph-rx-activity-note">
      {latest ? <p>Latest scan: <time dateTime={latest.at}>{formatScanTime(latest.at)}</time><span className="ph-rx-duration">· {(latest.durationMs / 1000).toFixed(1)} seconds of OCR processing</span></p> : <p>No scans recorded in this tab yet. Open prescription verification and try the Ontario demo to see activity here.</p>}
      {serviceStatus === "unconfigured" && <p className="ph-rx-service-help">The demo document is available to preview and download while OCR is disconnected.</p>}
      {serviceStatus === "error" && <p className="ph-rx-service-help">The OCR configuration could not be checked. You can still open the prescription workspace.</p>}
    </div>
    <footer className="ph-rx-footer"><p>Activity totals only; prescription images and details are not saved here.</p><span>Pharmacist review required</span></footer>
  </section>;
}
