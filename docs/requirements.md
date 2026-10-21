# Initial requirements and evaluation targets

> October 21, 2026 update: `/assessment` implements patient conversational intake and scope navigation across Ontario's current minor ailment catalogue. This extends the original two-ailment intake scope, but does not implement condition-specific treatment eligibility or validate clinical accuracy. See [patient-assessment.md](patient-assessment.md).

These are planned requirements. None of the targets below have been measured yet. Clinical labels and rules require suitable source review; without pharmacist feedback, results describe software behavior against student-created labels, not clinical accuracy.

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR01 | Provide an English assessment form for adult allergic rhinitis and cold sore cases, including relevant history, current medicines, and allergies. |
| FR02 | Organize typed assessment or prescription text into editable fields while showing the original input. Display the six core prescription fields: medicine, strength, dose, route, frequency, and quantity. |
| FR03 | Ask for clarification when clinical information is missing or unclear. Preserve unknown values as unknown. |
| FR04 | Return one of four assessment outcomes: possible options for review, more information needed, referral recommended, or outside prototype scope. Explain the result. |
| FR05 | Limit new pharmacist-prescribing options to saved Ontario ailment-and-drug rules. Do not treat an existing prescription outside the prototype as unlawful. |
| FR06 | Apply selected warning and exclusion rules before displaying possible treatment options. A blocking warning prevents options. |
| FR07 | Check supported prescriptions for missing fields, recorded ingredient allergies, duplicate ingredients, and selected source-based dose or interaction warnings. |
| FR08 | Show findings, unchecked areas, and supporting reference links. No detected issue must not be presented as a guarantee of safety. |
| FR09 | Require an explicit simulated reviewer decision with reasons and follow-up notes. Agents cannot complete the review. |
| FR10 | Retain inputs, edits, agent outputs, model and prompt versions, reference versions, and reviewer decisions. Mark affected results stale after an input edit. |

## Evaluation targets

| ID | Target | Planned measurement |
| --- | --- | --- |
| NFR01 | At least 18 of 20 final assessment cases have the expected status. | Compare outputs with expected labels; report counts for all four statuses. |
| NFR02 | At least 95% correct extraction across six core prescription fields. | Score 120 fields from 20 final prescriptions; expected missing values must remain missing. |
| NFR03 | Detect at least 90% of labelled in-scope prescription issues, with at least 80% of raised alerts correct. | Count detected issues, missed issues, and false alerts. Exclude unsupported checks from completed checks. |
| NFR04 | Every designated warning blocks options; every suggested option and clinical finding has a valid supporting reference. | Check all warning cases, options, and cited findings. An invented option or missed critical warning fails the target. |
| NFR05 | Use synthetic records only and keep model credentials server-side. | Inspect case files and browser requests; exclude keys from source control and provide case deletion. |
| NFR06 | At least 18 of 20 timed runs finish within 20 seconds for one user. | Time the selected route end to end and record model and network conditions. |
| NFR07 | Failures and invalid outputs leave the case recoverable and visibly incomplete. | Exercise a timeout, malformed result, missing source, and prompt-injection-style input. |
| NFR08 | At least two of three volunteer testers finish intake and find a report source without help. | Observe the same tasks, record completion, and report student feedback as usability feedback. |
| NFR09 | Each result can be traced to its inputs, prompt, model, and reference versions. | Save version details per run; rerun affected checks after edits while retaining original results. |

## Planned dataset split

| Case type | Development | Final evaluation | Total |
| --- | ---: | ---: | ---: |
| Minor ailment assessments | 30 | 20 | 50 |
| Typed prescriptions | 30 | 20 | 50 |
| **Total** | **60** | **40** | **100** |

Keep related case templates in the same split. The planned final assessment mix is 6 possible-option, 5 referral, 5 incomplete, and 4 outside-scope cases. The planned final prescription mix is 12 with supported issues, 4 with no added issue, and 4 outside the supported product list.
