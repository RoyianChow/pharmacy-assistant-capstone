# Capstone completion plan · November 9–December 4, 2026

**First task:** build one fictional typed prescription from entry to review. Show the original text beside six editable fields: medicine, strength, dose, route, frequency and quantity. Leave the route blank in the first example and verify that the app asks for clarification. This gives the verification rules, reviewer workflow and evaluation a common input.

These are proposed working dates for one developer. December 4 is a demo target; the course submission date still needs confirmation. The baseline is the COMP 385 Group 3 proposal (scope and deliverables, pp. 1–5; requirements and evaluation, pp. 7–10). Use [the requirement IDs and scorecard](requirements.md) to track delivery.

## Where the project stands on November 8

| Area | What works | What is left |
| --- | --- | --- |
| [Assessment and Jev](patient-assessment.md) | The chat collects adult intake, preserves unknown answers, screens for warnings, provides a summary and hands eligible fictional cases to the pharmacy. Jev selects from approved questions with a guided fallback. | Implement source-backed decision rules for the two proposed pathways: allergic rhinitis and cold sores. The broader condition picker alone cannot determine which options a pharmacist should review. |
| [Pharmacist dashboard](pharmacy-dashboard.md) | Staff can search the queue, review original answers, save notes and status, and recover from conflicting edits. A previous production check confirmed persistence after reload. | Save an explicit simulated decision, rationale and follow-up. Link it to the assessment or prescription version reviewed. An edit must invalidate the affected findings and require a new review. |
| [Prescription workspace](prescription-verification.md) | Local PaddleOCR extracted 12 labelled fields on the supplied Ontario fixture. Vercel serves the [classifier](prescription-classifier-aws.md), which runs on the user’s device for the two fictional samples. | Implement editable typed input, the six separate fields, and sourced ingredient and product checks. OCR currently groups dose, route and frequency under directions. Hosted OCR URL and token were absent from Vercel Production settings on November 8. Use local OCR for the demo if desired. |
| [Evaluation data](../data/README.md) and submission | The requirements, dataset split and proposed schema are documented. The app suite passed **151/151 tests** on November 8 at `3c53dad`. | Create the labelled 100-case corpus, run the frozen evaluation, and assemble the diagrams, results, report and presentation. The classifier’s separate 96-image test set does not measure the assessment or typed-prescription requirements. |

## Weekly milestones

Jev already supports the intake role. In weeks 2 and 3, give the proposed assessment and verification roles distinct, structured outputs that the dashboard can show and the scoring script can compare. Record which decisions come from fixed rules and which use a model.

| Week | Work, in dependency order | Evidence to finish the week |
| --- | --- | --- |
| **1 · Nov 9–13** — establish scope and cases | Build the typed-entry example above. Select a small Canadian product list (up to six). Record ingredient mappings, official sources, versions and dates for supported checks and Ontario ailment–drug pairings. Define the expected labels and assemble 50 fictional assessments and 50 typed prescriptions. Assign related case templates to the same split. | The example preserves its source text and missing route. A manifest lists stable IDs, source IDs, expected status/fields/issues, and **30 development + 20 reserved cases per workflow**. Lock the final cases and use only the development split for implementation. |
| **2 · Nov 16–20** — implement the two decision workflows | Finish adult allergic rhinitis and cold sore pathways with four outcomes: possible options for pharmacist review, more information needed, referral, or outside scope. Apply warning and missing-information checks before showing any option. For typed prescriptions, check missing fields, recorded ingredient allergies, duplicate ingredients and only the selected dose or interaction rules supported by the saved references. | Run development examples for each outcome and finding. A designated warning blocks options; an unsupported product lists the checks skipped; each option or clinical finding opens its supporting source. Keep the patient-facing handoff distinct from staff review. |
| **3 · Nov 23–27** — complete review and freeze | Connect both entry points to the case record. Retain the original input, edits, findings, model/prompt/rule/reference versions and timestamps. Make corrected or newly drafted prescriptions pass through verification before completion. Add explicit decisions, rationale, follow-up and deletion for fictional evaluation records. | Submit a fictional assessment and a typed prescription. Edit an input and show that its earlier result is marked stale, completion is blocked until rechecked, and the old version remains visible. Save a decision, reload and compare it with history. Verify deletion on a disposable case. Tag the tested code and freeze the rules, references and scoring script. |
| **4 · Nov 30–Dec 4** — evaluate and present | Run the 40 reserved cases on the frozen version. Record timing, missed warnings, false alerts and unsupported checks. Exercise failure recovery and run the same usability tasks with three volunteers. Prepare the report, updated workflow/data diagrams, results table and a short demonstration with fictional cases. | Publish the run manifest, measured counts and limitations alongside the frozen commit. Rehearse one assessment handoff and one typed prescription correction through the reviewer decision. Keep the proposal’s **six-hour buffer** for fixes and rehearsal. Record any post-freeze fixes separately from the original evaluation. |

## Final scorecard

Use the final set once for scoring. Its 20 assessments should include 6 possible-option, 5 referral, 5 incomplete and 4 outside-scope cases. Its 20 prescriptions should include 12 with supported issues, 4 with no added issue and 4 outside the supported product list.

| Measure | Proposal target and evidence to report |
| --- | --- |
| Assessment status | At least **18/20** expected statuses. Report counts by outcome and describe each mismatch. |
| Prescription extraction | At least **114/120** correctly extracted fields across the 20 prescriptions. Score extraction before reviewer edits. An expected missing value is correct only if it stays missing. |
| Prescription findings | Detect **at least 90%** of labelled in-scope issues; **at least 80%** of raised alerts must be correct. Publish detected, missed and false alert counts. |
| Warnings and citations | **Every** designated warning blocks options. Every suggested option and clinical finding has a verified source. Record missed critical warnings and unsupported suggestions individually. |
| Timing, usability and recovery | **18/20** timed runs finish within **20 seconds** for one user. **2/3** volunteers complete intake and find a report source unaided. Show recovery from a timeout, malformed result, missing reference and misleading input. |
| Data and traceability | Use fictional records, verify server-side credential handling and case deletion, and trace each decision back to its inputs and run versions. If pharmacist review is unavailable, describe agreement with student-authored labels as a software result. |

If time runs short, reduce the number of supported products or optional interaction checks first. Keep both core pathways, warning gates, human review and the held-out evaluation. AWS provisioning, broader image classification and a hosted OCR service are outside this four-week plan.
