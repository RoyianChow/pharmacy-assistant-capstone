import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { hasAuthConfiguration, isLocalAuthDemo } from "@/lib/auth/config";

export async function proxy(request: NextRequest) {
  if (isLocalAuthDemo()) return NextResponse.next();
  if (!hasAuthConfiguration()) return NextResponse.redirect(new URL("/auth/sign-in?reason=setup", request.url));
  try {
    return await getAuth().middleware({ loginUrl: "/auth/sign-in" })(request);
  } catch {
    return NextResponse.redirect(new URL("/auth/sign-in?reason=unavailable", request.url));
  }
}

// APIs independently authorize every protected read and write; patient intake stays public.
export const config = { matcher: ["/pharmacy/:path*"] };
