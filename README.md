# Pharmacy Assistant

An eight-week COMP 385 capstone prototype exploring how AI agents can organize minor ailment assessments and verify typed prescriptions for a simulated pharmacist review.

> **Educational prototype only.** A conversational intake and conservative screening flow are implemented. They are not a clinically validated assessment. Use fictional records only. This project is not for patient care, autonomous prescribing, dispensing, or pharmacy operations.

## Initial scope

- Adult cases (18+) for allergic rhinitis and cold sores.
- Typed prescriptions and up to six selected Canadian medication products.
- Three agents with separate roles: intake, assessment, and verification.
- A local web application using Next.js, TypeScript, and SQLite.
- One pretrained model; no model training or fine-tuning.
- One hundred synthetic cases: 60 for development and 40 held for final evaluation.
- A human reviewer makes and records every simulated clinical decision.

The first version is deliberately narrow. It will not use real patient data, scanned or handwritten prescriptions, pharmacy system connections, public hosting, or comprehensive interaction checking.

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

To connect the official TypeSafe API, copy `.env.example` to `.env.local`, set `TYPESAFE_API_KEY`, and restart the dev server. The default model is `jev-1.13.0`; change `TYPESAFE_MODEL` if your account uses another supported model. Never put the key in a client component or a `NEXT_PUBLIC_` variable. The adapter calls only `https://api.typesafe.ai/v1/systemone`. A real account call remains unverified until a key is configured.

Consent is required before beginning. With Jev configured, entered answers are sent to TypeSafe AI for question selection. Unsubmitted chat drafts live in browser memory and clear on reload. After an eligible assessment, a separate **Send to pharmacy** action saves the fictional patient details and assessment to the local SQLite dashboard. Restarting the chat does not delete submitted cases. Contact details entered in the handoff form are not sent to Jev. Downloading a summary saves a separate file under the user's control. Provider retention and hosting logs are separate concerns; real patient use is not supported.

See [docs/patient-assessment.md](docs/patient-assessment.md) for the API contract, sources, boundaries, and remaining work. Run `npm.cmd test` for the screening and mocked provider checks, and `npm.cmd run build` for the production build.

## Pharmacy dashboard

Open [http://localhost:3000/pharmacy](http://localhost:3000/pharmacy). A submitted assessment appears in the **New** queue, with a reference number, fictional patient details, original answers, and screening next steps. Staff can search/filter cases, add a reviewer name and notes, and move cases through **New → In review → Completed**. The dashboard refreshes its queue automatically and offers manual refresh.

The local database is created on first use at `data/pharmacy-dashboard.sqlite`; override its location with `PHARMACY_DATABASE_PATH` in `.env.local`. Submitted cases and review history survive reloads and server restarts. Duplicate retries return the existing receipt, and version checks prevent one review from silently overwriting another.

This dashboard has no staff login or production access controls. Use fictional data on your local machine only. It does not book appointments, send emails/texts, issue prescriptions, or communicate with an external pharmacy system. See [docs/pharmacy-dashboard.md](docs/pharmacy-dashboard.md).

## Project map

```text
app/                 Next.js App Router interface
database/schema.sql  Proposed SQLite record structure
data/                Synthetic case dataset guidance
docs/                Architecture and requirements notes
```

See [docs/architecture.md](docs/architecture.md) for the planned workflow and [docs/requirements.md](docs/requirements.md) for the initial requirements and evaluation targets.

## Data and credentials

- Only synthetic cases belong in this repository or the local demo.
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
