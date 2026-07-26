/**
 * Consistent API envelope (§11):
 *   success -> { ok: true, data }
 *   failure -> { ok: false, error: { code, message } }
 *
 * Error messages are written for the player, in the interface's voice.
 * BigInt values anywhere in `data` are serialised to strings automatically.
 */
import { NextResponse } from "next/server";
import { ApiError } from "./errors";

export { ApiError };

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return new NextResponse(JSON.stringify({ ok: true, data }, bigintReplacer), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fail(code: string, message: string, status = 400): NextResponse {
  return new NextResponse(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Wrap a handler so thrown ApiErrors become clean envelopes. */
export function handle(
  fn: (req: Request) => Promise<NextResponse>
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code, e.message, e.status);
      console.error("Unhandled API error:", e);
      return fail("INTERNAL", "Something went wrong at the counter. Try again.", 500);
    }
  };
}
