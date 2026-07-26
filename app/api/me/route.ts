import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { totalDebtCents } from "@/lib/ledger";
import { sellPolicy } from "@/lib/env";
import { getEthUsd } from "@/lib/prices";
import { ethOwedWei } from "@/lib/money";

// GET /api/me — address, chips, free chips, debt, positions (§11).
export const GET = handle(async () => {
  const user = await requireUser();
  const debtCents = await totalDebtCents(user.id);
  const chipsCents = user.chipsCents;

  // Sellable chips depend on SELL_POLICY (§9.2):
  //   full          -> entire balance
  //   winnings_only -> balance above outstanding debt
  const freeCents =
    sellPolicy() === "full" ? chipsCents : chipsCents - debtCents > 0n ? chipsCents - debtCents : 0n;

  const eth = await getEthUsd();
  const debtWei = ethOwedWei(debtCents, eth.cents);

  const positions = await db.position.findMany({
    where: { userId: user.id, status: { in: ["OPEN", "SETTLING"] } },
    orderBy: { openedAt: "desc" },
    select: {
      ticketNo: true,
      assetSymbol: true,
      qtyRaw: true,
      markPriceCents: true,
      valueCents: true,
      drawnCents: true,
      debtCents: true,
      status: true,
      openedAt: true,
    },
  });

  return ok({
    address: user.address,
    chipsCents,
    freeCents,
    debtCents,
    debtWei,
    ethUsdCents: eth.cents,
    positions,
  });
});
