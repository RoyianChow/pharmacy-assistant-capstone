import type { Metadata } from "next";
import PharmacyClient from "./pharmacy-client";
import "./pharmacy.css";

export const metadata: Metadata = {
  title: "Pharmacy workspace | Pharmacy Assistant",
  description: "Review fictional minor ailment assessment submissions in the local pharmacy workspace.",
  robots: { index: false, follow: false },
};

export default function PharmacyPage() {
  return <PharmacyClient />;
}
