import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/payouts/:id — status + txHash (§11).
export const GET = handle(async (req) => {
  const user = await requireUser();
  const id = req.url.split("/").pop()!.split("?")[0];
  const payout = await db.payout.findUnique({ where: { id } });
  if (!payout || payout.userId !== user.id) return fail("NOT_FOUND", "No such payout.", 404);
  return ok({
    id: payout.id,
    kind: payout.kind,
    status: payout.status,
    amountWei: payout.amountWei,
    txHash: payout.txHash,
    lastError: payout.lastError,
  });
});
