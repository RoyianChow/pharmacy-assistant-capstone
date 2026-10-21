"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer } from "@/lib/assessment/types";
import type { PatientDetails, SubmissionReceipt } from "@/lib/pharmacy/types";

export type SavedHandoff = { receipt: SubmissionReceipt; patient: PatientDetails };
type SubmissionPayload = { submissionKey: string; patient: PatientDetails; answers: Answer[]; consentToShare: true };

function isReceipt(value: unknown): value is SubmissionReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<SubmissionReceipt>;
  return typeof receipt.id === "string" && typeof receipt.reference === "string" &&
    typeof receipt.createdAt === "string" && Number.isFinite(Date.parse(receipt.createdAt)) &&
    ["new", "in_review", "completed"].includes(receipt.status ?? "");
}

export default function PharmacySubmission({ answers, submissionKey, onSubmitted }: {
  answers: Answer[];
  submissionKey: string;
  onSubmitted: (handoff: SavedHandoff) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [contactPreference, setContactPreference] = useState<PatientDetails["contactPreference"]>("in_person");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedHandoff | null>(null);
  const request = useRef<AbortController | null>(null);
  const payload = useRef<SubmissionPayload | null>(null);
  const sent = useRef(false);
  const receiptHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => { if (saved) receiptHeading.current?.focus(); }, [saved]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || sent.current || !submissionKey) return;
    if (!payload.current) {
      if (!consent || !displayName.trim() || (contactPreference !== "in_person" && !contact.trim())) return;
      // This object is retained for every uncertain retry, including the same idempotency key.
      // Contact information goes only to the pharmacy endpoint, never the Jev assessment endpoint.
      payload.current = {
        submissionKey,
        patient: { displayName: displayName.trim(), contactPreference, contact: contactPreference === "in_person" ? "" : contact.trim() },
        answers: answers.map(answer => ({ ...answer })),
        consentToShare: true,
      };
    }
    const attempt = new AbortController();
    request.current = attempt;
    setBusy(true);
    setFrozen(true);
    setError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; attempt.abort(); }, 20000);
    try {
      const res = await fetch("/api/pharmacy/cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.current), signal: attempt.signal, cache: "no-store",
      });
      const data = await res.json();
      if (request.current !== attempt) return;
      if (!res.ok) {
        // Validation failures occur before a record is saved, so correcting the form is safe.
        if (res.status === 400 || res.status === 422) { payload.current = null; setFrozen(false); }
        throw new Error(typeof data.error === "string" ? data.error : "We couldn’t confirm that your assessment was saved.");
      }
      if (!isReceipt(data.receipt)) throw new Error("We couldn’t confirm the pharmacy reference. Please retry to retrieve it.");
      const handoff = { receipt: data.receipt, patient: payload.current!.patient };
      sent.current = true;
      setSaved(handoff);
      onSubmitted(handoff);
    } catch (cause) {
      if (request.current !== attempt) return;
      setError(timedOut ? "The request took too long. Your assessment may already be saved. Retry to confirm the same submission." : cause instanceof Error && cause.name !== "TypeError" ? cause.message : "We couldn’t connect. Your assessment may already be saved. Retry to confirm the same submission.");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === attempt) { request.current = null; setBusy(false); }
    }
  }

  if (saved) return (
    <section className="assessment-handoff assessment-handoff-saved" aria-labelledby="pharmacy-receipt-title">
      <p className="assessment-eyebrow">READY FOR REVIEW</p>
      <h3 id="pharmacy-receipt-title" ref={receiptHeading} tabIndex={-1}>Your assessment is in the demo dashboard.</h3>
      <p>Saved to the local pharmacy dashboard. This is not an appointment or a prescription.</p>
      <dl className="assessment-handoff-receipt">
        <div><dt>Reference</dt><dd>{saved.receipt.reference}</dd></div>
        <div><dt>Fictional patient</dt><dd>{saved.patient.displayName}</dd></div>
        <div><dt>Submitted</dt><dd><time dateTime={saved.receipt.createdAt}>{new Date(saved.receipt.createdAt).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })} (Toronto)</time></dd></div>
        <div><dt>Contact preference</dt><dd>{saved.patient.contactPreference === "in_person" ? "In person" : `${saved.patient.contactPreference === "email" ? "Email" : "Phone"}: ${saved.patient.contact}`}</dd></div>
      </dl>
      <Link className="assessment-primary" href={`/pharmacy?case=${encodeURIComponent(saved.receipt.id)}`}>View in demo dashboard <span aria-hidden="true">↗</span></Link>
      <p className="assessment-handoff-fineprint">No message or appointment has been sent. Your submitted case remains saved when you reload or start over.</p>
    </section>
  );

  return (
    <section className="assessment-handoff" aria-labelledby="pharmacy-handoff-title">
      <p className="assessment-eyebrow">SHARE YOUR NEXT STEP</p>
      <h3 id="pharmacy-handoff-title">Send your assessment to the pharmacy.</h3>
      <p>Add fictional contact details so the pharmacist can review your answers in this local demo. Review the answers above before sending.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || frozen} className="assessment-handoff-fields">
          <legend className="assessment-visually-hidden">Fictional patient details</legend>
          <div className="assessment-handoff-field">
            <label htmlFor="pharmacy-patient-name">Fictional patient name <span>(required)</span></label>
            <input id="pharmacy-patient-name" name="displayName" maxLength={80} required autoComplete="off" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="e.g. Jamie Example" />
          </div>
          <div className="assessment-handoff-field">
            <label htmlFor="pharmacy-contact-preference">Contact preference</label>
            <select id="pharmacy-contact-preference" value={contactPreference} onChange={event => { setContactPreference(event.target.value as PatientDetails["contactPreference"]); setContact(""); }}>
              <option value="in_person">Speak in person</option><option value="phone">Phone</option><option value="email">Email</option>
            </select>
          </div>
          {contactPreference !== "in_person" && <div className="assessment-handoff-field">
            <label htmlFor="pharmacy-contact">{contactPreference === "email" ? "Fictional email address" : "Fictional phone number"} <span>(required)</span></label>
            <input id="pharmacy-contact" name="contact" type={contactPreference === "email" ? "email" : "tel"} maxLength={160} required autoComplete="off" value={contact} onChange={event => setContact(event.target.value)} placeholder={contactPreference === "email" ? "jamie@example.com" : "416-555-0100"} aria-describedby="pharmacy-contact-help" />
            <p id="pharmacy-contact-help">This demo records your preference. It does not send emails or make calls.</p>
          </div>}
          <label className="assessment-handoff-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>Send these fictional details and my assessment answers to this pharmacy’s demo dashboard. They will be saved until the demo data is cleared.</span></label>
        </fieldset>
        {error && <div className="assessment-error" role="alert"><strong>We couldn’t confirm your submission.</strong><p>{error}</p>{frozen && <p>Your details are held unchanged so retrying won’t create a duplicate. If you start over, any case already saved will remain in the dashboard.</p>}</div>}
        <button type="submit" className="assessment-primary" disabled={busy || (!frozen && (!consent || !displayName.trim() || (contactPreference !== "in_person" && !contact.trim())))}>{busy ? "Sending assessment…" : frozen ? "Retry same submission" : "Send to pharmacy dashboard"}<span aria-hidden="true">→</span></button>
        {busy && <p role="status">Saving your assessment and fictional details…</p>}
        <p className="assessment-handoff-fineprint">This demo dashboard has no staff sign-in. Anyone who can access this app can view submitted cases. These contact details stay with the local pharmacy record and are not sent to Jev.</p>
      </form>
    </section>
  );
}
