import { requireStaffApi } from "@/lib/auth/staff";
import { checkOrigin, privateHeaders } from "@/lib/pharmacy/http";
import { PharmacyError } from "@/lib/pharmacy/validation";
import { classifierAvailability, ClassifierError, classifyPrescription } from "@/lib/prescription/classifier-service";

export const maxDuration = 60;

export async function GET() {
  const denied = await requireStaffApi();
  if (denied) return denied;
  return Response.json(classifierAvailability(), { headers: privateHeaders });
}

export async function POST(request: Request) {
  const denied = await requireStaffApi();
  if (denied) return denied;
  try {
    checkOrigin(request);
    return Response.json(await classifyPrescription(request), { headers: privateHeaders });
  } catch (error) {
    const known = error instanceof ClassifierError || error instanceof PharmacyError;
    return Response.json({ error: known ? error.message : "The prescription classifier is unavailable. No prediction was made." }, { status: known ? error.status : 503, headers: privateHeaders });
  }
}
