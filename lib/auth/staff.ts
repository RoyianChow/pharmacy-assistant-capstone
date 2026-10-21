import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuth } from "./server";
import { hasAuthConfiguration, isAuthorizedStaff, isLocalAuthDemo } from "./config";

type StaffUser = { id: string; email: string; name: string };
export type StaffAccess =
  | { status: "authorized"; user: StaffUser }
  | { status: "demo" }
  | { status: "unauthenticated" | "forbidden" | "unavailable"; message: string; reason: string };

export async function getStaffAccess(): Promise<StaffAccess> {
  await connection();
  if (isLocalAuthDemo()) return { status: "demo" };
  if (!hasAuthConfiguration()) return { status: "unavailable", reason: "setup", message: "Staff sign-in is not available yet. Please contact the project owner." };
  try {
    const { data: session, error } = await getAuth().getSession();
    if (error) return { status: "unavailable", reason: "unavailable", message: "The sign-in service is unavailable. Please try again." };
    if (!session?.user) return { status: "unauthenticated", reason: "signin", message: "Sign in with an approved pharmacy staff account." };
    const user = session.user;
    if (!isAuthorizedStaff(user)) {
      return {
        status: "forbidden", reason: user.emailVerified ? "approval" : "verification",
        message: user.emailVerified ? "This account does not have pharmacy staff access. Ask the project owner to approve it." : "Verify your email address before opening the pharmacy workspace.",
      };
    }
    return { status: "authorized", user: { id: user.id, email: user.email, name: user.name } };
  } catch {
    console.error("[pharmacy-auth] session_check_failed");
    return { status: "unavailable", reason: "unavailable", message: "The sign-in service is unavailable. Please try again." };
  }
}

export async function requireStaffApi(): Promise<Response | null> {
  const access = await getStaffAccess();
  if (access.status === "authorized" || access.status === "demo") return null;
  return Response.json({ error: access.message, reason: access.reason }, {
    status: access.status === "unauthenticated" ? 401 : access.status === "forbidden" ? 403 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function requireStaffPage() {
  const access = await getStaffAccess();
  if (access.status !== "authorized" && access.status !== "demo") redirect(`/auth/sign-in?reason=${access.reason}`);
  return access;
}
