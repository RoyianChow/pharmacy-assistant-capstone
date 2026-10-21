"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";
import StaffSessionControl from "../staff-session-control";

type Mode = "signin" | "signup" | "verify" | "forgot" | "reset";

const modeCopy: Record<Mode, { title: string; description: string; action: string }> = {
  signin: { title: "Welcome back", description: "Use the email and password you chose when creating your staff account.", action: "Sign in to workspace" },
  signup: { title: "Create your account", description: "First visit? Create your staff account and choose your own password. There is no default password.", action: "Create account" },
  verify: { title: "Verify your email", description: "Already created your account? Request a code for that same email below, then enter the newest code. You do not need to create another account.", action: "Verify email" },
  forgot: { title: "Reset your password", description: "Enter your account email to request a password reset code.", action: "Send password reset code" },
  reset: { title: "Choose a new password", description: "Enter the password reset code from your email and choose your new password.", action: "Save new password" },
};

function reasonMessage(reason: string) {
  if (reason === "approval") return "Your account needs pharmacy staff approval. Ask the project owner to approve it.";
  if (reason === "verification") return "Your account needs email verification before you can open the workspace.";
  if (reason === "unavailable") return "The sign-in service is unavailable. Please try again.";
  return "";
}

function authError(error: { code?: string; status?: number; message?: string }) {
  if (error.code === "EMAIL_NOT_VERIFIED") return "Verify your email address to continue. You can request a code below.";
  if (["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND"].includes(error.code ?? "")) return "The email or password was not accepted. Check your details and try again.";
  if (error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return "An account already uses this email. Choose Sign in, or Verify email if you still need a verification code.";
  if (["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(error.code ?? "")) return "That code could not be verified. Check it or request a new code.";
  if (error.status === 429) return "There have been too many attempts. Please wait a moment and try again.";
  if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") return "Choose a password between 8 and 128 characters.";
  return "We couldn’t complete that request. Please try again or contact the project owner.";
}

export default function SignInForm({ ready, localDemo, reason }: { ready: boolean; localDemo: boolean; reason: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(reason === "verification" ? "verify" : "signin");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(reasonMessage(reason));
  const [notice, setNotice] = useState("");
  const { data: session } = authClient.useSession();
  const accountEmail = email ?? session?.user.email ?? "";
  const copy = modeCopy[mode];

  function changeMode(next: Mode) {
    setMode(next); setError(""); setNotice(""); setPassword(""); setOtp("");
  }

  async function openWorkspace() {
    const response = await fetch("/api/auth/staff-session", { cache: "no-store" });
    const access = await response.json();
    if (response.ok && (access.status === "authorized" || access.status === "demo")) {
      router.push("/pharmacy");
      router.refresh();
      return;
    }
    if (access.reason === "verification") setMode("verify");
    setError(typeof access.message === "string" ? access.message : "We couldn’t check your staff access. Please try again.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !ready) return;
    setPending(true); setError(""); setNotice("");
    try {
      const cleanEmail = accountEmail.trim();
      if (mode === "signup") {
        const result = await authClient.signUp.email({ email: cleanEmail, password, name: name.trim() });
        if (result.error) { setError(authError(result.error)); return; }
        setPassword(""); setMode("verify");
        setNotice("Account created. Check your inbox and spam folder for a verification code. If it has not arrived, use Send / resend verification code below. Keep the password you just chose for signing in.");
      } else if (mode === "verify") {
        const result = await authClient.emailOtp.verifyEmail({ email: cleanEmail, otp: otp.trim() });
        if (result.error) { setError(authError(result.error)); return; }
        // Refresh the signed session after email ownership changes.
        await authClient.signOut();
        setOtp(""); setMode("signin");
        setNotice("Email verified. Sign in with the password you chose when creating your account.");
      } else if (mode === "forgot") {
        const result = await authClient.forgetPassword.emailOtp({ email: cleanEmail });
        if (result.error) { setError(authError(result.error)); return; }
        setPassword(""); setOtp(""); setMode("reset");
        setNotice("If an account uses this email, a password reset code has been requested. Check your inbox and spam folder.");
      } else if (mode === "reset") {
        const result = await authClient.emailOtp.resetPassword({ email: cleanEmail, otp: otp.trim(), password });
        if (result.error) { setError(authError(result.error)); return; }
        await authClient.signOut();
        setPassword(""); setOtp(""); setMode("signin");
        setNotice("Password updated. Sign in with your new password.");
      } else {
        const result = await authClient.signIn.email({ email: cleanEmail, password });
        if (result.error) {
          setError(authError(result.error));
          if (result.error.code === "EMAIL_NOT_VERIFIED") { setMode("verify"); setPassword(""); }
          return;
        }
        setPassword("");
        await openWorkspace();
      }
    } catch { setError("The sign-in service could not be reached. Check your connection and try again."); }
    finally { setPending(false); }
  }

  async function sendCode() {
    if (pending || !ready) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail.trim())) { setError("Enter your account email first."); return; }
    setPending(true); setError(""); setNotice("");
    try {
      const result = mode === "reset"
        ? await authClient.forgetPassword.emailOtp({ email: accountEmail.trim() })
        : await authClient.emailOtp.sendVerificationOtp({ email: accountEmail.trim(), type: "email-verification" });
      if (result.error) setError(authError(result.error));
      else {
        setOtp("");
        setNotice(mode === "reset"
          ? "If an account uses this email, a new password reset code has been requested. Use the newest code from your inbox or spam folder."
          : "Verification email requested. Check your inbox and spam folder, then enter the newest code. If it does not arrive, contact the project owner so they can check email delivery.");
      }
    } catch { setError("The verification code could not be requested. Please try again."); }
    finally { setPending(false); }
  }

  return (
    <section className="staff-auth-card" aria-labelledby="staff-auth-title">
      <p className="staff-auth-eyebrow">STAFF ACCESS</p>
      <h2 id="staff-auth-title">{copy.title}</h2>
      <p className="staff-auth-description">{copy.description}</p>
      {!ready ? (
        <div className="staff-auth-notice" role="status">
          {localDemo ? <><p>This local demo uses fictional cases without staff accounts.</p><Link href="/pharmacy" className="staff-auth-primary">Open local workspace</Link></> : <p>Staff sign-in is not available yet. The project owner needs to finish the account setup.</p>}
        </div>
      ) : <>
        {session?.user && <div className="staff-auth-session"><StaffSessionControl email={session.user.email} />{session.user.emailVerified ? <Link href="/pharmacy">Open workspace →</Link> : <p>Your account exists. Verify your email below to continue.</p>}</div>}
        <div className="staff-auth-tabs" aria-label="Account action">
          <button type="button" aria-pressed={mode === "signin"} onClick={() => changeMode("signin")} disabled={pending}>Sign in</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => changeMode("signup")} disabled={pending}>Create account</button>
          <button type="button" aria-pressed={mode === "verify"} onClick={() => changeMode("verify")} disabled={pending}>Verify email</button>
        </div>
        <form onSubmit={submit} aria-busy={pending}>
          {mode === "signup" && <label htmlFor="staff-name">Your name<input id="staff-name" autoComplete="name" maxLength={80} required value={name} disabled={pending} onChange={(event) => setName(event.target.value)} /></label>}
          <label htmlFor="staff-email">Email address<input id="staff-email" type="email" autoComplete="email" maxLength={254} required value={accountEmail} disabled={pending} onChange={(event) => { setEmail(event.target.value); setOtp(""); }} placeholder="you@pharmacy.example" /></label>
          {mode === "verify" && <button className="staff-auth-secondary" type="button" disabled={pending} onClick={sendCode}>Send / resend verification code</button>}
          {(mode === "verify" || mode === "reset") && <label htmlFor="staff-code">{mode === "reset" ? "Password reset code" : "Verification code"}<input id="staff-code" autoComplete="one-time-code" inputMode="numeric" required maxLength={12} value={otp} disabled={pending} onChange={(event) => setOtp(event.target.value)} /></label>}
          {(mode === "signin" || mode === "signup" || mode === "reset") && <label htmlFor="staff-password">{mode === "reset" ? "New password" : "Password"}<input id="staff-password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signin" ? undefined : 8} maxLength={128} required value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} /><span className="staff-auth-hint">{mode === "signin" ? "Use your account password. The app does not assign a default password." : "Choose your own password with at least 8 characters."}</span></label>}
          {error && <p className="staff-auth-error" role="alert">{error}</p>}
          {notice && <p className="staff-auth-notice" role="status">{notice}</p>}
          <button className="staff-auth-primary" type="submit" disabled={pending}>{pending ? "Please wait…" : copy.action}<span aria-hidden="true">→</span></button>
          {mode === "signin" && <button className="staff-auth-secondary" type="button" disabled={pending} onClick={() => changeMode("forgot")}>Forgot your password?</button>}
          {mode === "reset" && <button className="staff-auth-secondary" type="button" disabled={pending} onClick={sendCode}>Send another password reset code</button>}
        </form>
        <p className="staff-auth-footnote">An account alone does not grant access to assessment details. Only approved staff can open the workspace.</p>
      </>}
    </section>
  );
}
