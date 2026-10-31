import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { createAuthClient } from "@neondatabase/auth/next";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/auth/errors.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { authFailure } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

// Exercise the installed Neon client rather than approximating its error
// contract. Only HTTP is mocked; no account, provider or env file is accessed.
const client = createAuthClient();
const credentials = { email: "fictional@example.invalid", password: "test-only-noncredential" };
let originalFetch;
let requests;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  requests = 0;
  globalThis.fetch = async () => { throw new Error("Unexpected test request"); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function rejectedSignIn(status, providerCode, message = "private-provider-detail") {
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ code: providerCode, message }, { status });
  };
  let thrown;
  await assert.rejects(client.signIn.email(credentials), error => { thrown = error; return true; });
  assert.equal(requests, 1);
  return thrown;
}

test("Neon wrong-password exceptions display a credential error, not a connection error", async () => {
  const error = await rejectedSignIn(401, "INVALID_EMAIL_OR_PASSWORD");
  assert.equal(error.code, "invalid_credentials");
  assert.equal(error.status, 401);
  assert.deepEqual(authFailure(error), {
    message: "The email or password was not accepted. Check your details and try again.",
    verifyEmail: false,
  });
  assert.deepEqual(authFailure({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }), authFailure(error));
});

test("Neon unverified-email exceptions request verification even after the SDK changes their status", async () => {
  const error = await rejectedSignIn(403, "EMAIL_NOT_VERIFIED");
  assert.equal(error.code, "email_not_confirmed");
  assert.equal(error.status, 422);
  assert.deepEqual(authFailure(error), {
    message: "Verify your email address to continue. You can request a code below.",
    verifyEmail: true,
  });
  assert.deepEqual(authFailure({ code: "EMAIL_NOT_VERIFIED", status: 403 }), authFailure(error));
});

test("Neon rate-limit and service failures are actionable without leaking provider messages", async () => {
  const limited = await rejectedSignIn(429, "TOO_MANY_REQUESTS");
  assert.equal(limited.code, "over_request_rate_limit");
  assert.match(authFailure(limited).message, /too many attempts/i);
  requests = 0;
  const unavailable = await rejectedSignIn(503, "AUTH_UNAVAILABLE");
  assert.equal(unavailable.code, "feature_not_supported");
  assert.equal(authFailure(unavailable).message, "The sign-in service is unavailable. Please try again shortly.");
  assert.equal(authFailure(unavailable).verifyEmail, false);
  assert.doesNotMatch(authFailure(unavailable).message, /private-provider-detail|connection/i);
});

test("Neon registration errors keep existing-account and password guidance", async () => {
  for (const [providerCode, expectedCode, expectedMessage] of [
    ["USER_ALREADY_EXISTS", "user_already_exists", /An account already uses this email/],
    ["PASSWORD_TOO_SHORT", "weak_password", /password between 8 and 128/],
  ]) {
    globalThis.fetch = async () => Response.json({ code: providerCode, message: "private-provider-detail" }, { status: 400 });
    let error;
    await assert.rejects(client.signUp.email({ ...credentials, name: "Fictional Example" }), caught => { error = caught; return true; });
    assert.equal(error.code, expectedCode);
    assert.match(authFailure(error).message, expectedMessage);
    assert.equal(authFailure(error).verifyEmail, false);
  }
});

test("actual transport failures retain connection guidance while unknown exceptions stay generic", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  let error;
  await assert.rejects(client.signIn.email(credentials), caught => { error = caught; return true; });
  assert.match(authFailure(error).message, /Check your connection/);
  for (const unknown of [new Error("private-provider-detail"), new TypeError("Cannot read properties of null"), null, undefined, "private-provider-detail", { message: "private-provider-detail" }]) {
    const failure = authFailure(unknown);
    assert.match(failure.message, /couldn’t complete that request/);
    assert.doesNotMatch(failure.message, /private-provider-detail|connection/);
    assert.equal(failure.verifyEmail, false);
  }
});

test("returned Better Auth errors keep OTP, setup, email and password recovery messages", () => {
  for (const providerCode of ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]) {
    assert.match(authFailure({ code: providerCode }).message, /code could not be verified/);
  }
  assert.match(authFailure({ code: "AUTH_NOT_CONFIGURED", status: 503 }).message, /not available yet/);
  assert.match(authFailure({ code: "INVALID_EMAIL" }).message, /valid email address/);
  assert.match(authFailure({ code: "PASSWORD_TOO_LONG" }).message, /password between 8 and 128/);
  assert.match(authFailure({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }).message, /An account already uses this email/);
});
