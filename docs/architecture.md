# Planned architecture

> October 21, 2026 update: patient intake at `/assessment`, the Jev adapter, submission to `/pharmacy`, SQLite dashboard storage, and reviewer notes/status history are implemented. See [patient-assessment.md](patient-assessment.md) and [pharmacy-dashboard.md](pharmacy-dashboard.md). Prescription verification and the original evaluation schema below remain planned.

## Application boundary

The first release is a local, single-operator demonstration. Assessment and prescription intake enter one case record, but they follow separate supported workflows. The interface presents findings and their source links for pharmacist review. It does not make or authorize a prescribing decision.

## Agent roles

| Agent | Responsibility | Fixed application checks |
| --- | --- | --- |
| Intake | Turn typed assessment or prescription details into editable fields; identify missing or unclear answers. | Validate required fields and preserve the original input. Never fill a clinical gap with an invented answer. |
| Assessment | Compare a completed adult case with the two supported ailment pathways. | Check scope and warning rules before displaying possible options. Return options for review, more information needed, referral, or outside scope. |
| Verification | Review a typed existing or pharmacist-drafted prescription. | Check six core fields, recorded ingredient allergies, duplicate ingredients, and only the documented dose or interaction rules. Show checks that were not performed. |

One pretrained model may serve all three roles with separate prompts and tools. Deterministic application rules constrain its inputs and outputs. The model does not decide which medicines are legally authorized.

## Proposed request flow

1. The operator enters a fictional assessment or typed prescription and confirms extracted details.
2. The intake role flags unanswered or ambiguous fields for correction.
3. The assessment or verification workflow runs only after the case is in scope.
4. Fixed checks run alongside the model and block treatment options when a warning or required detail is unresolved.
5. The interface records findings, unchecked areas, linked references, and the versions used.
6. A simulated reviewer records the final decision and any follow-up notes.

Changed inputs should mark prior results as out of date. New or corrected prescription drafts return through verification before a review can be completed.

## Initial storage model

`database/schema.sql` sketches four linked records:

- `cases`: synthetic case type, dataset split, current status, and structured input.
- `agent_runs`: agent role, model and prompt versions, result, source IDs, status, and duration.
- `reference_sources`: saved source title, URL, version/date, and notes.
- `review_decisions`: explicit simulated reviewer decision, reason, and follow-up notes.

The schema is a starting point. It is not a production medical record system and does not yet provide a database connection or migration runner.

## Scope exclusions

No real patient use, autonomous prescribing, dispensing, billing, pharmacy-system integration, handwriting or image recognition, voice input, comprehensive interaction checking, public hosting, model training, prescription authenticity checks, or prescriber registration checks.
