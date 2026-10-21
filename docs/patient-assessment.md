# Patient conversational assessment

Implemented October 21, 2026 as a local, synthetic-data capstone feature. This expands the intake catalogue beyond the original two-ailment proposal; it does not implement 28 clinical treatment algorithms.

## Workflow

1. Explain the prototype and provider data use; obtain acknowledgement.
2. Screen emergency symptoms first, then adult-demo scope and current Ontario location.
3. Ask for the selected concern, symptoms, time course, severity, warning signs, and additional detail.
4. Collect pregnancy/breastfeeding status, medicines, allergies, conditions, and treatments tried. Jev can order the remaining approved questions, but every required field remains required.
5. Return emergency/urgent care, outside scope, incomplete intake, or potential pharmacist assessment with a summary and sources.

All patient answers remain untrusted data. The server validates fields, lengths, option values, ordering, duplicate answers and terminal states on every request. Safety confirmations prompted by new text are required even after an earlier denial. An arbitrary model choice cannot skip questions or select a treatment.

## Routes and provider

- `GET /api/assessment`: `{mode: "demo" | "jev"}` reports whether a server key is configured; it is not a connectivity test.
- `POST /api/assessment`: `{consent: true, providerConsent: boolean, answers: [{questionId, value}]}` returns the next authored question or terminal result, mode, summary, progress and optional fallback notice. When Jev is configured, provider consent must be true; a stale demo page cannot submit answers to a newly enabled provider without fresh acknowledgement.
- Unknown/invalid inputs return 400, foreign origins 403, unsupported content types 415, and excessive requests 429. Responses use `Cache-Control: no-store`. The body is bounded to 48 KB and each answer to 1,200 characters.
- The in-process limiter is only a local guard. It trusts `x-forwarded-for`; a hosted application must use a trusted proxy and durable shared rate limiting.
- `lib/assessment/jev.ts` calls the official `POST https://api.typesafe.ai/v1/systemone`, using server-only Bearer credentials, `state`, and a `choice` question named `next_question`.
- Responses must name an allowed candidate and contain valid type, probabilities, confidence, model, and usage fields. A 12-second timeout, failed request, invalid output, or confidence below 0.6 uses the first approved question instead. This threshold controls question ordering only; confidence is not clinical accuracy.
- Results are authored by the application. The mode denotes configured/used provider; completion itself is deterministic, including when the last question used fallback. No provider is asked to issue or decide a prescription.

## Reviewed references

Scope checked **2026-10-21** against the [Ontario College of Pharmacists current catalogue](https://ocpinfo.com/pharmacy-professionals/expanded-scope-of-practice/minor-ailments/). It lists 28 conditions. Each condition has specific authorized drugs and clinical suitability requirements; catalogue membership alone does not establish suitability. Future proposed conditions are not included.

- [Ontario pharmacy services](https://www.ontario.ca/page/pharmacies)
- [Ontario emergency rooms](https://www.ontario.ca/page/emergency-rooms): emergency signs and 911.
- [Ontario Health811 information](https://www.ontario.ca/page/your-health-plan-connected-and-convenient-care): registered-nurse advice and help locating care.
- [OCP prescribing guideline](https://ocpinfo.com/pharmacy-professionals/rules-and-standards-of-the-profession/practice-policies-guidelines/pharmacist-prescribing-initiating-adapting-and-renewing-prescriptions/): professional assessment and prescribing responsibility.
- [TypeSafe System One](https://docs.typesafe.ai/api/system-one), [choice response](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceResponse), and [models](https://docs.typesafe.ai/models): actual provider contract.

## Limits and next work

This is an intake and scope-navigation prototype, not a diagnostic or prescribing tool. Text triggers are deliberately limited conservative pattern matches. They can miss symptoms, misinterpret negation, and over-refer. The structured warning list is not exhaustive. Unknown answers are preserved; the software cannot verify the truth or completeness of self-report. No drug interaction, allergy compatibility, dose or condition-specific eligibility check is performed. A pharmacist must review any next steps.

The prototype's adult restriction is not an Ontario regulatory age restriction. Chat drafts remain in browser memory. A completion form now collects a fictional name and optional callback details, with separate consent to save the assessment to the local pharmacy dashboard. Submitted records persist in SQLite; a chat restart does not delete them. These handoff contact details are never included in Jev requests. Identity verification, appointment booking, staff authentication, and external pharmacy communication remain unimplemented. With a configured key, fictional chat answers are sent to TypeSafe; the app does not promise provider-side deletion or retention settings. See [pharmacy-dashboard.md](pharmacy-dashboard.md).

Before real patient use: pharmacist-reviewed condition-specific pathways and sources, validated triage including free text, clinical evaluation, privacy/consent/provider review, authentication and authorization, secure records, auditable reviewer decisions, and appropriate operational controls are needed. These have not been completed here.

## Verification

`npm.cmd test` exercises the real screening engine and mocked Jev adapter: early/late emergencies, repeat safety checks, referral and unknown states, malformed/tampered intake, required history, API failure/timeout, invalid choices and no-key behavior. These are software checks, not evidence of clinical performance. A production build checks types and route compilation. Live Jev account integration requires the user's key and remains unverified until exercised.
