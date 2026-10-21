import { connection } from "next/server";
import { checkOrigin, errorResponse, privateHeaders, readJson } from "@/lib/pharmacy/http";
import { getPharmacyStore } from "@/lib/pharmacy/store";
import { validateId, validateReview } from "@/lib/pharmacy/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    checkOrigin(request);
    const id = validateId((await context.params).id);
    return Response.json({ case: getPharmacyStore().get(id) }, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const review = validateReview(await readJson(request));
    const id = validateId((await context.params).id);
    return Response.json({ case: getPharmacyStore().review(id, review) }, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
