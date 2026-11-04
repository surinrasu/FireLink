import type { LocationQuery, LocationResult } from "../../shared/locations";
import { api, APIError } from "./api";

/** Explicit address lookups share the server's application-wide upstream limit. */
export async function lookupLocations(
  query: LocationQuery,
  signal: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<LocationResult[]>("/locations", "POST", query, signal);
    } catch (error) {
      if (
        !(error instanceof APIError) ||
        error.status !== 429 ||
        attempt >= 2 ||
        signal.aborted
      )
        throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 1500);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
