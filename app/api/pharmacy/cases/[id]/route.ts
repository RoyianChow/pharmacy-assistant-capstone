import { connection } from "next/server";
import { requireStaffApi } from "@/lib/auth/staff";
import { checkOrigin, errorResponse, privateHeaders, readJson } from "@/lib/pharmacy/http";
import { getPharmacyStore } from "@/lib/pharmacy/store";
import { validateId, validateReview } from "@/lib/pharmacy/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const denied = await requireStaffApi();
    if (denied) return denied;
    checkOrigin(request);
    const id = validateId((await context.params).id);
    const store = await getPharmacyStore();
    return Response.json({ case: await store.get(id) }, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const denied = await requireStaffApi();
    if (denied) return denied;
    const review = validateReview(await readJson(request));
    const id = validateId((await context.params).id);
    const store = await getPharmacyStore();
    return Response.json({ case: await store.review(id, review) }, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
