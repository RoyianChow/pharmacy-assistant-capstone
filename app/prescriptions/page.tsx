import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/lib/auth/staff";
import StaffSessionControl from "../auth/staff-session-control";
import PrescriptionClient from "./prescription-client";
import "./prescription.css";

export const metadata: Metadata = {
  title: "Prescription verification | Pharmacy Assistant",
  description: "Extract text from fictional prescription images with PaddleOCR and prepare it for pharmacist review.",
  robots: { index: false, follow: false },
};

export default function PrescriptionPage() {
  return <Suspense fallback={<main className="rx-page"><p role="status">Opening prescription verification…</p></main>}><ProtectedPrescriptionWorkspace /></Suspense>;
}

async function ProtectedPrescriptionWorkspace() {
  const access = await requireStaffPage();
  return <>{access.status === "authorized" && <StaffSessionControl email={access.user.email} />}<PrescriptionClient /></>;
}
