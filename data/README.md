# Synthetic case data

This project plans to create 100 fictional cases: 50 adult minor ailment assessments and 50 typed prescriptions. No case dataset is included yet.

## Split

- 30 assessments and 30 prescriptions for development.
- 20 assessments and 20 prescriptions reserved for final evaluation.
- Keep related case templates in the same split to reduce leakage.

Each case should have a stable ID, case type, split, structured fictional inputs, expected outcome or labelled issues, source IDs, and the date/reference version used for its labels. Expected missing fields must remain missing rather than being filled in for convenience.

Do not add real patient information, copied medical records, names, contact details, or identifiable combinations of facts. Synthetic data is for software evaluation and is not evidence of clinical accuracy.
