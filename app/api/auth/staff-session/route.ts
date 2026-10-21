import { connection } from "next/server";
import { getStaffAccess } from "@/lib/auth/staff";

export async function GET() {
  await connection();
  const access = await getStaffAccess();
  const status = access.status === "unauthenticated" ? 401 : access.status === "forbidden" ? 403 : access.status === "unavailable" ? 503 : 200;
  return Response.json(access, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
