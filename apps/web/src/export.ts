import { ApiError, reportSessionFailure } from "./api";

const FALLBACK_NAME = "qbank-progress.json";

/** Fetches her progress export and hands it to the browser as a file download. */
export async function downloadProgressExport(): Promise<string> {
  const response = await fetch("/api/me/export");
  if (!response.ok) {
    const body = errorBody(await response.text());
    reportSessionFailure("/api/me/export", "GET", response.status, body);
    throw new ApiError(response.status, body);
  }
  const name = fileName(response.headers.get("content-disposition"));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari starts the download after the click returns, so the address stays valid a little longer.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
  return name;
}

/** A proxy in front of the API can answer a failure with a page instead of JSON. */
function errorBody(text: string): unknown {
  try {
    return text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function fileName(disposition: string | null): string {
  const match = disposition === null ? null : /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? FALLBACK_NAME;
}
