# Assessment handoff and pharmacy dashboard

This is a local educational workflow using fictional cases. It is not connected to a real pharmacy. The dashboard has no staff authentication and must not be deployed for real patient information.

## Patient flow

1. Finish the conversational assessment at `/assessment`.
2. Eligible adult Ontario cases show a handoff form after the screening result. The patient supplies a fictional display name, chooses in-person/phone/email contact, and acknowledges that the entered information will be saved to the demo dashboard.
3. **Send to pharmacy** posts the original answers and contact details. The server validates the entire conversation and recomputes its summary and result.
4. The patient receives a reference number and a link to the local demo dashboard. This confirms storage, not an appointment, contact attempt, pharmacist assessment, or prescription.

Emergency and urgent outcomes keep their direct-care instructions and cannot enter the routine pharmacy queue. Non-Ontario, under-18, nonterminal, and concern-free assessments cannot be submitted. Terminal incomplete or other-concern cases may be sent when otherwise eligible; their unresolved/outside-scope outcome remains visible to the reviewer.

The submission key is unique to the conversation. Retrying the same payload returns the original receipt. Reusing a key for different information is a conflict. Contact details are collected after the AI interaction and never passed to Jev. Reloading a draft clears it; restarting or reloading after submission does not delete the stored case.

## Staff flow

`/pharmacy` shows counts for New, In review and Completed, with search and status filtering. The list returns up to 200 recent matching cases. Auto refresh updates the queue; the detail panel preserves unsaved review edits. Select a case to view patient details, original answers, the screening result and linked references, and the review history.

Save a required reviewer name, notes and status. Completion also requires notes. A completed case may be reopened as needed. These are simulated review states, not clinical authorization. Original assessment answers and results remain unchanged; each review change is appended to the case history. Version checks reject stale updates so a reviewer can reload the latest case before saving again.

## Server API

| Method and route | Request | Response |
| --- | --- | --- |
| POST `/api/pharmacy/cases` | `{submissionKey, patient: {displayName, contactPreference, contact}, answers, consentToShare: true}` | `{receipt: {id, reference, createdAt, status}}`; 201 on creation, 200 on identical retry |
| GET `/api/pharmacy/cases?q=...&status=...` | Optional search and status | `{cases, counts, total}`; counts cover the entire queue |
| GET `/api/pharmacy/cases/:id` | Case UUID | `{case}` including answer snapshot, screening result and review history |
| PATCH `/api/pharmacy/cases/:id` | `{status, reviewerName, reviewNotes, version}` | `{case}` with incremented version and appended review event |

Input errors return 400; foreign-origin writes 403; missing cases 404; changed idempotent payloads and stale review versions 409; oversized requests 413; unsupported content types 415. Errors use `{error: string}`. Responses are not cached. Same-origin checks and validation are not staff authorization.

## Persistence and runtime

Node.js 22.13+ is required for the built-in `node:sqlite` module without a feature flag. The development machine uses Node 22.14. No external database service is required. SQLite initializes lazily on the first request. Parameterized statements protect data values, and transactions protect case creation and review history writes.

`PHARMACY_DATABASE_PATH` defaults to `./data/pharmacy-dashboard.sqlite`, separate from the older proposed schema. The database and its journal/WAL companions are ignored by Git. Do not place the database in `public/`, commit it, or copy real patient records into it. This local file is not encrypted by the application. The app does not automatically purge submitted cases; resetting a chat only clears the browser draft.

## Checks and remaining work

Tests use temporary SQLite databases and exercise submission validation, idempotency, persisted records after reopening, status edits, required completion notes, conflicts, and immutable intake snapshots. These checks do not establish clinical validity or privacy compliance.

Before real patient use, implement staff authentication and access controls, patient identity/consent requirements, suitable deployment and encryption, retention/deletion policies, audit access, clinician-reviewed pathways, privacy review, and an operational follow-up process. None is implied by the demo queue or a Completed status.
