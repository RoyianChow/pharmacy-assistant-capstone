"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import "./staff-auth.css";

export default function StaffSessionControl({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError("Sign-out failed. Please try again."); return; }
      // Full navigation discards the previous dashboard's in-memory case details.
      window.location.replace("/auth/sign-in");
    } catch { setError("Sign-out failed. Check your connection and try again."); }
    finally { setPending(false); }
  }
  return <div className="staff-session-control"><span>Signed in as <strong>{email}</strong></span><button type="button" disabled={pending} onClick={signOut}>{pending ? "Signing out…" : "Sign out"}</button>{error && <span role="alert">{error}</span>}</div>;
}
