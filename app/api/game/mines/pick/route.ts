import { z } from "zod";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { actOnRound } from "@/lib/stateful";
import { minesMultBps, minesPayout, MINES_TILES } from "@/lib/games/mines";

const bodySchema = z.object({
  roundId: z.string().min(1),
  tile: z.number().int().min(0).max(24),
});

// POST /api/game/mines/pick (§10.3)
export const POST = handle(async (req) => {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("BAD_REQUEST", "Pick a tile.", 400);
  const { roundId, tile } = parsed.data;

  const acted = await actOnRound({
    userId: user.id,
    roundId,
    game: "MINES",
    apply: (state, stake) => {
      const mines = state.mines as number;
      const bombs = state.bombs as number[];
      const picks = state.picks as number[]; // safe picks only
      if (picks.includes(tile)) throw new ApiError("BAD_TILE", "That tile is already turned.", 400);

      if (bombs.includes(tile)) {
        return {
          state: { ...state, busted: true, hitTile: tile },
          done: true,
          returnCents: 0n,
          outcome: { hit: "bomb", tile, bombs },
        };
      }
      const nextPicks = [...picks, tile];
      const k = nextPicks.length;
      const cleared = k === MINES_TILES - mines;
      return {
        state: { ...state, picks: nextPicks },
        done: cleared,
        returnCents: cleared ? minesPayout(stake, k, mines) : undefined,
        outcome: cleared ? { cleared: true, bombs } : undefined,
      };
    },
  });

  const mines = acted.state.mines as number;
  const picks = acted.state.picks as number[];
  const busted = acted.state.busted === true;
  const k = picks.length;
  const nextSafe = k < MINES_TILES - mines;

  return ok({
    roundId,
    tile,
    safe: !busted,
    done: acted.done,
    safePicks: k,
    multBps: busted ? 0 : k === 0 ? 10_000 : Number(minesMultBps(k, mines)),
    nextMultBps: !acted.done && nextSafe ? Number(minesMultBps(k + 1, mines)) : null,
    returnCents: acted.done ? acted.returnCents : undefined,
    outcome: acted.done ? acted.outcome : undefined,
    balanceAfter: acted.balanceAfter,
  });
});
