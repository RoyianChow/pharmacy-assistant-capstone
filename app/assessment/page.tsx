import type { Metadata } from "next";
import AssessmentClient from "./assessment-client";
import "./assessment.css";

export const metadata: Metadata = {
  title: "Minor ailment assessment | Pharmacy Assistant",
  description:
    "Explore an Ontario minor ailment assessment with a guided conversation. An educational demonstration using fictional details.",
  robots: { index: false, follow: false },
};

export default function AssessmentPage() {
  return <AssessmentClient />;
}
