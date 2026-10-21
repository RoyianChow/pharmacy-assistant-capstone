import { connection } from "next/server";
import { assess, nextQuestions, summarize, validateAnswers } from "@/lib/assessment/engine";
import { chooseNextQuestion } from "@/lib/assessment/jev";
import type { ChatResponse } from "@/lib/assessment/types";

const MAX_BODY_BYTES = 48_000;
const requests = new Map<string, { count: number; reset: number }>();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  await connection();
  return Response.json({ mode: process.env.TYPESAFE_API_KEY?.trim() ? "jev" : "demo" }, { headers });
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Assessment request is too large."); }
    chunks.push(chunk.value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new Error("Please send a valid assessment request."); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Please use this site's assessment page." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected a JSON assessment." }, { status: 415, headers });

  // Local-prototype guard, shared within this process. Hosted deployments need a trusted proxy and shared limiter.
  const now = Date.now();
  for (const [key, value] of requests) if (value.reset <= now) requests.delete(key);
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 100) ?? "local";
  const entry = requests.get(key) ?? { count: 0, reset: now + 60_000 };
  if (entry.count >= 45 || requests.size >= 1000 && !requests.has(key)) return Response.json({ error: "Please wait a minute before continuing. Your answers are still here." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  entry.count++;
  requests.set(key, entry);

  let answers;
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || !("consent" in body) || body.consent !== true || !("answers" in body)) throw new Error("Please acknowledge the demo and data-use information before starting.");
    if (process.env.TYPESAFE_API_KEY?.trim() && (!("providerConsent" in body) || body.providerConsent !== true)) throw new Error("Jev is now enabled. Reload the page and acknowledge TypeSafe AI data use before continuing.");
    answers = validateAnswers(body.answers);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid assessment." }, { status: 400, headers });
  }
  const result = assess(answers);
  const candidates = nextQuestions(answers);
  const common = { summary: summarize(answers), progress: { answered: answers.length, total: 14 + answers.filter(a => a.questionId.startsWith("safety_")).length } };
  if (result) return Response.json({ ...common, mode: process.env.TYPESAFE_API_KEY?.trim() ? "jev" : "demo", result } satisfies ChatResponse, { headers });
  const decision = await chooseNextQuestion({ answers }, candidates);
  const question = candidates.find(q => q.id === decision.questionId) ?? candidates[0];
  return Response.json({ ...common, mode: decision.mode, notice: decision.notice, question } satisfies ChatResponse, { headers });
}
