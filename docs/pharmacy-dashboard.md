# Assessment handoff and pharmacy dashboard

This is an educational workflow using fictional cases, supported locally and as a hosted demonstration. It is not connected to a real pharmacy. The hosted dashboard requires a Neon Auth session and an approved staff identity to view cases or edit reviews. It must not be used for real patient information.

## Patient flow

1. Finish the conversational assessment at `/assessment`.
2. Eligible adult Ontario cases show a handoff form after the screening result. The patient supplies a fictional display name, chooses in-person/phone/email contact, and acknowledges that the entered information will be saved to the demo dashboard.
3. **Send to pharmacy** posts the original answers and contact details. The server validates the entire conversation and recomputes its summary and result.
4. The patient receives a reference number and a staff-dashboard link. The hosted workspace requires staff sign-in; a patient does not need an account to complete submission. The receipt confirms storage, not an appointment, contact attempt, pharmacist assessment, or prescription.

Emergency and urgent outcomes keep their direct-care instructions and cannot enter the routine pharmacy queue. Non-Ontario, under-18, nonterminal, and concern-free assessments cannot be submitted. Terminal incomplete or other-concern cases may be sent when otherwise eligible; their unresolved/outside-scope outcome remains visible to the reviewer.

The submission key is unique to the conversation. Retrying the same payload returns the original receipt. Reusing a key for different information is a conflict. Contact details are collected after the AI interaction and never passed to Jev. Reloading a draft clears it; restarting or reloading after submission does not delete the stored case.

## Staff flow

Open `/auth/sign-in` to sign in, create an account, or verify an email with a code. Registration alone never grants staff access. A verified email must appear in the server's `PHARMACY_STAFF_EMAILS` allowlist, or the account must have explicit user-ID approval. Both the page and protected API routes enforce access. The patient submission endpoint remains public. See [staff onboarding and configuration](neon-auth.md).

`/pharmacy` shows counts for New, In review and Completed, with search and status filtering. The list returns up to 200 recent matching cases. Auto refresh updates the queue; the detail panel preserves unsaved review edits. Select a case to view patient details, original answers, the screening result and linked references, and the review history.

Save a required reviewer name, notes and status. Completion also requires notes. A completed case may be reopened as needed. These are simulated review states, not clinical authorization. Original assessment answers and results remain unchanged; each review change is appended to the case history. Version checks reject stale updates so a reviewer can reload the latest case before saving again.

## Server API

| Method and route | Request | Response |
| --- | --- | --- |
| POST `/api/pharmacy/cases` | `{submissionKey, patient: {displayName, contactPreference, contact}, answers, consentToShare: true}` | `{receipt: {id, reference, createdAt, status}}`; 201 on creation, 200 on identical retry |
| GET `/api/pharmacy/cases?q=...&status=...` | Optional search and status | `{cases, counts, total}`; counts cover the entire queue |
| GET `/api/pharmacy/cases/:id` | Case UUID | `{case}` including answer snapshot, screening result and review history |
| PATCH `/api/pharmacy/cases/:id` | `{status, reviewerName, reviewNotes, version}` | `{case}` with incremented version and appended review event |

Input errors return 400; unauthenticated protected requests 401; foreign-origin writes or unapproved staff requests 403; missing cases 404; changed idempotent payloads and stale review versions 409; oversized requests 413; unsupported content types 415. Missing or invalid hosted database/Auth configuration and unavailable services return 503. Errors include `{error: string}`; Auth failures also include a reason. Responses are not cached. Staff authorization is checked separately from same-origin checks and input validation.

## Persistence and runtime

Node.js 22.13+ is required for local built-in `node:sqlite` support without a feature flag. The development machine uses Node 22.14. Vercel supports Node 22 and 24. Both storage adapters use parameterized queries and transactions for case creation and review history writes.

| Environment | Configuration | Storage |
| --- | --- | --- |
| Local or hosted | `DATABASE_URL` set to a valid PostgreSQL connection URL | PostgreSQL |
| Local or hosted | No `DATABASE_URL`, but valid `NEON_DB` | PostgreSQL through the alternate connection URL |
| Local or hosted | Neither `DATABASE_URL` nor `NEON_DB`, but valid `POSTGRES_URL` | PostgreSQL through the legacy variable alias |
| Local development | None of these database URLs is set | SQLite at `PHARMACY_DATABASE_PATH`, defaulting to `./data/pharmacy-dashboard.sqlite` |
| Vercel (`VERCEL=1`) | Database URL missing or invalid | Explicit 503 configuration error; no SQLite fallback |

`DATABASE_URL` takes precedence over `NEON_DB`, followed by `POSTGRES_URL`. Each variable must contain a PostgreSQL connection URL, not a database name. Keep database credentials on the server and never use a `NEXT_PUBLIC_` name. Add local settings to the existing `.env.local` without replacing its TypeSafe API key. Editing Vercel environment settings does not modify that local file or transfer its key to Vercel; Neon CLI environment pulls update local Neon-managed settings.

The PostgreSQL adapter uses `pg` with Vercel's `attachDatabasePool` helper. The first pharmacy API request initializes its tables and indexes; the configured database role needs `CREATE` on its schema, plus access to read and write the created tables and review history. An existing database role without these permissions must have the required schema provisioned by its administrator. Case creation remains idempotent, and each review update preserves its version check and history transaction.

SQLite also initializes lazily. Its file is separate from the older proposed schema, and the database and journal/WAL companions are ignored by Git. Do not place a database in `public/`, commit it, or copy real patient records into it. The application does not encrypt the local SQLite file. It does not automatically purge submitted cases; resetting a chat only clears the browser draft. Existing local SQLite records are not automatically migrated to PostgreSQL. Switching database configuration selects a different store; it does not copy the previous records.

## Vercel setup

The current workspace is linked to the existing Neon organization/project in the ignored `.neon` file. `neon.ts` declares `auth: true`; no replacement project is required. The Neon CLI and Vercel deploy separate parts of the app: `neon deploy` provisions the declared branch services and pulls Neon environment values, while Vercel hosts the website and route handlers.

1. Inspect the linked branch with `neon status` and review infrastructure changes with `neon config plan`. Apply required declared services with `neon deploy`. Keep existing `.env.local` keys when adding configuration.
2. Set `DATABASE_URL` under **Vercel Project Settings → Environment Variables**, with **Production** selected. `NEON_DB` and `POSTGRES_URL` are accepted in that order if `DATABASE_URL` is absent. Use the provider's required TLS settings. For a database managed through [Neon in Vercel Marketplace](https://vercel.com/marketplace/neon/neon), **Storage → your database → Connect Project** can inject the pooled `DATABASE_URL` without a custom prefix.
3. Set `NEON_AUTH_BASE_URL` from the same branch's deployed Auth service, a stable random `NEON_AUTH_COOKIE_SECRET` of at least 32 characters, and `PHARMACY_STAFF_EMAILS` with exact approved email addresses separated by commas. Register the site's HTTPS origin in the branch's Auth trusted domains. Optional explicit user-ID approval and local trusted domains are documented in [neon-auth.md](neon-auth.md).
4. Keep the existing TypeSafe API key configuration. Database credentials, Auth settings, and the Jev key serve separate integrations. Local `.env.local` settings are not automatically copied to Vercel.
5. Deploy the updated app, and redeploy after connecting a database or editing hosted environment variables. Existing Vercel deployments do not pick up new values.
6. Staff register or sign in at `/auth/sign-in`, verify email ownership when using email approval, and open the workspace after their account is approved. Patient submissions require no account.
7. After deployment, submit a fictional completed assessment and use an approved staff account to open its case. Confirm that the case remains after reloading, a review can be saved, and sign-out removes access. These are deployment checks to perform; code or build success alone does not demonstrate live database or Auth connectivity.

Only local development with no remote database URL and no Auth settings permits the original unauthenticated SQLite demo. Production, Vercel, remote-database use, or partial Auth configuration disables that exception. In those environments an incomplete Auth setup denies staff access; it does not expose the dashboard publicly.

### Why the earlier Vercel submission returned 503

The earlier implementation attempted to initialize a SQLite file in the application's `data` directory. Vercel functions do not have permanent shared local storage suitable for this queue. File creation or opening can fail, producing the generic storage error before an external request is made. The reported request is consistent with this failure; a function error log is needed to identify its exact filesystem exception.

Do not change `PHARMACY_DATABASE_PATH` to `/tmp` as a deployment fix. Temporary files may disappear and are not shared reliably across function instances. The hosted adapter requires PostgreSQL instead. If a 503 persists, check that the new deployment includes `DATABASE_URL`, that the provider is reachable, and that its role can initialize the schema. Never paste credentials or patient data into logs or error reports.

### Hosting references

- [Vercel: SQLite and serverless storage](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [Vercel: connection pooling with Functions](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [Neon: Vercel-managed integration and database environment variables](https://neon.com/docs/guides/vercel-managed-integration)
- [Vercel: environment-variable changes require redeployment](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Vercel: supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [node-postgres: transactions use the same checked-out client](https://node-postgres.com/features/transactions)

## Live handoff verification — 2026-10-21

A fictional seasonal-allergy assessment was completed through the production browser UI, with all 14 required answers collected in Jev's selected order. The completion form was checked across phone, in-person, and email choices, then submitted with a fictional name and email preference.

- The receipt and authenticated dashboard showed the same reference, patient name, contact preference, email, concern, and screening outcome.
- All 14 displayed answers matched their original values and labels, including a multiline medicine list and a specific medication-reaction history. Medicines and allergies appear in the highlighted cards; the other 12 answers appear below.
- A targeted PostgreSQL read confirmed exact patient fields, raw answers/order, summary labels/values, result, and recorded consent. Reloading the dashboard preserved every displayed field.
- Two identical live retries returned the original case. A retry with changed contact details returned 409, and the saved record remained unchanged. Unsigned queue and case reads returned 401.
- Regression coverage now includes full round trips with Unicode and multiline text, adaptive history order, safety clarification, all contact preferences, simultaneous retries, and immutable snapshots. The full suite passed 85 tests, and the production build passed.

This run used fictional information only. It did not send an email, place a call, issue a prescription, or change a staff review. These are software data-transfer checks, not clinical validation.

## Live pharmacist review verification — 2026-10-21

The authenticated production dashboard was tested with fictional case `MA-0D415A9BDB9B` (`QA Demo Morgan 1021-1504`). Its status moved from New to In review, Completed, New, and Completed again. The four successful saves produced four history events and a final record version of 5.

- Saving required a reviewer name, and completing a case also required notes. The Save button stayed disabled when those required fields were empty.
- Reviewer names, multiline notes, status, queue counts, and review history reflected each successful save. A full reload preserved the final Completed status, reviewer `QA Second Reviewer`, exact multiline notes, and all four history entries.
- Closing a case with an unsaved draft displayed a confirmation. **Keep editing** retained the draft.
- In two open dashboard tabs, one tab saved a newer review while the other held an older version. The stale save returned 409 and retained the draft's reviewer name, selected status, and notes. **Load latest version, keep my notes** loaded the newer history while retaining the draft and enabling another save. The rejected save added no history event.
- A targeted, read-only production PostgreSQL check confirmed that the original patient snapshot and submission timestamp were unchanged, the latest review matched exactly, all four history events matched their expected status, reviewer, notes, and version, and the latest review timestamp matched its history event.
- The scoped pharmacy regression suite passed all 30 tests, including multiline and Unicode notes, persistence after reopening storage, status transitions and reopening, concurrent-review recovery, field limits, and protection of original patient fields.
- After restoring the local checkout and reinstalling its locked dependencies, the full suite passed all 90 tests with zero failures, and `npm run build` completed successfully. A fresh PostgreSQL read repeated the exact review and unchanged patient-data checks successfully.

This run used fictional information only. No patient contact or prescription was created. These checks verify review persistence and conflict handling; they do not establish clinical validity.

## Checks and remaining work

Existing tests use temporary SQLite databases and exercise submission validation, idempotency, persisted records after reopening, status edits, required completion notes, conflicts, and immutable intake snapshots. They do not establish hosted PostgreSQL connectivity, clinical validity, or privacy compliance.

Before real patient use, complete patient identity/consent requirements, a full access-control and security review, suitable deployment and encryption, retention/deletion policies, audit access, clinician-reviewed pathways, privacy review, and an operational follow-up process. Staff sign-in, the demo queue, and a Completed status do not establish clinical readiness or privacy compliance.
