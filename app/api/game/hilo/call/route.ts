import { z } from "zod";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { actOnRound } from "@/lib/stateful";
import { hiloStepMultBps, hiloWin } from "@/lib/games/hilo";
import { cardView } from "@/lib/games/cards";
import { mulDivFloor } from "@/lib/money";

const bodySchema = z.object({
  roundId: z.string().min(1),
  dir: z.enum(["hi", "lo"]),
});

// POST /api/game/hilo/call (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Call higher or lower.", 400);
  const { roundId, dir } = parsed.data;

  const acted = await actOnRound({
    userId: user.id,
    roundId,
    game: "HILO",
    apply: (state, stake) => {
      const cards = state.cards as { v: number; s: number }[];
      const idx = state.idx as number;
      const multBps = BigInt(state.multBps as number);
      const calls = state.calls as number;
      if (idx >= cards.length) throw new ApiError("CHAIN_MAX", "Chain limit reached — take it.", 409);

      const current = cards[idx - 1].v;
      const next = cards[idx];
      const won = hiloWin(dir, current, next.v);

      if (!won) {
        return {
          state: { ...state, idx: idx + 1, busted: true },
          done: true,
          returnCents: 0n,
          outcome: { lost: true, dir, card: cardView(next.v, next.s) },
        };
      }
      const step = hiloStepMultBps(current, dir);
      const newMult = mulDivFloor(multBps, step, 10_000n);
      return {
        state: { ...state, idx: idx + 1, multBps: Number(newMult), calls: calls + 1 },
        done: false,
        outcome: { card: cardView(next.v, next.s) },
      };
    },
  });

  const cards = acted.state.cards as { v: number; s: number }[];
  const idx = acted.state.idx as number;
  const shown = cards[idx - 1];
  return ok({
    roundId,
    card: cardView(shown.v, shown.s),
    won: !acted.done,
    done: acted.done,
    multBps: acted.state.multBps as number,
    calls: acted.state.calls as number,
    returnCents: acted.done ? acted.returnCents : undefined,
    outcome: acted.done ? acted.outcome : undefined,
    balanceAfter: acted.balanceAfter,
  });
});
