# Pharmacy staff sign-in

The app uses Managed Better Auth on the linked Neon branch through `@neondatabase/auth`. The browser calls the same-origin `/api/auth` proxy; the branch URL and cookie secret stay on the server.

## Configuration

Set these on the app host, as well as in the ignored local environment file:

| Variable | Purpose |
| --- | --- |
| `NEON_AUTH_BASE_URL` | Branch Auth URL supplied by `neon deploy`. |
| `NEON_AUTH_COOKIE_SECRET` | A cryptographically random secret of at least 32 characters. Keep it stable across app instances. |
| `PHARMACY_STAFF_EMAILS` | Comma-separated list of approved staff email addresses. Email ownership must be verified. |
| `PHARMACY_STAFF_USER_IDS` | Optional comma-separated list of explicitly approved Neon Auth user IDs. Use immutable IDs when appropriate. |

Register the app's HTTPS origin with the same branch's Auth trusted domains. Localhost must be allowed for local sign-in; use `http://localhost:3000`. The loopback IP `http://127.0.0.1:3000` is a different origin and needs its own trusted-domain entry. Do not copy environment values into source code, screenshots, logs, or issue reports.

## Staff onboarding

1. Open `/auth/sign-in` and choose **Create account**.
2. Enter the staff member's own name, email, and password.
3. Choose **Verify email** and enter the emailed verification code. **Send a verification code** can request another code.
4. The project owner adds the verified email to `PHARMACY_STAFF_EMAILS` on the app host and redeploys or restarts the app to apply it.
5. Sign in and open the pharmacy workspace. Use **Sign out** to end the browser session.

Account registration alone grants no pharmacy access. An empty allowlist denies every ordinary account. Never approve patient accounts merely because they registered. No staff accounts or passwords are seeded by the application.

## Enforcement

- `/pharmacy` uses the SDK proxy for session handling and a server-side staff check before rendering the workspace.
- Collection/detail reads and case review updates independently check the session and staff allowlist in their route handlers.
- Submitting a completed assessment remains public and does not create an account.
- An unconfigured development app using only local SQLite may use the original demo. Production, Vercel, any remote database URL, or any partial Auth configuration disables that exception.
- Auth configuration is initialized lazily on requests. Builds do not require live Auth credentials.
- Responses carrying session or case information are not cached by the HTTP cache. The SDK uses a signed session cookie with a 60-second cache lifetime; it is not a promise of immediate revocation on other devices.

This remains an educational application for fictional patient data. Staff sign-in does not by itself make the rest of the application suitable for clinical use.

## Checks

`node --test tests/auth.test.mjs` checks local-demo restrictions, hosted failure behavior, verified-email/ID allowlists, unauthenticated requests, unauthorized accounts, and provider errors. A live verification also needs account creation, email verification where required, sign-in, a protected read/write, reload/session restoration, and sign-out. Unit checks do not replace those live flows.

Implementation follows the [Neon Next.js API quickstart](https://neon.com/docs/auth/quick-start/nextjs-api-only) and the installed Next.js guide for authentication with Cache Components. The latter uses a Suspense boundary around request-time session reads instead of the older `dynamic = 'force-dynamic'` route setting.
