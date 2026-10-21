import { connection } from "next/server";
import { requireStaffApi } from "@/lib/auth/staff";
import { checkOrigin, errorResponse, privateHeaders, readJson } from "@/lib/pharmacy/http";
import { getPharmacyStore } from "@/lib/pharmacy/store";
import { validateFilters, validateSubmission } from "@/lib/pharmacy/validation";

export async function GET(request: Request) {
  await connection();
  try {
    const denied = await requireStaffApi();
    if (denied) return denied;
    checkOrigin(request);
    const filters = validateFilters(new URL(request.url));
    const store = await getPharmacyStore();
    return Response.json(await store.list(filters), { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const submission = validateSubmission(await readJson(request));
    const store = await getPharmacyStore();
    const result = await store.submit(submission);
    return Response.json({ receipt: result.receipt }, { status: result.created ? 201 : 200, headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
