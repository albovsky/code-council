// Fetch wrapper with error handling and base URL management
import { ApiResponse } from "@/lib/types";

// Server-side: hit the daemon directly on this host.
// Browser-side: go through the Next.js proxy at /api/daemon (the browser
// cannot reach 127.0.0.1 on the server).
//
// API_PREFIX freezes the wire shape at v0.7 — every path passed to
// fetchFromDaemon is implicitly under /api/v1. v0.8 may add /api/v2
// alongside without breaking existing consumers.
const SERVER_BASE =
  process.env.CHORUS_DAEMON_URL || "http://127.0.0.1:7707";
const CLIENT_BASE = "/api/daemon";
const API_PREFIX = "/api/v1";

function getBaseUrl(): string {
  if (typeof window === "undefined") return SERVER_BASE;
  return new URL(CLIENT_BASE, window.location.origin).toString();
}

export class DaemonError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    /**
     * Optional structured payload mirrored from the server envelope's
     * `error.details`. Used for zod-issue lists from /templates POST so
     * the cockpit can pin each error to the field it references.
     */
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DaemonError";
  }
}

export async function fetchFromDaemon<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const base = getBaseUrl();
  // Normalise to a leading-slash form first so the prefix check can
  // anchor on `/api/v1` exactly. Without this, `api/v1/foo` (no leading
  // slash) gets double-prefixed → `/api/v1/api/v1/foo`.
  const normalised = path.startsWith("/") ? path : `/${path}`;
  // Exact-segment match — naive `startsWith` would match `/api/v10/...`
  // or `/api/v1foo/...` and skip prepending.
  const isPrefixed =
    normalised === API_PREFIX || normalised.startsWith(`${API_PREFIX}/`);
  const versionedPath = isPrefixed ? normalised : `${API_PREFIX}${normalised}`;
  const url = `${base.replace(/\/$/, "")}${versionedPath}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data: ApiResponse<T> = await response.json().catch(() => ({
      ok: false,
      error: {
        code: "parse_error",
        message: "Failed to parse response",
      },
    }));

    if (!data.ok) {
      throw new DaemonError(
        data.error?.code || "unknown",
        response.status,
        data.error?.message || "Unknown error",
        data.error?.details,
      );
    }

    return data.data as T;
  } catch (error) {
    if (error instanceof DaemonError) {
      throw error;
    }

    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new DaemonError(
        "connection_failed",
        0,
        "Failed to connect to Chorus daemon. Is it running?",
      );
    }

    throw new DaemonError(
      "unknown",
      0,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}
