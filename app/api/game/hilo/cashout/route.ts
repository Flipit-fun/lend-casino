import { z } from "zod";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { actOnRound } from "@/lib/stateful";
import { mulDivFloor } from "@/lib/money";

const bodySchema = z.object({ roundId: z.string().min(1) });

// POST /api/game/hilo/cashout (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Missing round.", 400);

  const acted = await actOnRound({
    userId: user.id,
    roundId: parsed.data.roundId,
    game: "HILO",
    apply: (state, stake) => {
      const calls = state.calls as number;
      const multBps = BigInt(state.multBps as number);
      if (calls === 0) throw new ApiError("NO_CALLS", "Make at least one call before taking it.", 400);
      return {
        state,
        done: true,
        returnCents: mulDivFloor(stake, multBps, 10_000n),
        outcome: { cashout: true, calls, multBps: Number(multBps) },
      };
    },
  });

  return ok({
    roundId: parsed.data.roundId,
    done: true,
    returnCents: acted.returnCents,
    outcome: acted.outcome,
    balanceAfter: acted.balanceAfter,
  });
});
