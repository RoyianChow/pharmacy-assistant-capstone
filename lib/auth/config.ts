type Environment = Record<string, string | undefined>;

export function isLocalAuthDemo(env: Environment = process.env) {
  // A remote database must never inherit the original, unauthenticated local demo.
  return env.NODE_ENV !== "production" && !env.VERCEL &&
    !env.NEON_DB && !env.DATABASE_URL && !env.POSTGRES_URL && !env.NEON_AUTH_BASE_URL && !env.NEON_AUTH_COOKIE_SECRET;
}

export function hasAuthConfiguration(env: Environment = process.env) {
  const secret = env.NEON_AUTH_COOKIE_SECRET?.trim();
  try {
    const url = new URL(env.NEON_AUTH_BASE_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !!secret && secret.length >= 32;
  } catch { return false; }
}

export type StaffIdentity = { id: string; email: string; name: string; emailVerified: boolean };

export function isAuthorizedStaff(user: StaffIdentity, env: Environment = process.env) {
  const ids = (env.PHARMACY_STAFF_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const emails = (env.PHARMACY_STAFF_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  // An explicit immutable ID is trusted. Email grants additionally require ownership verification.
  return ids.includes(user.id) || (user.emailVerified === true && emails.includes(user.email.trim().toLowerCase()));
}
