# Pharmacy Assistant

An eight-week COMP 385 capstone prototype exploring how AI agents can organize minor ailment assessments and verify typed prescriptions for a simulated pharmacist review.

> **Educational prototype only.** No clinical rules or prescription checks are implemented yet. Use fictional records only. This project is not for patient care, autonomous prescribing, dispensing, or pharmacy operations.

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

- Node.js 20.9 or newer
- npm

### Run locally

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The current page is a static project overview; assessment, verification, agent, and database workflows remain to be implemented.

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
