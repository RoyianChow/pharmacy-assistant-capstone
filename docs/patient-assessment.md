# Patient conversational assessment

Implemented October 21, 2026 as a synthetic-data capstone feature. It can run locally or as a hosted demonstration. This expands the intake catalogue beyond the original two-ailment proposal; it does not implement 28 clinical treatment algorithms.

## Workflow

1. Explain the prototype and provider data use; obtain acknowledgement.
2. Screen emergency symptoms first, then adult-demo scope and current Ontario location.
3. Ask for the selected concern, symptoms, time course, severity, warning signs, and additional detail.
4. Collect pregnancy/breastfeeding status, medicines, allergies, conditions, and treatments tried. Jev orders the remaining approved questions and recognizes requests to explain a question or discuss treatment. Replies use authored templates; every required field remains required.
5. Return emergency/urgent care, outside scope, incomplete intake, or potential pharmacist assessment with a summary and sources.

All patient answers remain untrusted data. The server validates fields, lengths, option values, ordering, duplicate answers and terminal states on every request. Safety confirmations prompted by new text are required even after an earlier denial. Mentions of urgent symptoms now ask about current symptoms, so a negated symptom or old reaction does not automatically become an urgent referral. Inability to keep fluids down prompts a fresh check. Suspected wart location is collected as a structured choice; face/genital locations are outside this pathway. An arbitrary model choice cannot skip questions or select a treatment.

## Routes and provider

- `GET /api/assessment`: `{mode: "demo" | "jev"}` reports whether a server key is configured; it is not a connectivity test.
- `POST /api/assessment`: `{consent: true, providerConsent: boolean, answers: [{questionId, value}]}` returns the next authored question or terminal result, mode, summary, progress, optional authored `reply`, and optional fallback notice. A `retryAnswer: true` response repeats the last text question and excludes that attempted answer from summary/progress; the client removes only that last optimistic answer. Explicit uncertainty stays an accepted answer. When Jev is configured, provider consent must be true; a stale demo page cannot submit answers to a newly enabled provider without fresh acknowledgement.
- Unknown/invalid inputs return 400, foreign origins 403, unsupported content types 415, and excessive requests 429. Responses use `Cache-Control: no-store`. The body is bounded to 48 KB and each answer to 1,200 characters.
- The in-process limiter is only a local guard. It trusts `x-forwarded-for`; a hosted application must use a trusted proxy and durable shared rate limiting.
- `lib/assessment/jev.ts` calls the official `POST https://api.typesafe.ai/v1/systemone`, using server-only Bearer credentials, `state`, and typed choices for question ordering and the latest text answer's conversational intent. No model-written clinical advice is displayed.
- Responses must name allowed choices and contain valid type, probabilities, confidence, model, and usage fields. Failed requests, malformed outputs, and the bounded timeout fall back to approved questions. Uncertainty between safe history-question options does not itself imply the provider is unavailable; intent-based answer retries require a separate confidence check. Model confidence is not clinical accuracy.
- `guided` means the app served an authored step without asking Jev for that turn. Singleton choice steps and safety checks avoid unnecessary provider calls. `jev` means a valid provider response was used; `fallback` means an attempted provider response failed validation or was unavailable; `demo` means no provider key is configured. Results themselves remain authored and deterministic. No provider is asked to issue or decide a prescription.

## Reviewed references

Scope checked **2026-10-21** against the [Ontario College of Pharmacists current catalogue](https://ocpinfo.com/pharmacy-professionals/expanded-scope-of-practice/minor-ailments/). It lists 28 conditions. Each condition has specific authorized drugs and clinical suitability requirements; catalogue membership alone does not establish suitability. Future proposed conditions are not included.

- [Ontario pharmacy services](https://www.ontario.ca/page/pharmacies)
- [Ontario emergency rooms](https://www.ontario.ca/page/emergency-rooms): emergency signs and 911.
- [Ontario Health811 information](https://www.ontario.ca/page/your-health-plan-connected-and-convenient-care): registered-nurse advice and help locating care.
- [OCP prescribing guideline](https://ocpinfo.com/pharmacy-professionals/rules-and-standards-of-the-profession/practice-policies-guidelines/pharmacist-prescribing-initiating-adapting-and-renewing-prescriptions/): professional assessment and prescribing responsibility.
- [TypeSafe System One](https://docs.typesafe.ai/api/system-one), [choice response](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceResponse), and [models](https://docs.typesafe.ai/models): actual provider contract.

## Limits and next work

This is an intake and scope-navigation prototype, not a diagnostic or prescribing tool. Text triggers are deliberately limited conservative pattern matches. They can miss symptoms or prompt an unnecessary confirmation; the structured warning list is not exhaustive. Unknown answers, including natural phrases such as “I am not sure which tablets I take,” are preserved for professional review. The software cannot verify the truth or completeness of self-report. No drug interaction, allergy compatibility, dose or comprehensive condition-specific eligibility check is performed. A pharmacist must review any next steps.

The prototype's adult restriction is not an Ontario regulatory age restriction. Chat drafts remain in browser memory. A completion form now collects a fictional name and optional callback details, with separate consent to save the assessment to the pharmacy dashboard. Submitted records persist in the configured PostgreSQL database, or SQLite when running locally without a database URL; a chat restart does not delete them. These handoff contact details are never included in Jev requests. Patient identity verification, appointment booking, and external pharmacy communication remain unimplemented. Hosted case reads and review changes require an approved staff account through Neon Auth. Patient submission remains public, and creating an account does not grant staff access. The receipt's dashboard link is for staff; patients do not need to sign in to finish submitting. Only local development with no remote database or Auth configuration retains the original unauthenticated demo. Real patient information must not be entered. With a configured key, fictional chat answers are sent to TypeSafe; the app does not promise provider-side deletion or retention settings. See [pharmacy-dashboard.md](pharmacy-dashboard.md) and [staff access](neon-auth.md).

Before real patient use: pharmacist-reviewed condition-specific pathways and sources, validated triage including free text, clinical evaluation, privacy/consent/provider review, a full access-control and record-security review, retention and audit policies, and appropriate operational controls are needed. Basic staff authentication and review history do not establish those requirements or clinical readiness.

## Verification

`npm.cmd test` exercises the real screening engine and mocked Jev adapter: early/late emergencies, repeat safety checks, negated/historical symptoms, hydration warnings, wart location, natural uncertainty, clarification rollback, final-answer questions, malformed/tampered intake, required history, API failure/timeout, invalid choices and no-key behavior. These are software checks, not evidence of clinical performance. A production build checks types and route compilation.

With the app running, `node scripts/verify-jev-conversation.mjs` is an opt-in live check using fictional inputs. Set `QA_BASE_URL` for the desired app (default `http://localhost:3005`). It exercises the assessment endpoint, including real Jev calls when configured, without creating pharmacy cases. Do not use real patient details for this check.

Verification recorded on 2026-10-21: all 82 automated tests passed, `npm.cmd run build` completed successfully, and the local live check passed all 26 HTTP requests (12 validated Jev responses, 14 guided responses, zero fallbacks). Browser checks confirmed clarification retries, previous-answer correction, preserved over-limit drafts, and current-symptom clarification. Only fictional assessment inputs were used; the live conversation check did not write pharmacy cases or accounts.

### Follow-up verification — 2026-10-25

- The home, assessment, staff sign-in, and dashboard headers now render one shared `SiteBrand` component. Its Rx mark and wordmark use one stylesheet loaded by the root layout. Browser comparisons confirmed matching rendered logo styles through home-to-login navigation and on the assessment page.
- Submission responses are interpreted safely even when a gateway returns HTML, an empty body, malformed JSON, or a failed response stream. Definite 400/422 validation rejections unlock the details for correction; uncertain failures retain the original payload and submission key. Technical parser messages and upstream failure details are not displayed.
- All 99 automated tests passed, along with lint and the production build. New tests cover shared-brand rendering and stylesheet loading, and submission response handling.
- The live Jev check passed 26 HTTP requests: 11 validated Jev responses, 15 guided responses, and no fallbacks. It covered all 14 required answers, clarification and treatment questions, unknown answers, warning confirmations, and out-of-scope results.
- Browser checks covered consent, concern search (including no matches), a retained 1,201-character draft with Send disabled, clarification without adding an answer, previous-answer correction, and keeping a draft after cancelling restart.
- A complete fictional assessment was submitted as `QA Demo Casey 1025`, reference `MA-D14D8C6B86A1`. A rejected phone number left the fields editable; switching to in-person contact permitted submission. All 14 displayed answers matched the hosted dashboard exactly, and the downloaded summary contained the corrected answers, fictional name, and receipt while excluding the rejected clarification question.

These checks used fictional data. The submitted test case remains available in the demo dashboard.
