"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, ChatResponse, Mode, Question } from "@/lib/assessment/types";
import { canSubmitAssessment } from "@/lib/pharmacy/types";
import PharmacySubmission, { type SavedHandoff } from "./pharmacy-submission";

type Turn = { question: Question; value: string; label: string };
const sections = ["Getting started", "Your symptoms", "Health history", "Next steps"];

function Icon({ name, size = 20 }: { name: "arrow" | "chat" | "check" | "download" | "help" | "restart"; size?: number }) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
    check: "m5 12 4 4L19 6",
    download: "M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5",
    help: "M12 8v5m0 4h.01M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    restart: "M3 10a9 9 0 1 1 2.7 8.4M3 4v6h6",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function AssessmentClient() {
  const [configuredMode, setConfiguredMode] = useState<"demo" | "jev" | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [consent, setConsent] = useState(false);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [choiceFilter, setChoiceFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Answer[] | null>(null);
  const [error, setError] = useState("");
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [submissionKey, setSubmissionKey] = useState("");
  const [savedHandoff, setSavedHandoff] = useState<SavedHandoff | null>(null);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const activeQuestion = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const keepConversation = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const request = new AbortController();
    const timer = window.setTimeout(() => { setConfigError(true); request.abort(); }, 12000);
    fetch("/api/assessment", { signal: request.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to load assessment");
        const data: unknown = await res.json();
        if (!data || typeof data !== "object" || !("mode" in data) || (data.mode !== "demo" && data.mode !== "jev")) throw new Error("Invalid configuration");
        if (!request.signal.aborted) setConfiguredMode(data.mode);
      })
      .catch(() => { if (!request.signal.aborted) setConfigError(true); })
      .finally(() => window.clearTimeout(timer));
    return () => { request.abort(); window.clearTimeout(timer); };
  }, [configAttempt]);

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
    if (!busy && !error && pending === null && !confirmRestart) {
      if (response?.result) resultHeading.current?.focus({ preventScroll: true });
      else if (response?.question) activeQuestion.current?.focus({ preventScroll: true });
    }
  }, [response, busy, error, pending, confirmRestart]);

  useEffect(() => {
    if (confirmRestart) keepConversation.current?.focus();
  }, [confirmRestart]);

  const requestAssessment = useCallback(async (nextAnswers: Answer[]) => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setPending(nextAnswers);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; request.abort(); }, 30000);
    try {
      const res = await fetch("/api/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: nextAnswers, consent: true, providerConsent: configuredMode === "jev" }),
        signal: request.signal,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t continue the conversation. Please try again.");
      if (!data || (!data.question && !data.result) || !data.progress || !Array.isArray(data.summary)) throw new Error("The assessment returned an unexpected response. Please try again.");
      if (controller.current !== request) return;
      setResponse(data as ChatResponse);
      setPending(null);
      setDraft("");
      setChoiceFilter("");
    } catch (cause) {
      if (controller.current !== request) return;
      setError(timedOut ? "The response took too long. Your answers are still here. Please try again." : cause instanceof Error && cause.name !== "TypeError" ? cause.message : "We couldn’t connect. Check your connection and try again. Your answers are still here.");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, [configuredMode]);

  const mode: Mode | null = response?.mode ?? configuredMode;
  const question = pending === null ? response?.question : undefined;
  const result = pending === null ? response?.result : undefined;
  const hasLongChoiceList = (question?.options?.length ?? 0) > 8;
  const visibleChoices = question?.options?.filter((option) => !hasLongChoiceList || option.label.toLowerCase().includes(choiceFilter.trim().toLowerCase()));
  const currentSection = result ? 3 : Math.max(0, sections.indexOf(response?.question?.section ?? "Getting started"));
  const modeLabel = mode === "jev" ? "Jev enabled" : mode === "fallback" ? "Guided fallback" : configuredMode ? "Demo mode" : "Connecting";

  function start() {
    if (!consent || !configuredMode || controller.current) return;
    setSubmissionKey(crypto.randomUUID());
    setStarted(true);
    void requestAssessment([]);
  }

  function submitAnswer(value: string, label = value) {
    if (!question || controller.current || pending !== null || !value.trim()) return;
    const nextAnswers = [...answers, { questionId: question.id, value: value.trim() }];
    setAnswers(nextAnswers);
    setHistory([...history, { question, value: value.trim(), label: label.trim() }]);
    void requestAssessment(nextAnswers);
  }

  function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitAnswer(draft);
  }

  function restart() {
    setConfirmRestart(true);
  }

  function clearConversation() {
    setConfirmRestart(false);
    setSavedHandoff(null);
    setSubmissionKey("");
    controller.current?.abort();
    controller.current = null;
    setAnswers([]);
    setHistory([]);
    setResponse(null);
    setDraft("");
    setChoiceFilter("");
    setBusy(false);
    setError("");
    setPending(null);
    setStarted(false);
    setConsent(false);
  }

  function changePendingAnswer() {
    if (busy || !history.length) return;
    const lastTurn = history[history.length - 1];
    setDraft(lastTurn.question.kind === "text" ? lastTurn.value : "");
    setHistory(history.slice(0, -1));
    setAnswers(answers.slice(0, -1));
    setError("");
    setPending(null);
  }

  function downloadSummary() {
    if (!result) return;
    const content = [
      "PHARMACY ASSISTANT — FICTIONAL CASE SUMMARY",
      "Educational prototype. This is not a diagnosis or prescription.",
      "Mode: " + modeLabel,
      ...(savedHandoff ? [
        "", "PHARMACY SUBMISSION",
        "Reference: " + savedHandoff.receipt.reference,
        "Fictional patient: " + savedHandoff.patient.displayName,
        "Submitted: " + savedHandoff.receipt.createdAt,
        "Contact preference: " + (savedHandoff.patient.contactPreference === "in_person" ? "In person" : savedHandoff.patient.contactPreference),
        ...(savedHandoff.patient.contact ? ["Contact: " + savedHandoff.patient.contact] : []),
        "Saved to the local pharmacy dashboard. This is not an appointment or a prescription.",
      ] : []),
      "",
      "ANSWERS ENTERED IN THIS CONVERSATION",
      ...history.flatMap((turn) => [turn.question.text, turn.label, ""]),
      "SUGGESTED NEXT STEP",
      result.title,
      result.message,
      "",
      "ABOUT A PRESCRIPTION",
      result.prescription,
      "",
      ...result.nextSteps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "SOURCES",
      ...result.sources.map((source) => `${source.title}: ${source.url}`),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pharmacy-assessment-fictional-summary.txt";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="assessment-page">
      <a className="assessment-skip" href="#assessment-conversation">Skip to assessment</a>
      <header className="assessment-topbar">
        <Link className="assessment-brand" href="/" aria-label="Pharmacy Assistant home"><span className="assessment-brand-mark">Rx</span><span>Pharmacy Assistant</span></Link>
        <nav className="assessment-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/assessment" aria-current="page">Assessment</Link><Link href="/pharmacy">Pharmacy dashboard</Link><span className="assessment-province"><span /> Ontario</span></nav>
      </header>

      <section className="assessment-intro" aria-labelledby="assessment-title">
        <div><p className="assessment-eyebrow">A LITTLE CLARITY. A NEXT STEP.</p><h1 id="assessment-title">Let’s talk about<br /><em>how you’re feeling.</em></h1><p className="assessment-intro-copy">A guided conversation to explore whether an Ontario pharmacist may be able to help with a minor ailment.</p></div>
        <div className="assessment-intro-note"><span className="assessment-note-icon"><Icon name="chat" size={26} /></span><p>One question at a time.<br /><strong>A clearer way forward.</strong></p></div>
      </section>

      <div className="assessment-notice"><span className="assessment-demo-label">CAPSTONE DEMO</span><p>Use fictional details only. A pharmacist must assess you and decide if a prescription is appropriate.</p></div>

      <div className="assessment-layout">
        <aside className="assessment-sidebar" aria-label="Assessment overview">
          <div className="assessment-steps-panel"><p className="assessment-eyebrow">YOUR CONVERSATION</p><ol className="assessment-steps">{sections.map((section, index) => <li key={section} className={index === currentSection ? "is-current" : index < currentSection ? "is-complete" : ""} aria-current={started && index === currentSection ? "step" : undefined}><span className="assessment-step-number">{index < currentSection ? <Icon name="check" size={15} /> : `0${index + 1}`}</span><span>{section}</span>{index === currentSection && <span className="assessment-step-dot" />}</li>)}</ol></div>
          <div className="assessment-summary-panel"><h2>Your answers <span>{history.length.toString().padStart(2, "0")}</span></h2>{history.length ? <details className="assessment-answers" open><summary>Review what you’ve shared</summary><dl>{history.map((turn, index) => <div key={`${turn.question.id}-${index}`}><dt>{turn.question.text}</dt><dd>{turn.label}</dd></div>)}</dl></details> : <p>Your answers will appear here as we go. You can review them before taking your next step.</p>}</div>
          <div className="assessment-scope-note"><strong>Prepared for your pharmacist.</strong><p>Explore Ontario’s minor ailment categories through an adult intake conversation. A pharmacist will assess your symptoms and discuss suitable care.</p></div>
        </aside>

        <section className="assessment-chat-card" id="assessment-conversation" aria-label="Minor ailment assessment conversation">
          <header className="assessment-chat-header"><div className="assessment-assistant-avatar"><Icon name="chat" size={23} /></div><div className="assessment-chat-title"><h2>Your assessment guide</h2><span><i aria-hidden="true" />{modeLabel}</span></div>{started && <button className="assessment-restart" onClick={restart} type="button" aria-expanded={confirmRestart} aria-controls="assessment-restart-confirmation"><Icon name="restart" size={15} /><span>Start over</span></button>}</header>
          {confirmRestart && <div className="assessment-restart-confirmation" id="assessment-restart-confirmation" role="alert" aria-labelledby="assessment-restart-title"><h3 id="assessment-restart-title">Start a new assessment?</h3><p>{savedHandoff ? `This will clear your conversation here. Submitted case ${savedHandoff.receipt.reference} remains saved in the pharmacy dashboard.` : "This will clear your unsent conversation here. Any case already saved or currently being sent will remain in the pharmacy dashboard."}</p><div><button ref={keepConversation} className="assessment-secondary" type="button" onClick={() => setConfirmRestart(false)}>Keep conversation</button><button className="assessment-text-button" type="button" onClick={clearConversation}>Clear and start over</button></div></div>}
          <p className="assessment-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{result ? `Your next step: ${result.title}` : question ? `New question: ${question.text}` : ""}</p>
          <div className="assessment-emergency"><button type="button" onClick={() => setEmergencyOpen(!emergencyOpen)} aria-expanded={emergencyOpen} aria-controls="assessment-emergency-help"><Icon name="help" size={16} /><span>Need urgent help?</span><span className="assessment-emergency-toggle" aria-hidden="true">{emergencyOpen ? "−" : "+"}</span></button>{emergencyOpen && <div id="assessment-emergency-help" role="alert"><strong>For a medical emergency, call 911.</strong><p>If you have severe trouble breathing, chest pain, or swelling of your tongue or throat, seek emergency help immediately. Don’t wait for this chat.</p><a href="tel:911">Call 911 <Icon name="arrow" size={16} /></a><p>For non-emergency health advice in Ontario, call <a href="tel:811">811</a>.</p></div>}</div>

          {!started ? <div className="assessment-welcome"><div className="assessment-welcome-symbol" aria-hidden="true"><span /><span /><span /><Icon name="chat" size={31} /></div><p className="assessment-eyebrow">LET’S BEGIN WITH YOU</p><h2>A few questions.<br />A helpful next step.</h2><p>I’ll ask about your symptoms and relevant health history, then explain whether a pharmacist assessment or another care option may be appropriate.</p><div className="assessment-welcome-facts"><span><Icon name="check" size={16} />No account needed</span><span><Icon name="check" size={16} />Unsent drafts clear on reload</span></div><div className="assessment-consent"><label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={!configuredMode} /><span>I understand this is a demo and will use fictional details.{configuredMode === "jev" && " I understand my answers will be sent to TypeSafe AI to guide the conversation."}</span></label><p>This guide cannot diagnose a condition or issue a prescription. Please leave names, health card numbers, and contact details out of the chat. At the end, you can add a fictional name and contact preference to send your assessment to the local demo dashboard. Submitted cases stay saved until demo data is cleared.</p></div>{!configuredMode && <div className="assessment-configuration" role="status">{configError ? <><p>We couldn’t load the assessment. Please try again.</p><button type="button" className="assessment-text-button" onClick={() => { setConfigError(false); setConfigAttempt(configAttempt + 1); }}>Try again</button></> : "Preparing your conversation…"}</div>}<button className="assessment-primary" type="button" disabled={!consent || !configuredMode} onClick={start}>Start my assessment <Icon name="arrow" size={18} /></button><p className="assessment-welcome-footnote">A short conversation, at your pace.</p></div> : <>
            <div className="assessment-transcript" ref={transcript}>
              <div className="assessment-conversation-start"><span>YOUR CONVERSATION</span><p>Thanks for checking in. Let’s find a sensible next step.</p></div>
              {history.map((turn, index) => <div className="assessment-turn" key={`${turn.question.id}-${index}`}><div className="assessment-message assessment-message-guide"><span className="assessment-speaker">Assessment guide</span><p>{turn.question.text}</p>{turn.question.hint && <p className="assessment-message-hint">{turn.question.hint}</p>}</div><div className="assessment-message assessment-message-user"><span className="assessment-speaker">You</span><p>{turn.label}</p></div></div>)}
              {response?.notice && <p className="assessment-mode-notice" role="status">{response.notice}</p>}
              {question && <div className="assessment-current-message"><span className="assessment-speaker">Assessment guide <span>· {question.section}</span></span><h3 ref={activeQuestion} tabIndex={-1} aria-describedby={question.hint ? "assessment-question-hint" : undefined}>{question.text}</h3>{question.hint && <p className="assessment-question-hint" id="assessment-question-hint">{question.hint}</p>}{question.kind === "choice" && <>{hasLongChoiceList && <div className="assessment-choice-search"><label htmlFor="assessment-choice-search">Find a concern</label><input type="search" id="assessment-choice-search" placeholder="Search symptoms or conditions…" value={choiceFilter} onChange={(event) => setChoiceFilter(event.target.value)} /><p role="status">{visibleChoices?.length} options shown. Choose the closest match, or search for “other”.</p></div>}<div className={`assessment-choices${hasLongChoiceList ? " assessment-choices-scroll" : ""}`} aria-label="Choose your answer">{visibleChoices?.map((option) => <button type="button" key={option.value} onClick={() => submitAnswer(option.value, option.label)} disabled={busy}>{option.label}<Icon name="arrow" size={16} /></button>)}{visibleChoices?.length === 0 && <p className="assessment-choice-empty">No matching option. <button className="assessment-text-button" type="button" onClick={() => setChoiceFilter("")}>Show all concerns</button></p>}</div></>}</div>}
              {busy && <div className="assessment-loading" role="status"><span className="assessment-loading-dots" aria-hidden="true"><i /><i /><i /></span><span>{history.length ? "Considering your answers…" : "Opening your conversation…"}</span></div>}
              {error && <div className="assessment-error" role="alert"><strong>Let’s try that again.</strong><p>{error}</p><div><button className="assessment-secondary" type="button" onClick={() => pending !== null && void requestAssessment(pending)}>Retry</button>{history.length > 0 && <button type="button" className="assessment-text-button" onClick={changePendingAnswer}>Change my last answer</button>}</div></div>}
              {result && <article className={`assessment-result assessment-result-${result.kind}`}><p className="assessment-eyebrow">YOUR NEXT STEP</p><h2 ref={resultHeading} tabIndex={-1}>{result.title}</h2><p>{result.message}</p><div className="assessment-prescription"><h3>What about a prescription?</h3><p>{result.prescription}</p></div><h3>What to do next</h3><ol>{result.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>{result.kind === "emergency" && <a className="assessment-primary" href="tel:911">Call 911 <Icon name="arrow" size={18} /></a>}{canSubmitAssessment(answers, result) && submissionKey && <PharmacySubmission key={submissionKey} answers={answers} submissionKey={submissionKey} onSubmitted={setSavedHandoff} />}<div className="assessment-result-actions"><button className="assessment-secondary" type="button" onClick={downloadSummary}><Icon name="download" size={17} />Download my summary</button><button type="button" className="assessment-text-button" onClick={restart}>Start a new assessment</button></div><p className="assessment-result-note">Your summary contains the answers you entered and this suggested next step. It is not a diagnosis or prescription.</p><div className="assessment-sources"><h3>Learn more from official sources</h3>{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<span aria-hidden="true">↗</span><span className="assessment-visually-hidden"> (opens in a new tab)</span></a>)}</div></article>}
            </div>
            {question?.kind === "text" && <form className="assessment-composer" onSubmit={submitText}><label htmlFor="assessment-answer">Your answer</label><div><textarea id="assessment-answer" rows={2} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type your answer here…" aria-describedby="assessment-input-note" disabled={busy} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitAnswer(draft); } }} /><button type="submit" disabled={!draft.trim() || busy} aria-label="Send your answer"><Icon name="arrow" size={21} /></button></div><p id="assessment-input-note">Fictional details only. Enter to send; Shift + Enter for a new line.<span>{draft.length}/1,000</span></p></form>}
            <footer className="assessment-chat-footer"><span>{result ? "Conversation complete" : `${answers.length} ${answers.length === 1 ? "answer" : "answers"} shared`}</span><span>For demonstration only</span></footer>
          </>}
        </section>
      </div>
      <footer className="assessment-page-footer"><span>Pharmacy Assistant <span aria-hidden="true">·</span> COMP 385</span><p>Thoughtful questions. Informed conversations with your pharmacist.</p><Link href="/">Back to home <span aria-hidden="true">↗</span></Link></footer>
    </main>
  );
}
