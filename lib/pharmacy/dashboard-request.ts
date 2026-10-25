export type DashboardRequestErrorKind = "http" | "network" | "timeout" | "invalid_response";

export class DashboardRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly kind: DashboardRequestErrorKind = "http",
  ) {
    super(message);
    this.name = "DashboardRequestError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

function httpMessage(status: number) {
  if (status === 401) return "Your staff session is no longer available. Sign in again to continue.";
  if (status === 403) return "Your account does not have access to this pharmacy workspace.";
  if (status === 404) return "This assessment could not be found. Refresh the queue and select a case again.";
  if (status === 409) return "Another review was saved. Load the latest version before saving again.";
  if (status === 429) return "There have been too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The pharmacy service is temporarily unavailable. Please try again.";
  if (status === 400 || status === 422) return "Please check the reviewer name, status, and notes before trying again.";
  return "The request could not be completed. Please try again.";
}

function cancelled() {
  return new DOMException("The request was cancelled.", "AbortError");
}

/** Bound both the fetch and body read; never display server or parser error bodies. */
export async function fetchDashboard<T>(url: string, init: RequestInit = {}): Promise<T> {
  const parentSignal = init.signal;
  if (parentSignal?.aborted) throw cancelled();

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      // HTTP status is enough to explain a rejection. An intermediary's body
      // may be HTML, contain private implementation details, or never finish.
      void response.body?.cancel().catch(() => {});
      throw new DashboardRequestError(httpMessage(response.status), response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new DashboardRequestError("The pharmacy service returned an unreadable response. Please try again.", response.status, "invalid_response");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new DashboardRequestError("The pharmacy service returned an unexpected response. Please try again.", response.status, "invalid_response");
    }
    if (controller.signal.aborted) throw cancelled();
    return body as T;
  } catch (error) {
    // Caller cancellation is intentionally distinguishable from a request
    // deadline so unmounted or superseded views can ignore it quietly.
    if (parentSignal?.aborted) throw cancelled();
    if (timedOut) throw new DashboardRequestError("The request took too long. Please try again.", null, "timeout");
    if (error instanceof DashboardRequestError) throw error;
    throw new DashboardRequestError("We couldn’t connect to the pharmacy service. Check your connection and try again.", null, "network");
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
