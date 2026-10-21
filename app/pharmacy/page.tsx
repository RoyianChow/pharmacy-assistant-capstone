import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaffPage } from "@/lib/auth/staff";
import StaffSessionControl from "../auth/staff-session-control";
import PharmacyClient from "./pharmacy-client";
import "./pharmacy.css";

export const metadata: Metadata = {
  title: "Pharmacy workspace | Pharmacy Assistant",
  description: "Review fictional minor ailment assessment submissions in the pharmacy demo workspace.",
  robots: { index: false, follow: false },
};

export default function PharmacyPage() {
  return <Suspense fallback={<main className="ph-page"><p role="status">Opening the pharmacy workspace…</p></main>}><ProtectedWorkspace /></Suspense>;
}

async function ProtectedWorkspace() {
  const access = await requireStaffPage();
  return <>{access.status === "authorized" && <StaffSessionControl email={access.user.email} />}<PharmacyClient /></>;
}
