export type AuthFailure = { message: string; verifyEmail: boolean };

// The Neon client can throw normalized snake_case errors for HTTP failures,
// while other SDK paths return Better Auth's original uppercase codes.
export function authFailure(error: unknown): AuthFailure {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof detail.code === "string" ? detail.code.toLowerCase() : "";
  const status = typeof detail.status === "number" ? detail.status : undefined;
  const failure = (message: string, verifyEmail = false): AuthFailure => ({ message, verifyEmail });

  if (["email_not_verified", "email_not_confirmed"].includes(code)) return failure("Verify your email address to continue. You can request a code below.", true);
  if (["invalid_email_or_password", "invalid_password", "invalid_credentials", "user_not_found", "credential_account_not_found", "identity_not_found"].includes(code)) return failure("The email or password was not accepted. Check your details and try again.");
  if (["user_already_exists", "user_already_exists_use_another_email", "email_exists"].includes(code)) return failure("An account already uses this email. Choose Sign in, or Verify email if you still need a verification code.");
  if (["invalid_otp", "otp_expired", "too_many_attempts"].includes(code)) return failure("That code could not be verified. Check it or request a new code.");
  if (status === 429 || ["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"].includes(code)) return failure("There have been too many attempts. Please wait a moment and try again.");
  if (["password_too_short", "password_too_long", "weak_password"].includes(code)) return failure("Choose a password between 8 and 128 characters.");
  if (["invalid_email", "email_address_invalid"].includes(code)) return failure("Enter a valid email address and try again.");
  if (code === "auth_not_configured") return failure("Staff sign-in is not available yet. Please contact the project owner.");
  if ((status !== undefined && status >= 500) || code === "auth_unavailable") return failure("The sign-in service is unavailable. Please try again shortly.");
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return failure("The sign-in service could not be reached. Check your connection and try again.");
  // Never display arbitrary exception or provider messages, which may contain
  // request details. Unrecognized failures are not assumed to be network errors.
  return failure("We couldn’t complete that request. Please try again or contact the project owner.");
}
