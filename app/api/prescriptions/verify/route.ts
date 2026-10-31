import { requireStaffApi } from "@/lib/auth/staff";
import { checkOrigin, privateHeaders } from "@/lib/pharmacy/http";
import { PharmacyError } from "@/lib/pharmacy/validation";
import { extractPrescription } from "@/lib/prescription/extract";
import { prescriptionAvailability, PrescriptionError, recognizePrescription } from "@/lib/prescription/service";

export const maxDuration = 120;

export async function GET() {
  const denied = await requireStaffApi();
  if (denied) return denied;
  return Response.json(prescriptionAvailability(), { headers: privateHeaders });
}

export async function POST(request: Request) {
  const denied = await requireStaffApi();
  if (denied) return denied;
  try {
    checkOrigin(request);
    const ocr = await recognizePrescription(request);
    return Response.json(extractPrescription(ocr), { headers: privateHeaders });
  } catch (error) {
    const known = error instanceof PrescriptionError || error instanceof PharmacyError;
    return Response.json({ error: known ? error.message : "Prescription text extraction is unavailable. Please try again." }, { status: known ? error.status : 503, headers: privateHeaders });
  }
}
