import { connection } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { hasAuthConfiguration } from "@/lib/auth/config";

type Context = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

async function handle(method: Method, request: Request, context: Context) {
  await connection();
  if (!hasAuthConfiguration()) return Response.json({ code: "AUTH_NOT_CONFIGURED", message: "Staff sign-in is not available yet. Please contact the project owner." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const response = await getAuth().handler()[method](request, context);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    console.error("[pharmacy-auth] provider_request_failed");
    return Response.json({ code: "AUTH_UNAVAILABLE", message: "The sign-in service is unavailable. Please try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: Request, context: Context) { return handle("GET", request, context); }
export async function POST(request: Request, context: Context) { return handle("POST", request, context); }
export async function PUT(request: Request, context: Context) { return handle("PUT", request, context); }
export async function DELETE(request: Request, context: Context) { return handle("DELETE", request, context); }
export async function PATCH(request: Request, context: Context) { return handle("PATCH", request, context); }
