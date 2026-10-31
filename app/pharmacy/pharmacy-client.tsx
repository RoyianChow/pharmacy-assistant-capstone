"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteBrand from "../components/site-brand";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { AssessmentResult, SummaryItem } from "@/lib/assessment/types";
import type { CaseListItem, CaseSort, CaseStatus, DashboardResponse, PharmacyCase } from "@/lib/pharmacy/types";
import { DashboardRequestError, fetchDashboard } from "@/lib/pharmacy/dashboard-request";
import { parseCaseResponse, parseDashboardResponse } from "@/lib/pharmacy/dashboard-response";

const STATUS: Record<CaseStatus, string> = { new: "New", in_review: "In review", completed: "Completed" };
const OUTCOME: Record<AssessmentResult["kind"], string> = {
  pharmacist: "Pharmacist assessment", outside_scope: "Other care options", incomplete: "Incomplete screening",
  emergency: "Emergency guidance", urgent: "Urgent guidance",
};
const CONTACT = { in_person: "In person", phone: "Phone", email: "Email" };

function Icon({ name, size = 18 }: { name: "inbox" | "search" | "refresh" | "arrow" | "check" | "clock" | "note" | "close"; size?: number }) {
  const paths = {
    inbox: <><path d="M4 5h16v14H4z"/><path d="M4 13h5l1 3h4l1-3h5M8 9h8"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.8-1L20 9M4 15l2.1 3A7 7 0 0 0 17.9 17"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    note: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatDate(value: string, compact = false) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", ...(compact ? {} : { year: "numeric" as const }), hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }).format(new Date(value));
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }
function StatusBadge({ status }: { status: CaseStatus }) { return <span className={`ph-status ph-status-${status}`}><i/>{STATUS[status]}</span>; }

type PendingAction = { kind: "case"; id: string | null } | { kind: "navigate"; href: string };

export default function PharmacyClient() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [status, setStatus] = useState<"all" | CaseStatus>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<"all" | AssessmentResult["kind"]>("all");
  const [sort, setSort] = useState<CaseSort>("newest");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const dirtyRef = useRef(false);
  const detailRef = useRef<HTMLElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) queueMicrotask(() => setSelectedId(id));
  }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (pendingAction) keepEditingRef.current?.focus(); }, [pendingAction]);
  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    async function load(silent: boolean) {
      if (silent && request) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      if (!silent) queueMicrotask(() => active && setLoading(true));
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (status !== "all") params.set("status", status);
        if (outcome !== "all") params.set("outcome", outcome);
        params.set("sort", sort);
        params.set("page", String(page));
        const data = parseDashboardResponse(await fetchDashboard<unknown>(`/api/pharmacy/cases?${params}`, { signal: controller.signal }));
        if (active && !controller.signal.aborted) { setDashboard(data); setQueueError(""); setUpdatedAt(new Date().toISOString()); }
      } catch (error) {
        if (active && error instanceof Error && error.name !== "AbortError") setQueueError(error.message);
      } finally { if (active && !controller.signal.aborted) setLoading(false); if (request === controller) request = undefined; }
    }
    void load(false);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15_000);
    return () => { active = false; request?.abort(); clearInterval(timer); };
  }, [query, status, outcome, sort, page, refreshKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || reviewSaving) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reviewSaving]);

  function selectCase(id: string | null) {
    if (id === selectedId || reviewSaving) return;
    if (dirtyRef.current) { setPendingAction({ kind: "case", id }); return; }
    applySelection(id);
  }
  function applySelection(id: string | null) {
    setPendingAction(null);
    dirtyRef.current = false;
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("case", id); else url.searchParams.delete("case");
    window.history.replaceState(null, "", url.toString());
    if (id) requestAnimationFrame(() => { detailRef.current?.focus({ preventScroll: true }); if (window.innerWidth < 900) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }
  function guardNavigation(event: MouseEvent<HTMLElement>) {
    if ((!dirtyRef.current && !reviewSaving) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    event.preventDefault();
    event.stopPropagation();
    if (!reviewSaving) setPendingAction({ kind: "navigate", href: destination.pathname + destination.search + destination.hash });
  }
  function discardAndContinue() {
    if (!pendingAction || reviewSaving) return;
    dirtyRef.current = false;
    if (pendingAction.kind === "case") applySelection(pendingAction.id);
    else { setPendingAction(null); router.push(pendingAction.href); }
  }
  function filterStatus(next: "all" | CaseStatus) { setStatus(next); setPage(1); }
  function clearFilters() { setSearch(""); setQuery(""); setStatus("all"); setOutcome("all"); setPage(1); }
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);
  const dirtyChanged = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const selectedVersion = dashboard?.cases.find(item => item.id === selectedId)?.version;
  const hasFilters = !!search.trim() || status !== "all" || outcome !== "all";
  const totalPages = dashboard ? Math.max(1, Math.ceil(dashboard.matchedTotal / dashboard.pageSize)) : 1;
  const resultStart = dashboard?.matchedTotal ? (dashboard.page - 1) * dashboard.pageSize + 1 : 0;

  return <main className="ph-page" onClickCapture={guardNavigation}>
    <header className="ph-topbar">
      <SiteBrand />
      <nav aria-label="Main navigation" style={{ flexWrap: "wrap" }}><Link href="/">Overview</Link><Link href="/assessment">Patient assessment</Link><Link href="/pharmacy" aria-current="page">Pharmacy workspace</Link><Link href="/prescriptions">Prescriptions</Link></nav>
      <span className="ph-local"><i/> Demo workspace</span>
    </header>
    <section className="ph-intro">
      <div><p className="ph-eyebrow">ONTARIO · MINOR AILMENTS</p><h1>Pharmacy workspace<span>.</span></h1><p>Your assessment inbox. Review the details, then plan the next conversation.</p></div>
      <Link className="ph-button ph-button-light" href="/assessment">Open patient assessment <Icon name="arrow" size={16}/></Link>
    </section>
    <aside className="ph-demo"><span className="ph-demo-label">DEMONSTRATION</span><p>Fictional records only. The hosted workspace is available only to approved staff. This educational demo is not for real patient information. Screening results require a pharmacist’s assessment.</p></aside>
    <section className="ph-stats" aria-label="Assessment counts">
      {(["new", "in_review", "completed"] as const).map((item, index) => <button key={item} type="button" onClick={() => filterStatus(status === item ? "all" : item)} className={status === item ? "is-active" : ""} aria-pressed={status === item}>
        <span className={`ph-stat-icon ph-stat-icon-${item}`}><Icon name={index === 0 ? "inbox" : index === 1 ? "clock" : "check"} size={21}/></span>
        <span className="ph-stat-text"><span>{STATUS[item]}</span><strong>{dashboard ? dashboard.counts[item] : "—"}</strong></span>
        <span className="ph-stat-caption">{index === 0 ? "Awaiting a first review" : index === 1 ? "Review in progress" : "Review recorded"}</span>
      </button>)}
    </section>
    {pendingAction && <div className="ph-confirmation-backdrop"><div className="ph-switch-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="ph-discard-title" aria-describedby="ph-discard-description" onKeyDown={event => { if (event.key === "Escape") { setPendingAction(null); detailRef.current?.focus(); } if (event.key === "Tab") { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button"); if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1]?.focus(); } else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0]?.focus(); } } }}><div><strong id="ph-discard-title">Keep your review draft?</strong><p id="ph-discard-description">You have unsaved changes. Discard them to {pendingAction.kind === "navigate" ? "leave this page" : pendingAction.id === null ? "close this assessment" : "open the other assessment"}, or keep editing.</p></div><div><button ref={keepEditingRef} type="button" className="ph-button ph-button-primary" onClick={() => { setPendingAction(null); detailRef.current?.focus(); }}>Keep editing</button><button type="button" className="ph-button ph-button-light" onClick={discardAndContinue}>Discard changes</button></div></div></div>}
    {reviewSaving && <p className="ph-save-in-progress" role="status">Saving your review. Please keep this page open until saving finishes.</p>}
    <div className="ph-workbench">
      <section className="ph-inbox" aria-labelledby="ph-inbox-title">
        <div className="ph-inbox-heading"><div><p className="ph-eyebrow">ASSESSMENT QUEUE</p><h2 id="ph-inbox-title">Patient submissions <span>{dashboard?.total ?? "—"}</span></h2></div><button className="ph-icon-button" type="button" onClick={refresh} disabled={loading} aria-label="Refresh assessment queue" title="Refresh queue"><Icon name="refresh"/></button></div>
        <div className="ph-search"><Icon name="search" size={17}/><label className="ph-sr-only" htmlFor="ph-search">Search by name, reference or concern</label><input id="ph-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, reference or concern…" type="search" maxLength={120}/></div>
        <div className="ph-filters" role="group" aria-label="Filter by review status">{(["all", "new", "in_review", "completed"] as const).map(item => <button type="button" key={item} aria-pressed={status === item} className={status === item ? "is-active" : ""} onClick={() => filterStatus(item)}>{item === "all" ? "All cases" : STATUS[item]}</button>)}</div>
        <div className="ph-queue-controls"><label>Screening outcome<select value={outcome} onChange={event => { setOutcome(event.target.value as typeof outcome); setPage(1); }}><option value="all">All outcomes</option><option value="pharmacist">Pharmacist assessment</option><option value="incomplete">Incomplete screening</option><option value="outside_scope">Other care options</option></select></label><label>Sort cases<select value={sort} onChange={event => { setSort(event.target.value as CaseSort); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently updated</option></select></label></div>
        <div className="ph-results-summary" aria-live="polite"><span>{loading ? "Updating cases…" : dashboard ? `${dashboard.matchedTotal} matching ${dashboard.matchedTotal === 1 ? "case" : "cases"} · ${dashboard.total} total` : "Loading cases…"}</span>{hasFilters && <button type="button" className="ph-text-button" onClick={clearFilters}>Clear filters</button>}</div>
        {queueError && <div className="ph-message ph-message-error" role="alert">{queueError} <button type="button" onClick={refresh}>Try again</button></div>}
        <div className="ph-queue" aria-busy={loading}>
          {loading ? <div className="ph-empty"><span className="ph-spinner"/><p>Loading the assessment queue…</p></div> : dashboard?.cases.length ? <ul>{dashboard.cases.map(item => <li key={item.id}><CaseRow item={item} selected={selectedId === item.id} disabled={reviewSaving} onSelect={() => selectCase(item.id)}/></li>)}</ul> : !queueError && <div className="ph-empty"><span className="ph-empty-icon"><Icon name="inbox" size={28}/></span><h3>{hasFilters ? "No matching assessments" : "Your inbox is ready"}</h3><p>{hasFilters ? "Try another search, review status, or screening outcome." : "Completed assessments will appear here when a patient shares their fictional details."}</p>{!hasFilters && <Link href="/assessment" className="ph-button ph-button-light">Start a demo assessment <Icon name="arrow" size={15}/></Link>}</div>}
        </div>
        {dashboard && dashboard.matchedTotal > 0 && <div className="ph-pagination"><p>{resultStart}–{resultStart + dashboard.cases.length - 1} of {dashboard.matchedTotal}</p><div><button type="button" className="ph-icon-button" aria-label="Previous page of cases" disabled={loading || dashboard.page <= 1} onClick={() => setPage(dashboard.page - 1)}><span aria-hidden="true">←</span></button><span>Page {dashboard.page} of {totalPages}</span><button type="button" className="ph-icon-button" aria-label="Next page of cases" disabled={loading || dashboard.page >= totalPages} onClick={() => setPage(dashboard.page + 1)}><span aria-hidden="true">→</span></button></div></div>}
        <footer className="ph-queue-footer"><span><i/> Refreshes every 15 seconds</span><span>{updatedAt ? `Updated ${new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }).format(new Date(updatedAt))}` : "Waiting for submissions"}</span></footer>
      </section>
      <section className="ph-detail" aria-label="Selected assessment" tabIndex={-1} ref={detailRef}>
        {selectedId ? <CaseDetail key={selectedId} id={selectedId} latestVersion={selectedVersion} onDirty={dirtyChanged} onSaving={setReviewSaving} onSaved={refresh} onClose={() => selectCase(null)}/> : <div className="ph-detail-placeholder"><div className="ph-placeholder-art"><span/><Icon name="note" size={41}/><i><Icon name="check" size={15}/></i></div><p className="ph-eyebrow">A CLEARER PICTURE, BEFORE THE VISIT</p><h2>Every detail in one place.</h2><p>Select a submission to see the patient’s answers,<br className="ph-desktop-break"/> screening outcome and review history.</p><div className="ph-placeholder-steps"><span>01 <strong>Read the assessment</strong></span><span>02 <strong>Record your review</strong></span><span>03 <strong>Plan the next step</strong></span></div><p className="ph-placeholder-note">Completing a review does not issue a prescription or contact the patient.</p></div>}
      </section>
    </div>
    <footer className="ph-footer"><span>Pharmacy Assistant <span> / </span> Capstone demonstration</span><span>All times shown in Ontario time</span></footer>
  </main>;
}

function CaseRow({ item, selected, disabled, onSelect }: { item: CaseListItem; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return <button type="button" className={`ph-case-row ${selected ? "is-selected" : ""}`} onClick={onSelect} disabled={disabled} aria-pressed={selected}>
    <span className="ph-case-avatar">{initials(item.patient.displayName)}</span><span className="ph-case-copy"><span className="ph-case-top"><strong>{item.patient.displayName}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt, true)}</time></span><span className="ph-case-concern">{item.concern}</span><span className="ph-case-bottom"><span>{item.reference}</span><StatusBadge status={item.status}/></span>{item.outcome !== "pharmacist" && <span className={`ph-screen-flag ph-screen-flag-${item.outcome}`}>{OUTCOME[item.outcome]}</span>}</span>
  </button>;
}

function CaseDetail({ id, latestVersion, onDirty, onSaving, onSaved, onClose }: { id: string; latestVersion?: number; onDirty: (value: boolean) => void; onSaving: (value: boolean) => void; onSaved: () => void; onClose: () => void }) {
  const [record, setRecord] = useState<PharmacyCase | null>(null);
  const [error, setError] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState<CaseStatus>("new");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "answers" | "review">("overview");
  const [uncertainSave, setUncertainSave] = useState(false);
  const keepDraft = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const dirty = !!record && (reviewer.trim() !== record.reviewerName || notes.trim() !== record.reviewNotes || reviewStatus !== record.status);
  const newerVersion = !!record && latestVersion !== undefined && latestVersion > record.version;

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => { saveController.current?.abort(); onDirty(false); onSaving(false); }, [onDirty, onSaving]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = parseCaseResponse(await fetchDashboard<unknown>(`/api/pharmacy/cases/${encodeURIComponent(id)}`, { signal: controller.signal }));
        if (controller.signal.aborted) return;
        setRecord(data.case);
        if (!keepDraft.current) { setReviewer(data.case.reviewerName); setNotes(data.case.reviewNotes); setReviewStatus(data.case.status); }
        keepDraft.current = false;
        setConflict(false); setUncertainSave(false); setError("");
      } catch (err) { if (err instanceof Error && err.name !== "AbortError") setError(err.message); }
      finally { if (!controller.signal.aborted) setReloading(false); }
    }
    void load();
    return () => controller.abort();
  }, [id, loadKey]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || saveController.current || saving || reloading || conflict || newerVersion || uncertainSave) return;
    setSaving(true); onSaving(true); setError(""); setSuccess("");
    saveController.current = new AbortController();
    const controller = saveController.current;
    try {
      const data = parseCaseResponse(await fetchDashboard<unknown>(`/api/pharmacy/cases/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: reviewStatus, reviewerName: reviewer.trim(), reviewNotes: notes.trim(), version: record.version }), signal: controller.signal }));
      if (controller.signal.aborted) return;
      setRecord(data.case); setReviewer(data.case.reviewerName); setNotes(data.case.reviewNotes); setReviewStatus(data.case.status);
      setConflict(false); setSuccess("Review saved. No prescription was issued and no message was sent."); onSaved();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        if (err instanceof DashboardRequestError && err.status === 409) setConflict(true);
        else if (!(err instanceof DashboardRequestError) || err.kind !== "http" || err.status === null || err.status >= 500) setUncertainSave(true);
        setError(err.message);
      }
    } finally { if (!controller.signal.aborted) { setSaving(false); onSaving(false); saveController.current = null; } }
  }
  function reload(keep: boolean) { keepDraft.current = keep; setReloading(true); setSuccess(""); setLoadKey(key => key + 1); }

  if (!record) return <div className="ph-empty">{error ? <><h3>Assessment unavailable</h3><p role="alert">{error}</p><button type="button" className="ph-button ph-button-light" onClick={() => reload(false)}>Try again</button></> : <><span className="ph-spinner"/><p>Opening assessment…</p></>}</div>;
  const critical = ["medicines", "allergies"].map(questionId => record.summary.find(item => item.questionId === questionId) ?? { questionId, label: questionId, value: "Not provided in this assessment" });
  const rest = record.summary.filter(item => !["medicines", "allergies"].includes(item.questionId));
  const overview = ["symptoms", "duration", "severity", "pregnancy"].flatMap(questionId => record.summary.filter(item => item.questionId === questionId));
  const sections = ["overview", "answers", "review"] as const;
  const lastReview = record.reviewHistory.at(-1);
  return <article className="ph-record">
    <header className="ph-record-heading"><div><p className="ph-eyebrow">{record.reference} <span>·</span> SUBMITTED {formatDate(record.createdAt)}</p><h2>{record.patient.displayName}</h2><p>{record.concern}</p></div><button type="button" className="ph-icon-button" onClick={onClose} disabled={saving} aria-label="Close assessment"><Icon name="close"/></button></header>
    <div className="ph-record-meta"><StatusBadge status={record.status}/><span>Contact preference <strong>{CONTACT[record.patient.contactPreference]}</strong></span>{record.patient.contact && <span className="ph-contact">{record.patient.contact}</span>}</div>
    <div className="ph-case-tabs" role="tablist" aria-label="Assessment sections">{sections.map((section, index) => <button key={section} id={`ph-tab-${section}`} type="button" role="tab" aria-selected={activeSection === section} aria-controls={`ph-panel-${section}`} tabIndex={activeSection === section ? 0 : -1} onClick={() => setActiveSection(section)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1; if (next >= 0) { event.preventDefault(); setActiveSection(sections[next]); document.getElementById(`ph-tab-${sections[next]}`)?.focus(); } }}><span>{section === "overview" ? "Overview" : section === "answers" ? "Assessment answers" : "Review & history"}</span>{section === "answers" && <span className="ph-tab-count">{record.summary.length}</span>}{section === "review" && dirty && <span className="ph-draft-dot" aria-label="Unsaved changes"/>}</button>)}</div>
    <div className="ph-record-body">
      <div className="ph-case-panel" role="tabpanel" id="ph-panel-overview" aria-labelledby="ph-tab-overview" hidden={activeSection !== "overview"} tabIndex={0}>
      <div className="ph-case-summary-heading"><div><p className="ph-eyebrow">AT A GLANCE</p><h3>Ready for a closer look.</h3></div><button type="button" className="ph-button ph-button-primary" onClick={() => setActiveSection("review")}>Open review <Icon name="arrow" size={15}/></button></div>
      <dl className="ph-overview-facts">{overview.map(item => <SummaryAnswer key={item.questionId} item={item}/>)}</dl>
      <dl className="ph-critical-answers">{critical.map(item => <SummaryAnswer key={item.questionId} item={item} compact/>)}</dl>
      <section className={`ph-outcome ph-outcome-${record.result.kind}`} aria-labelledby="ph-outcome-title"><div className="ph-section-kicker"><Icon name="note" size={15}/><span>SCREENING OUTCOME · NOT A DIAGNOSIS</span></div><h3 id="ph-outcome-title">{record.result.title}</h3><p>{record.result.message}</p><p className="ph-prescription">{record.result.prescription}</p><details><summary>Suggested next steps & sources</summary><ul>{record.result.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ul><div className="ph-source-links">{record.result.sources.filter(source => source.url.startsWith("https://")).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></details></section>
      <div className="ph-last-review"><Icon name="clock" size={17}/><p>{lastReview ? <>Last reviewed by <strong>{lastReview.reviewerName}</strong><span>{formatDate(lastReview.createdAt)}</span></> : <>Awaiting the first review.<span>Open the review section to add notes and update the status.</span></>}</p></div>
      </div>
      <div className="ph-case-panel" role="tabpanel" id="ph-panel-answers" aria-labelledby="ph-tab-answers" hidden={activeSection !== "answers"} tabIndex={0}>
      <section className="ph-answer-section" aria-labelledby="ph-answers-title"><div className="ph-section-heading"><h3 id="ph-answers-title">Patient-reported information</h3><span>{record.summary.length} answers</span></div><p className="ph-section-description">Original submitted answers. Confirm these details with the patient.</p><dl className="ph-critical-answers">{critical.map(item => <SummaryAnswer key={item.questionId} item={item} compact/>)}</dl><details className="ph-all-answers" open><summary>Assessment answers <span>{rest.length}</span></summary><dl>{rest.map(item => <SummaryAnswer key={item.questionId} item={item}/>)}</dl></details></section>
      <button type="button" className="ph-button ph-button-primary" onClick={() => setActiveSection("review")}>Continue to review <Icon name="arrow" size={15}/></button>
      </div>
      <div className="ph-case-panel" role="tabpanel" id="ph-panel-review" aria-labelledby="ph-tab-review" hidden={activeSection !== "review"} tabIndex={0}>
      <section className="ph-review" aria-labelledby="ph-review-title"><div className="ph-section-heading"><h3 id="ph-review-title">Pharmacist review</h3>{dirty && <span className="ph-unsaved">Unsaved changes</span>}</div><p className="ph-section-description">Record the assessment follow-up and planned next steps. A completed review is not a prescription.</p>
        {(newerVersion || conflict || uncertainSave) && <div className="ph-message ph-message-warning" role="status"><strong>{uncertainSave ? "Confirm whether your review was saved." : "A newer review is available."}</strong><p>{uncertainSave ? "The connection ended before we could confirm the save. Load the saved review before trying again. Your draft name, status, and notes will stay here." : "Load it to see the latest history. Your draft name, status and notes will be kept for you to compare."}</p><button type="button" onClick={() => reload(true)} disabled={reloading || saving}>{reloading ? "Loading latest review…" : "Load latest version, keep my notes"}</button></div>}
        <form onSubmit={save}><fieldset disabled={saving || reloading}><div className="ph-review-fields"><label>Reviewer name <span>Required</span><input value={reviewer} onChange={event => { setReviewer(event.target.value); setSuccess(""); }} maxLength={80} required autoComplete="off" placeholder="e.g. Demo pharmacist"/></label><label>Review status<select value={reviewStatus} onChange={event => { setReviewStatus(event.target.value as CaseStatus); setSuccess(""); }} aria-describedby="ph-review-status-help"><option value="new">New</option><option value="in_review">In review</option><option value="completed">Completed</option></select></label></div><p id="ph-review-status-help" className="ph-review-status-help">{reviewStatus === "new" ? "New: this case is waiting for a review." : reviewStatus === "in_review" ? "In review: an assessment or follow-up is in progress." : "Completed: the review is recorded. Add notes describing the outcome and next step."} Status changes take effect when you save.</p><label className="ph-notes-label">Review notes <span>{reviewStatus === "completed" ? "Required to complete" : "Optional"}</span><textarea value={notes} onChange={event => { setNotes(event.target.value); setSuccess(""); }} rows={6} maxLength={4000} required={reviewStatus === "completed"} placeholder="Record follow-up questions, assessment notes or the next step…"/></label><div className="ph-review-actions"><span>{notes.length.toLocaleString()} / 4,000 characters</span><button type="submit" className="ph-button ph-button-primary" disabled={!dirty || !reviewer.trim() || conflict || newerVersion || uncertainSave || (reviewStatus === "completed" && !notes.trim())}>{saving ? "Saving…" : "Save review"}<Icon name="check" size={16}/></button></div></fieldset></form>
        {error && <div className="ph-message ph-message-error" role="alert">{error}</div>}{success && <div className="ph-message ph-message-success" role="status"><Icon name="check" size={16}/>{success}</div>}
      </section>
      <section className="ph-history" aria-labelledby="ph-history-title"><div className="ph-section-heading"><h3 id="ph-history-title">Review history</h3><span>{record.reviewHistory.length} {record.reviewHistory.length === 1 ? "update" : "updates"}</span></div>{record.reviewHistory.length ? <ol>{[...record.reviewHistory].reverse().map((event, index) => <li key={`${event.createdAt}-${index}`}><span className="ph-history-dot"/><div><div className="ph-history-heading"><strong>{event.reviewerName || "Unnamed reviewer"}</strong><StatusBadge status={event.status}/></div><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>{event.notes ? <p>{event.notes}</p> : <p className="ph-muted">No notes added.</p>}</div></li>)}</ol> : <p className="ph-section-description">No review has been recorded yet.</p>}</section>
      </div>
    </div>
  </article>;
}

function SummaryAnswer({ item, compact = false }: { item: SummaryItem; compact?: boolean }) {
  return <div><dt>{compact ? item.questionId === "medicines" ? "Medicines & supplements" : "Medication allergies & reactions" : item.label}</dt><dd>{item.value || "Not provided"}</dd></div>;
}
