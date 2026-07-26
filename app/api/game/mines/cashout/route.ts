import { z } from "zod";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { actOnRound } from "@/lib/stateful";
import { minesMultBps, minesPayout } from "@/lib/games/mines";

const bodySchema = z.object({ roundId: z.string().min(1) });

// POST /api/game/mines/cashout (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Missing round.", 400);

  const acted = await actOnRound({
    userId: user.id,
    roundId: parsed.data.roundId,
    game: "MINES",
    apply: (state, stake) => {
      const mines = state.mines as number;
      const picks = state.picks as number[];
      const k = picks.length;
      if (k === 0) throw new ApiError("NO_PICKS", "Turn at least one tile before cashing out.", 400);
      return {
        state,
        done: true,
        returnCents: minesPayout(stake, k, mines),
        outcome: { cashout: true, safePicks: k, bombs: state.bombs },
      };
    },
  });

  const picks = acted.state.picks as number[];
  const mines = acted.state.mines as number;
  return ok({
    roundId: parsed.data.roundId,
    done: true,
    safePicks: picks.length,
    multBps: Number(minesMultBps(picks.length, mines)),
    returnCents: acted.returnCents,
    outcome: acted.outcome,
    balanceAfter: acted.balanceAfter,
  });
});
