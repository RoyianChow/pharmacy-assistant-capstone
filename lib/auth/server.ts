import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { hasAuthConfiguration } from "./config";

let auth: ReturnType<typeof createNeonAuth> | undefined;

export function getAuth() {
  if (!hasAuthConfiguration()) throw new Error("Staff authentication is not configured.");
  // Initialization happens on a request, so builds do not need live credentials.
  auth ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET!.trim(), sessionDataTtl: 60 },
    // Keep provider internals and credentials out of application logs.
    logLevel: "silent",
  });
  return auth;
}
