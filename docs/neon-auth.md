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

1. On a first visit, open `/auth/sign-in` and choose **Create account**. An existing account should use **Sign in** with the password its owner chose.
2. Enter the staff member's own name, email, and password. The app does not assign a default password.
3. Choose **Verify email** and enter the emailed verification code. **Send / resend verification code** requests another code for an existing account; recreating the account is unnecessary. Check the inbox and spam folder and use the newest code.
4. The project owner adds the verified email to `PHARMACY_STAFF_EMAILS` on the app host and redeploys or restarts the app to apply it.
5. Sign in and open the pharmacy workspace. Use **Sign out** to end the browser session.

Account registration alone grants no pharmacy access. An empty allowlist denies every ordinary account. Never approve patient accounts merely because they registered. No staff accounts or passwords are seeded by the application.

If the account password is forgotten, choose **Forgot your password?** on the sign-in form. Request a password reset code, enter that code and a new password, then sign in. This uses the managed Email OTP flow (`forgetPassword.emailOtp` and `emailOtp.resetPassword`); the application never reads existing passwords.

## Verification email delivery

The Neon branch must use verification codes and enable verification at sign-up. The app's staff allowlist separately requires verified ownership even if the branch allows unverified sign-in. Merely adding a mail provider API key to `.env.local` does not change Neon's managed email delivery or the deployed Vercel environment. Configure the branch email provider through Neon for a custom sender.

The UI requests verification codes through `emailOtp.sendVerificationOtp` and password reset codes through `forgetPassword.emailOtp`. A successful request confirms that the Auth service accepted it; inbox delivery still depends on the configured provider. See [Neon's verification guide](https://neon.com/docs/auth/guides/email-verification) and [Email OTP guide](https://neon.com/docs/auth/guides/plugins/email-otp).

Keep the branch settings aligned with the verification screen:

```sh
neon neon-auth config email-password update --enabled --email-verification-method otp --require-email-verification --send-verification-email-on-sign-up --send-verification-email-on-sign-in
```

The `auth: true` declaration in `neon.ts` enables Auth; it does not set these delivery options. If auto-send is disabled, account creation can succeed without sending a code.

### Resend SMTP

Configure Resend on the Neon branch's email provider using `smtp.resend.com`, port `465`, username `resend`, and the Resend API key as the SMTP password. Keep the key in the ignored local environment file and Neon's saved provider settings. The Next.js app does not need the Resend key in Vercel because Neon sends the auth emails. Never put the key in browser code or commit it.

The starter sender is `onboarding@resend.dev`, which is restricted to the Resend account owner's address and supported test recipients. Before onboarding other staff, verify a sending domain in Resend and switch the Neon sender email to an address on that domain. The app's Vercel website origin and its email sending domain are separate settings. See [Resend SMTP setup](https://resend.com/docs/send-with-smtp).

Check delivery without exposing a verification code:

```sh
neon neon-auth config email-provider test --recipient-email <your-staff-email>
```

Then request a verification code through the app and check its delivery status in Resend. Enter the code only in the app. An SMTP test email is not a verification code.

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
