import { connection } from "next/server";
import { checkOrigin, errorResponse, privateHeaders, readJson } from "@/lib/pharmacy/http";
import { getPharmacyStore } from "@/lib/pharmacy/store";
import { validateFilters, validateSubmission } from "@/lib/pharmacy/validation";

export async function GET(request: Request) {
  await connection();
  try {
    checkOrigin(request);
    const filters = validateFilters(new URL(request.url));
    return Response.json(getPharmacyStore().list(filters), { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const submission = validateSubmission(await readJson(request));
    const result = getPharmacyStore().submit(submission);
    return Response.json({ receipt: result.receipt }, { status: result.created ? 201 : 200, headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
