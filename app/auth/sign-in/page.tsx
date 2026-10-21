import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { hasAuthConfiguration, isLocalAuthDemo } from "@/lib/auth/config";
import SignInForm from "./sign-in-form";
import "../staff-auth.css";

export const metadata: Metadata = { title: "Staff sign-in | Pharmacy Assistant", robots: { index: false, follow: false } };

async function SignInContent({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  await connection();
  const { reason } = await searchParams;
  return <SignInForm ready={hasAuthConfiguration()} localDemo={isLocalAuthDemo()} reason={reason ?? ""} />;
}

export default function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  return (
    <main className="staff-auth">
      <header className="staff-auth-header">
        <Link href="/" className="staff-auth-brand"><span aria-hidden="true">+</span> Pharmacy Assistant</Link>
        <Link href="/assessment">Patient assessment <span aria-hidden="true">↗</span></Link>
      </header>
      <div className="staff-auth-layout">
        <section className="staff-auth-intro">
          <p className="staff-auth-eyebrow">PHARMACY WORKSPACE</p>
          <h1>A clear view of<br /><em>what comes next.</em></h1>
          <p>Review assessment details, record your notes, and follow each case through the pharmacy workflow.</p>
          <div className="staff-auth-info"><span aria-hidden="true">✳</span><p>Access is reserved for approved pharmacy staff. Patients can complete an assessment without creating an account.</p></div>
          <p className="staff-auth-demo">Educational capstone · Use fictional patient information.</p>
        </section>
        <Suspense fallback={<section className="staff-auth-card" aria-busy="true"><p>Preparing staff sign-in…</p></section>}>
          <SignInContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
