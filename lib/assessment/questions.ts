import type { Question } from "./types";

export const SCOPE_REVIEWED = "2026-10-21";
export const SOURCES = [
  { title: "Ontario College of Pharmacists · minor ailments", url: "https://ocpinfo.com/pharmacy-professionals/expanded-scope-of-practice/minor-ailments/" },
  { title: "Ontario · pharmacy services", url: "https://www.ontario.ca/page/pharmacies" },
];
export const EMERGENCY_SOURCE = { title: "Ontario · emergency care", url: "https://www.ontario.ca/page/emergency-rooms" };

// Scope catalogue, not diagnostic criteria or an authorization to prescribe.
export const AILMENTS = [
  ["acne", "Mild acne"], ["allergies", "Seasonal allergies / allergic rhinitis"],
  ["canker_sores", "Canker sores"], ["corns", "Calluses and corns"],
  ["thrush", "Oral thrush"], ["pink_eye", "Pink eye / conjunctivitis"],
  ["dermatitis", "Eczema / contact or allergic dermatitis"], ["diaper_rash", "Diaper dermatitis"],
  ["dry_eye", "Dry eye"], ["cramps", "Menstrual cramps"],
  ["reflux", "Acid reflux"], ["hemorrhoids", "Hemorrhoids"],
  ["cold_sores", "Cold sores"], ["impetigo", "Impetigo"],
  ["bites", "Insect bites / hives"], ["headache", "Mild tension headache"],
  ["sprain", "Sprains and strains"], ["pregnancy_nausea", "Pregnancy-related nausea / vomiting"],
  ["lice", "Head lice"], ["pinworms", "Pinworms / threadworms"],
  ["dandruff", "Dandruff"], ["tick", "Tick bite / Lyme disease prevention"],
  ["ringworm", "Ringworm"], ["jock_itch", "Jock itch"],
  ["uti", "Possible uncomplicated urinary tract infection"],
  ["warts", "Common / plantar warts (not face or genitals)"],
  ["congestion", "Nasal congestion from a cold"], ["yeast", "Vaginal yeast infection"],
].map(([value, label]) => ({ value, label }));

const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "I'm not sure" }];
export const QUESTIONS: Question[] = [
  { id: "emergency", section: "Getting started", kind: "choice", text: "First, are you having severe chest pain, difficulty breathing, loss of consciousness, or new confusion?", hint: "If yes, call 911 now. Do not wait for this chat.", options: yesNo },
  { id: "age", section: "Getting started", kind: "choice", text: "What is your age group?", hint: "This first version is for adults. This is a prototype limit, not an Ontario prescribing age rule.", options: [{ value: "under18", label: "Under 18" }, { value: "18to64", label: "18–64" }, { value: "65plus", label: "65 or older" }] },
  { id: "ontario", section: "Getting started", kind: "choice", text: "Are you currently in Ontario?", hint: "We use Ontario's pharmacist prescribing scope.", options: yesNo },
  { id: "concern", section: "Your symptoms", kind: "choice", text: "What would you like help with today?", hint: "Choose the closest concern. Selecting one does not confirm a diagnosis.", options: [...AILMENTS, { value: "other", label: "Something else / I'm not sure" }] },
  { id: "symptoms", section: "Your symptoms", kind: "text", text: "Tell me what you have been experiencing, and where. What is bothering you most?", hint: "Use fictional details only. Please don't include a name, health card number, or contact details." },
  { id: "duration", section: "Your symptoms", kind: "text", text: "When did this start? Is it improving, staying the same, or getting worse?", hint: "For example: “Three days ago, and it is staying the same.”" },
  { id: "severity", section: "Your symptoms", kind: "choice", text: "How much are the symptoms affecting you?", options: [{ value: "mild", label: "Mild · daily activities are manageable" }, { value: "moderate", label: "Moderate · affecting daily activities" }, { value: "severe", label: "Severe or rapidly worsening" }, { value: "unsure", label: "I'm not sure" }] },
  { id: "warnings", section: "Your symptoms", kind: "choice", text: "Do you have any other concerning symptoms, such as fever with feeling very unwell, severe pain, vision changes, blood in vomit or stool, or trouble keeping fluids down?", hint: "This short list cannot rule out every serious condition. If you feel seriously unwell, seek care now.", options: yesNo },
  { id: "pregnancy", section: "Health history", kind: "choice", text: "Are you pregnant, possibly pregnant, or breastfeeding?", hint: "This can affect which treatments a pharmacist may recommend.", options: [{ value: "pregnant", label: "Pregnant / possibly pregnant" }, { value: "breastfeeding", label: "Breastfeeding" }, { value: "no", label: "No / not applicable" }, { value: "unsure", label: "Unsure / prefer to discuss with pharmacist" }] },
  { id: "medicines", section: "Health history", kind: "text", text: "What medicines, vitamins, supplements, or non-prescription products are you taking?", hint: "Include names if known, or write “none” or “not sure”. No interaction check is performed here." },
  { id: "allergies", section: "Health history", kind: "text", text: "Do you have any medication allergies or previous reactions? What happened?", hint: "Write “none known” or “not sure” if that fits." },
  { id: "conditions", section: "Health history", kind: "text", text: "Are there any ongoing health conditions or relevant past episodes the pharmacist should know about?", hint: "For example: immune system problems, kidney conditions, or the same symptoms happening again. You can say “none” or “not sure”." },
  { id: "tried", section: "Health history", kind: "text", text: "Have you tried anything for this concern? Tell me what you tried and whether it helped.", hint: "Write “nothing yet” if you haven't tried anything." },
];

const DETAILS: Record<string, string> = {
  allergies: "Have you noticed a pattern or trigger, such as pollen, pets, or dust? Have you had these symptoms before?",
  cold_sores: "Where is the sore, when did the tingling or blister begin, and have you had a similar sore before? Mention any eye symptoms.",
  uti: "Describe any burning, frequency, or urgency when passing urine. Have you noticed fever, back or side pain, or previous episodes?",
  tick: "When was the tick removed or noticed, where were you when bitten, and do you know how long it was attached? Say if you don't know.",
  pink_eye: "Is one eye or both affected? Describe discharge, contact lens use, pain, or changes in vision.",
  dry_eye: "Is one eye or both affected? Describe contact lens use, eye pain, or changes in vision.",
  headache: "Is this a familiar mild headache or a new pattern? Describe how it started and any other symptoms.",
  warts: "Where are the spots, and have they been identified as warts before? This scope excludes the face and genitals.",
  pregnancy_nausea: "How far along is the pregnancy, and can you keep fluids down? Describe how often vomiting occurs.",
};

export function detailQuestion(concern?: string): Question {
  return { id: "details", section: "Your symptoms", kind: "text", text: DETAILS[concern ?? ""] ?? "Have you had this concern before, or has a clinician identified it? Tell me anything else that might help a pharmacist understand it.", hint: "It is okay to be unsure. This information will be included in your visit summary." };
}

export function safetyQuestion(id: string): Question {
  return { id, section: "Your symptoms", kind: "choice", text: "You mentioned something that may need urgent attention. Are you having severe chest pain, difficulty breathing, loss of consciousness, or new confusion right now?", hint: "If yes, call 911. If you are unsure, get immediate medical help.", options: yesNo };
}
