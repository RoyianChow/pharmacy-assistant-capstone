# Pharmacy Assistant

An eight-week COMP 385 capstone prototype exploring how AI agents can organize minor ailment assessments and verify typed prescriptions for a simulated pharmacist review.

> **Educational prototype only.** A conversational intake and conservative screening flow are implemented. They are not a clinically validated assessment. Use fictional records only. This project is not for patient care, autonomous prescribing, dispensing, or pharmacy operations.

## Initial scope

- Adult cases (18+) for allergic rhinitis and cold sores.
- Typed prescriptions and up to six selected Canadian medication products.
- Three agents with separate roles: intake, assessment, and verification.
- A web application using Next.js and TypeScript, with SQLite for local demos and PostgreSQL for hosted demos.
- The initial scope used pretrained models. The optional real/fake prescription research extension now includes a custom training pipeline; no trained authenticity model or labeled authenticity dataset is included.
- One hundred synthetic cases: 60 for development and 40 held for final evaluation.
- A human reviewer makes and records every simulated clinical decision.

The first version is deliberately narrow. It does not use real patient data, pharmacy system connections, or comprehensive interaction checking. The prescription demo now supports images of typed fictional documents; handwriting is not a validated input. Hosted demonstrations must also use fictional data; the staff workspace requires an approved account.

## Getting started

### Requirements

- Node.js 22.13 or newer (the dashboard uses built-in SQLite; Node 22.14 is verified locally)
- npm

### Run locally

```bash
npm ci
npm run dev
```

Open [http://localhost:3000/assessment](http://localhost:3000/assessment) for the patient chat. The home page links to it. On Windows PowerShell, use `npm.cmd ci` and `npm.cmd run dev` if script execution blocks `npm`.

## Patient assessment (October 2026)

The new `/assessment` page collects adult intake through authored conversational questions, offers the current 28-condition Ontario scope catalogue, screens for explicit warning answers, and creates a downloadable visit summary. Selecting a listed condition is not a diagnosis or proof of eligibility. Results describe pharmacist assessment, missing information, other care, or urgent/emergency help. They do not determine prescription need, select drugs, or provide doses.

With no API key, the complete guided flow runs in **Demo** mode. With a key, Jev selects the next question from an allowlist. Jev is a typed decision model, not a text-generating chatbot. It cannot bypass required questions or override the application's safety stops. API failures or uncertain results visibly fall back to the guided order.

To connect the official TypeSafe API, create `.env.local` from `.env.example` if it does not already exist, set `TYPESAFE_API_KEY`, and restart the dev server. Preserve existing keys when adding database settings. The default model is `jev-1.13.0`; change `TYPESAFE_MODEL` if your account uses another supported model. Never put the key in a client component or a `NEXT_PUBLIC_` variable. The adapter calls only `https://api.typesafe.ai/v1/systemone`. A configured key alone does not establish provider connectivity.

Consent is required before beginning. With Jev configured, entered answers are sent to TypeSafe AI for question selection. Unsubmitted chat drafts live in browser memory and clear on reload. After an eligible assessment, a separate **Send to pharmacy** action saves the fictional patient details and assessment to the configured dashboard database. Restarting the chat does not delete submitted cases. Contact details entered in the handoff form are not sent to Jev. Downloading a summary saves a separate file under the user's control. Provider retention and hosting logs are separate concerns; real patient use is not supported.

See [docs/patient-assessment.md](docs/patient-assessment.md) for the API contract, sources, boundaries, and remaining work. Run `npm.cmd test` for the screening and mocked provider checks, and `npm.cmd run build` for the production build.

## Pharmacy dashboard

Open [http://localhost:3000/pharmacy](http://localhost:3000/pharmacy). A submitted assessment appears in the **New** queue, with a reference number, fictional patient details, original answers, and screening next steps. Staff can search/filter cases, add a reviewer name and notes, and move cases through **New → In review → Completed**. The dashboard refreshes its queue automatically and offers manual refresh.

With `DATABASE_URL` configured, the dashboard uses PostgreSQL; `NEON_DB` is accepted as an alternate connection URL, followed by the legacy `POSTGRES_URL` alias. Without any of these URLs, local development uses `data/pharmacy-dashboard.sqlite`; override that location with `PHARMACY_DATABASE_PATH` in `.env.local`. On Vercel (`VERCEL=1`), a missing or invalid database URL produces a 503 configuration error. The application never falls back to temporary storage there. Submitted cases and review history persist in the selected database. Duplicate retries return the existing receipt, and version checks prevent one review from silently overwriting another.

The hosted dashboard requires Neon Auth sign-in and an approved staff identity. Verified emails must be listed in `PHARMACY_STAFF_EMAILS`; explicit user-ID approval is also supported. Creating an account alone grants no staff access. Patients can submit an assessment without registering. Only an unconfigured local development app using SQLite keeps the original demo access; production, Vercel, a remote database URL, or partial Auth settings require authentication and deny access if setup is incomplete. Use fictional data only. Sign-in does not make this educational application suitable for patient care. See [staff sign-in setup](docs/neon-auth.md) and [dashboard behavior](docs/pharmacy-dashboard.md).

### Deploying the demo on Vercel

The workspace is linked to the existing Neon organization/project through the ignored `.neon` file. `neon.ts` declares `auth: true`. Reuse that link rather than creating a replacement database. Use `neon status` and `neon config plan` to inspect the linked branch; `neon deploy` applies its declared services and pulls Neon environment settings. This provisions the backend services, not the Vercel website.

1. Set `DATABASE_URL` in the Vercel project's **Production** environment. `NEON_DB` and `POSTGRES_URL` remain supported aliases. For a Marketplace-managed Neon database, **Storage → your database → Connect Project** can supply `DATABASE_URL` without a custom prefix.
2. Add `NEON_AUTH_BASE_URL`, a stable random `NEON_AUTH_COOKIE_SECRET` of at least 32 characters, and the comma-separated `PHARMACY_STAFF_EMAILS` allowlist. Register the app's HTTPS origin in that Neon branch's Auth trusted domains. Keep the existing `TYPESAFE_API_KEY` configuration.
3. Deploy the updated app, and redeploy after changing hosted environment variables. Local `.env.local` settings are not automatically copied to Vercel; preserve its existing keys when editing it.
4. The first pharmacy API request creates the required tables. The database role must be able to create tables and indexes in its schema, then read and write them.
5. Staff use `/auth/sign-in` to register, verify their email with its code, and sign in. Their exact verified email must also be approved in the allowlist. See [docs/neon-auth.md](docs/neon-auth.md) for setup and access rules.

Existing local SQLite records are not automatically copied to PostgreSQL. A code change or successful build does not confirm the hosted database connection; check a fictional submission after deployment. For setup and troubleshooting, see [the dashboard guide](docs/pharmacy-dashboard.md#vercel-setup).

## Prescription verification with PaddleOCR

The `/prescriptions` staff page extracts text from PNG/JPEG images, identifies labelled fields, and shows confidence, missing information, and an original-image comparison. It includes an Ontario-style fictional prescription as a PNG and PDF, prominently marked **DEMO — NOT VALID FOR DISPENSING**. OCR does not establish authenticity, legal validity, or clinical appropriateness. Images and extracted details are not saved to the dashboard. Its prescription overview links to the page and shows OCR configuration plus successful scan counts, latest field totals, and processing time from the current browser tab.

After the one-time [Python service setup](services/paddleocr/README.md), run these commands in separate terminals:

```powershell
npm.cmd run ocr:serve
npm.cmd run dev:prescriptions
```

Open [http://localhost:3001/prescriptions](http://localhost:3001/prescriptions), choose **Load Ontario demo**, acknowledge fictional data, and select **Extract with PaddleOCR**. Use `localhost` as shown so the browser origin matches Next.js development requests. This launcher uses the existing local demo access mode and a separate local database path; it leaves `.env.local` and hosted settings unchanged. The Python service runs locally on port 8001 and needs no API key. First startup downloads the models.

See [the prescription guide](docs/prescription-verification.md) for the contract, limits, testing, and future hosting setup. The Vercel app needs a separately hosted HTTPS OCR service before hosted extraction can work.

### Binary prescription research model

The prescription page also has a separate **Real / fake classifier** panel. Its server route invokes a private AWS Lambda model using Vercel OIDC, or a local Lambda runtime emulator during development. No model is connected by default, so no prediction is shown. The ResNet18 training pipeline and ONNX runtime are in `services/prescription-classifier`; deployment templates and the connection steps are in [the AWS classifier guide](docs/prescription-classifier-aws.md).

Training requires independently verified labels and permission to use the de-identified images. The existing fictional Ontario sample is an OCR fixture, not a labeled authenticity dataset. A model prediction is experimental evidence for a reviewer, not proof that a prescription is authorized or suitable for dispensing. OCR remains independent, and classifier results are not saved to the dashboard.

## Project map

```text
app/                 Next.js App Router interface
database/schema.sql  Proposed SQLite record structure
data/                Synthetic case dataset guidance
docs/                Architecture and requirements notes
```

See [docs/architecture.md](docs/architecture.md) for the planned workflow and [docs/requirements.md](docs/requirements.md) for the initial requirements and evaluation targets.

## Data and credentials

- Only synthetic cases belong in this repository or any deployed demo.
- Do not commit `.env.local`, API keys, generated SQLite databases, or real patient information.
- Keep model credentials on the server; never prefix secrets with `NEXT_PUBLIC_`.
- Source links, reference versions, model name, prompt version, and reviewer decisions should be traceable in saved demo records.

## Development plan

1. Confirm scope, sources, products, and requirements.
2. Build forms, database structure, and labelled synthetic cases.
3. Add intake extraction and missing-information handling.
4. Add the two assessment pathways and four result types.
5. Add supported prescription checks with linked sources.
6. Connect the workflows, review screen, and case history.
7. Freeze the version and evaluate on the reserved cases.
8. Fix priority defects and prepare the report and demonstration.

These are planned milestones, not completed features or validated clinical results.
