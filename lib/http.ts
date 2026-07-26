/** Small helpers shared by route handlers. */

/** Read an idempotency key from the standard header (§7). */
export function idempotencyKey(req: Request): string | undefined {
  return req.headers.get("idempotency-key") ?? undefined;
}
