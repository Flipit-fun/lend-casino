// Lend.Casino client controller — SERVER-DRIVEN. No RNG lives here: every game
// outcome comes from the API; this file only renders and animates toward the
// result the server already decided. Wallet/auth/purse are owned by AppBridge
// (window.LC); this code calls window.LC for on-chain actions + refresh.

export function initCage(): () => void {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const on = (
    t: Window | Document | HTMLElement,
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions
  ) => {
    t.addEventListener(type, fn, opts);
    cleanups.push(() => t.removeEventListener(type, fn, opts));
  };

  /* ---------------------------------------------------------------- util */
  const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) =>
    r.querySelector(s) as T | null;
  const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) =>
    [...r.querySelectorAll(s)] as T[];
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Price formatter that keeps precision for sub-cent marks (e.g. micro-priced tokens).
  const usdPx = (n: number) =>
    n > 0 && n < 0.01
      ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
      : usd(n);
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const uuid = () => (crypto as Crypto).randomUUID();

  function toast(msg: string, kind = "") {
    const box = $("#toasts");
    if (!box) return;
    const t = document.createElement("div");
    t.className = "toast " + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = ".35s";
      t.style.opacity = "0";
      t.style.transform = "translateX(24px)";
    }, 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /* --------------------------------------------------------- LC bridge */
  type LC = {
    authed: boolean;
    chainOk: boolean;
    me: { chipsCents: string; freeCents: string; debtCents: string; ethUsdCents: string } | null;
    refetchMe: () => Promise<unknown>;
    deposit: (token: string, to: string, qtyRaw: string) => Promise<string>;
    payEth: (to: string, wei: string) => Promise<string>;
  };
  const lc = () => (window as unknown as { LC?: LC }).LC;
  const authed = () => !!lc()?.authed;
  const chips = () => Math.floor(Number(lc()?.me?.chipsCents ?? 0) / 100);
  const freeChips = () => Math.floor(Number(lc()?.me?.freeCents ?? 0) / 100);
  const refresh = async () => {
    try {
      await lc()?.refetchMe?.();
    } catch {
      /* ignore */
    }
  };
  function requireAuth(): boolean {
    if (!authed()) {
      toast("Connect your Robinhood wallet and sign in first.", "bad");
      return false;
    }
    return true;
  }

  /* --------------------------------------------------------- API client */
  async function api<T = unknown>(
    path: string,
    opts: { method?: string; body?: unknown; idem?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.idem) headers["idempotency-key"] = uuid();
    const res = await fetch(path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok === false) {
      throw new Error(j?.error?.message ?? "Something went wrong at the counter.");
    }
    return j.data as T;
  }

  /* ---------------------------------------------------------------- loader */
  {
    const word = "LEND.CASINO";
    const mark = $("#loadMark");
    if (mark) {
      mark.innerHTML = [...word]
        .map((c, i) => `<span style="animation-delay:${i * 0.05}s">${c === " " ? "&nbsp;" : c}</span>`)
        .join("");
    }
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(100, p + Math.random() * 13 + 6);
      const bar = $<HTMLElement>("#loadBar");
      if (bar) bar.style.width = p + "%";
      const num = $("#loadNum");
      if (num) num.textContent = "OPENING THE FLOOR — " + String(Math.floor(p)).padStart(2, "0") + "%";
      if (p >= 100) {
        clearInterval(tick);
        setTimeout(() => {
          if (disposed) return;
          $("#loader")?.classList.add("gone");
          const h = $("#heroLine");
          if (h) {
            h.innerHTML = h.innerHTML.replace(/([^<>]+)(?=<|$)/g, (m) =>
              m.split(/(\s+)/).map((w) => (w.trim() ? `<span>${w}</span>` : w)).join("")
            );
            $$("#heroLine span").forEach((s, i) => ((s as HTMLElement).style.animationDelay = i * 0.07 + "s"));
            h.classList.add("go");
          }
        }, 300);
      }
    }, 165);
    cleanups.push(() => clearInterval(tick));
  }

  /* ------------------------------------------------------------ suit wall */
  {
    const cv = $<HTMLCanvasElement>("#wall");
    if (cv) {
      const ctx = cv.getContext("2d")!;
      const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
      let pips: Array<{ x: number; y: number; s: string; red: boolean; size: number; rot: number; ph: number; sp: number }> = [];
      let W = 0, H = 0, mx = -9999, my = -9999, t = 0;
      const rnd = (n: number) => Math.floor(Math.random() * n);
      function build() {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        W = innerWidth; H = innerHeight;
        cv!.width = W * dpr; cv!.height = H * dpr;
        cv!.style.width = W + "px"; cv!.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const gap = W < 700 ? 74 : 96;
        pips = [];
        for (let y = -1; y < Math.ceil(H / gap) + 2; y++)
          for (let x = -1; x < Math.ceil(W / gap) + 2; x++) {
            const i = rnd(4);
            pips.push({
              x: x * gap + (y % 2 ? gap * 0.5 : 0) + (Math.random() - 0.5) * 16,
              y: y * gap + (Math.random() - 0.5) * 16,
              s: SUITS[i], red: i === 1 || i === 2,
              size: (W < 700 ? 19 : 25) + Math.random() * 9,
              rot: (Math.random() - 0.5) * 0.5, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.7,
            });
          }
      }
      build();
      on(window, "resize", build);
      on(window, "mousemove", (e) => { mx = (e as MouseEvent).clientX; my = (e as MouseEvent).clientY; });
      on(window, "mouseleave", () => { mx = my = -9999; });
      const R = 230;
      function frame() {
        if (disposed) return;
        t += 0.008;
        ctx.clearRect(0, 0, W, H);
        const drift = (t * 7) % 96;
        for (const p of pips) {
          const py = p.y + drift;
          if (py < -70 || py > H + 70) continue;
          const d = Math.hypot(p.x - mx, py - my);
          const k = d < R ? Math.pow(1 - d / R, 1.8) : 0;
          const bob = Math.sin(t * p.sp + p.ph) * 3;
          const a = 0.075 + k * 0.8;
          ctx.save();
          ctx.translate(p.x, py + bob);
          ctx.rotate(p.rot + k * 0.32);
          ctx.font = (p.size * (1 + k * 0.3)).toFixed(1) + 'px Georgia, serif';
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          if (k > 0.02) { ctx.shadowColor = p.red ? `rgba(198,54,42,${k * 0.85})` : `rgba(185,139,46,${k * 0.85})`; ctx.shadowBlur = 6 + k * 30; }
          ctx.fillStyle = k > 0.05 ? (p.red ? `rgba(198,54,42,${a})` : `rgba(13,88,67,${a})`) : `rgba(22,33,28,${a})`;
          ctx.fillText(p.s, 0, 0);
          ctx.restore();
        }
        if (mx > -999) {
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, R);
          g.addColorStop(0, "rgba(255,240,201,.34)"); g.addColorStop(0.55, "rgba(255,240,201,.10)"); g.addColorStop(1, "rgba(255,240,201,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, R, 0, 6.2832); ctx.fill();
        }
        requestAnimationFrame(frame);
      }
      frame();
    }
  }

  /* ---------------------------------------------------------------- router */
  function go(page: string, game?: string) {
    $$(".page").forEach((p) => p.classList.remove("on"));
    $("#p-" + page)?.classList.add("on");
    $$<HTMLElement>(".navlinks button").forEach((b) => b.classList.toggle("on", b.dataset.go === page));
    if (game) openGame(game);
    if (page === "cage") loadCage();
    if (page === "games") loadFair();
    scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
  on(document, "click", (e) => {
    const el = (e.target as HTMLElement).closest("[data-go]") as HTMLElement | null;
    if (el) go(el.dataset.go!, el.dataset.gameopen);
  });

  /* ------------------------------------------------------------ table cards */
  const TABLES = [
    { id: "rollit", n: "Rollit", g: "\u2660", d: "Single-zero wheel, full layout. Straights, dozens, columns and even money.", e: "2.70%", p: "35:1 max" },
    { id: "coin", n: "Coin Toss", g: "\u25CF", d: "One call, one flip, one of the fastest ways to double a stack.", e: "2.00%", p: "1.96×" },
    { id: "bj", n: "Blackjack", g: "\u2663", d: "Six decks, dealer stands on all 17, double on any two cards.", e: "≈1.0%", p: "3:2" },
    { id: "mines", n: "Mines", g: "\u2666", d: "Turn tiles for a rising multiplier. Stop before you hit one.", e: "3.00%", p: "compounding" },
    { id: "dice", n: "Dice", g: "\u2b26", d: "Set your own line from 2 to 95. The tighter the line, the bigger the pay.", e: "2.00%", p: "up to 49×" },
    { id: "hilo", n: "Hi-Lo", g: "\u2665", d: "Call the next card higher or lower. Chain the calls or take the pot.", e: "3.00%", p: "chained" },
    { id: "slots", n: "Slots", g: "\u2b50", d: "Three reels, one pull. Line up the sevens for the top pay.", e: "3.51%", p: "up to 200×" },
  ];
  const tableCards = $("#tableCards");
  if (tableCards) {
    tableCards.innerHTML = TABLES.map(
      (tb, i) =>
        `<div class="ticket tcard" data-go="games" data-gameopen="${tb.id}"><div class="top"><span class="no">TABLE ${String(i + 1).padStart(2, "0")}</span><span class="gl">${tb.g}</span></div><h4>${tb.n}</h4><p>${tb.d}</p><div class="edge"><span>EDGE ${tb.e}</span><span>${tb.p.toUpperCase()}</span></div></div>`
    ).join("");
  }

  /* ----------------------------------------------------------- stake steppers */
  function stepper(sel: string, inputId: string) {
    $$<HTMLElement>(sel).forEach(
      (b) =>
        (b.onclick = () => {
          const el = $<HTMLInputElement>("#" + inputId)!;
          let v = +el.value || 0;
          const key = Object.values(b.dataset)[0];
          if (key === "half") v = Math.max(1, Math.floor(v / 2));
          if (key === "double") v = Math.max(1, v * 2);
          if (key === "max") v = Math.max(1, chips());
          el.value = String(v);
          el.dispatchEvent(new Event("input"));
        })
    );
  }

  /* ================================================================ CAGE */
  type Asset = { symbol: string; name: string; kind: string; decimals: number; ltvBps: number; unitLabel: string; markCents: string | null; markScaledCents: string | null };
  let ASSETS: Asset[] = [];
  let selectedAsset: Asset | null = null;

  async function loadAssets() {
    try {
      const { assets } = await api<{ assets: Asset[] }>("/api/assets");
      ASSETS = assets;
    } catch {
      ASSETS = [];
    }
    const list = $("#assetList");
    if (!list) return;
    list.innerHTML = "";
    ASSETS.forEach((a, i) => {
      const el = document.createElement("div");
      el.className = "asset";
      el.tabIndex = 0;
      const px = a.markScaledCents ? usdPx(Number(a.markScaledCents) / 1e11) : "—";
      el.innerHTML = `<div class="tk mono">${a.symbol}</div><div><div class="nm">${a.name}</div><div class="kind">${a.kind}</div></div><div style="text-align:right"><div class="px mono">${px}</div><div class="ltv mono">LTV ${Math.round(a.ltvBps / 100)}%</div></div><div class="mono" style="color:var(--ink-38);font-size:16px">&rsaquo;</div>`;
      const pick = () => {
        $$(".asset").forEach((n) => n.classList.remove("sel"));
        el.classList.add("sel");
        selectedAsset = a;
        drawDesk();
      };
      el.onclick = pick;
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
      list.appendChild(el);
      if (i === 0) pick();
    });
  }

  function drawDesk() {
    const a = selectedAsset;
    if (!a) return;
    const dollars = Math.max(0, +($("#qtyIn") as HTMLInputElement).value || 0);
    const usdCents = Math.round(dollars * 100);
    const pxUsd = a.markScaledCents ? Number(a.markScaledCents) / 1e11 : 0; // USD per unit
    const qty = pxUsd ? dollars / pxUsd : 0; // fractional units
    const drawCents = Math.floor((usdCents * a.ltvBps) / 10000);
    $("#deskTitle")!.textContent = a.symbol + " · " + a.name;
    $("#deskUnit")!.textContent = "USD";
    $("#roPrice")!.textContent = a.markScaledCents ? usdPx(pxUsd) : "—";
    $("#roQty")!.textContent = a.markScaledCents ? qty.toFixed(4) + " " + a.unitLabel : "—";
    $("#roLtv")!.textContent = Math.round(a.ltvBps / 100) + "%";
    const eth = Number(lc()?.me?.ethUsdCents ?? 0);
    $("#roEth")!.textContent = eth ? (drawCents / eth).toFixed(4) + " ETH" : "—";
    $("#roChips")!.textContent = fmt(drawCents / 100);
    ($("#pawnBtn") as HTMLButtonElement).disabled = drawCents < 1;
  }
  const qtyIn = $<HTMLInputElement>("#qtyIn");
  if (qtyIn) qtyIn.oninput = drawDesk;
  const qMinus = $("#qMinus"); if (qMinus) qMinus.onclick = () => { const el = $("#qtyIn") as HTMLInputElement; el.value = String(Math.max(0, (+el.value || 0) - 10)); drawDesk(); };
  const qPlus = $("#qPlus"); if (qPlus) qPlus.onclick = () => { const el = $("#qtyIn") as HTMLInputElement; el.value = String((+el.value || 0) + 10); drawDesk(); };

  async function pollPosition(id: string, want: string, tries = 24) {
    for (let i = 0; i < tries; i++) {
      await wait(5000);
      if (disposed) return null;
      try {
        const { positions } = await api<{ positions: Array<{ id: string; status: string }> }>("/api/positions");
        const p = positions.find((x) => x.id === id);
        if (p && p.status === want) return p;
      } catch { /* keep polling */ }
    }
    return null;
  }

  const pawnBtn = $("#pawnBtn");
  if (pawnBtn) pawnBtn.onclick = async () => {
    if (!requireAuth() || !selectedAsset) return;
    if (!lc()?.chainOk) { toast("Switch to Robinhood Chain first.", "bad"); return; }
    const a = selectedAsset;
    const dollars = Math.max(0, +($("#qtyIn") as HTMLInputElement).value || 0);
    const usdCents = Math.round(dollars * 100);
    if (usdCents < 1) return;
    (pawnBtn as HTMLButtonElement).disabled = true;
    try {
      const intent = await api<{ positionId: string; treasuryAddress: string; tokenAddress: string; qtyRaw: string }>(
        "/api/deposit/intent",
        { body: { symbol: a.symbol, usdCents }, idem: true }
      );
      toast(`Depositing $${dollars} of ${a.symbol}…`, "");
      await lc()!.deposit(intent.tokenAddress, intent.treasuryAddress, intent.qtyRaw);
      toast("Transfer sent — waiting for confirmations.", "good");
      const opened = await pollPosition(intent.positionId, "OPEN");
      if (opened) { toast(`Ticket issued — chips drawn against ${a.symbol}.`, "gold"); await refresh(); loadCage(); }
      else toast("Deposit not confirmed yet — it'll appear once it lands.", "");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      (pawnBtn as HTMLButtonElement).disabled = false;
    }
  };

  /* ---- SELL ---- */
  function sellReadout() {
    const sellIn = $<HTMLInputElement>("#sellIn");
    if (!sellIn) return;
    const n = clamp(Math.floor(+sellIn.value || 0), 0, freeChips());
    const eth = Number(lc()?.me?.ethUsdCents ?? 0);
    const net = n * 0.995;
    $("#sOut")!.textContent = eth ? ((net * 100) / eth).toFixed(4) + " ETH" : "—";
    ($("#sellBtn") as HTMLButtonElement).disabled = n < 1;
    $("#sEthPx")!.textContent = eth ? usd(eth / 100) : "—";
  }
  const sellIn = $<HTMLInputElement>("#sellIn");
  if (sellIn) sellIn.oninput = sellReadout;
  const sMinus = $("#sMinus"); if (sMinus) sMinus.onclick = () => { sellIn!.value = String(Math.max(0, (+sellIn!.value || 0) - 25)); sellReadout(); };
  const sPlus = $("#sPlus"); if (sPlus) sPlus.onclick = () => { sellIn!.value = String(Math.min(freeChips(), (+sellIn!.value || 0) + 25)); sellReadout(); };
  $$<HTMLElement>("[data-sellq]").forEach((b) => (b.onclick = () => { sellIn!.value = String(Math.floor((freeChips() * +b.dataset.sellq!) / 100)); sellReadout(); }));
  const sellBtn = $("#sellBtn");
  if (sellBtn) sellBtn.onclick = async () => {
    if (!requireAuth()) return;
    const n = clamp(Math.floor(+sellIn!.value || 0), 0, freeChips());
    if (n < 1) { toast("Nothing free to sell.", "bad"); return; }
    (sellBtn as HTMLButtonElement).disabled = true;
    try {
      const r = await api<{ payoutId: string }>("/api/chips/sell", { body: { chipsCents: n * 100 }, idem: true });
      toast(`Sold ${fmt(n)} chips — ETH payout queued.`, "gold");
      sellIn!.value = "0";
      await refresh();
      updateSellTop();
      // Best-effort payout status follow-up.
      (async () => {
        for (let i = 0; i < 12; i++) {
          await wait(4000);
          if (disposed) return;
          try {
            const p = await api<{ status: string; txHash: string | null }>(`/api/payouts/${r.payoutId}`);
            if (p.status === "CONFIRMED") { toast("ETH sent to your wallet.", "good"); return; }
            if (p.status === "FAILED") { toast("Payout failed — check the counter.", "bad"); return; }
          } catch { /* ignore */ }
        }
      })();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      (sellBtn as HTMLButtonElement).disabled = false;
    }
  };
  function updateSellTop() {
    $("#sChips")!.textContent = fmt(chips());
    $("#sFree")!.textContent = fmt(freeChips());
    const debt = Math.floor(Number(lc()?.me?.debtCents ?? 0) / 100);
    $("#sDebt")!.textContent = fmt(debt);
    sellReadout();
  }

  /* ---- REDEEM ---- */
  type Pos = { id: string; ticketNo: number; symbol: string; unitLabel: string; debtCents: string; currentValueCents: string | null; healthBps: number | null; status: string };
  let selectedPos: Pos | null = null;
  async function loadRedeem() {
    const box = $("#redeemList");
    if (!box) return;
    if (!authed()) { box.innerHTML = `<div class="empty">Sign in to see your open tickets.</div>`; return; }
    let positions: Pos[] = [];
    try { positions = (await api<{ positions: Pos[] }>("/api/positions")).positions.filter((p) => p.status === "OPEN"); } catch { /* */ }
    if (!positions.length) { box.innerHTML = `<div class="empty">No open tickets.</div>`; return; }
    box.innerHTML = "";
    positions.forEach((p) => {
      const el = document.createElement("div");
      el.className = "ticket slip";
      el.style.cursor = "pointer";
      el.innerHTML = `<div><div class="no">TICKET #${p.ticketNo}</div><div class="ln">${p.symbol}</div><div class="dt">owed ${usd(Number(p.debtCents) / 100)}</div></div><div class="mono" style="color:var(--ink-38)">&rsaquo;</div>`;
      el.onclick = () => { selectedPos = p; $$(".slip").forEach((n) => n.classList.remove("sel")); el.classList.add("sel"); drawRedeem(); };
      box.appendChild(el);
    });
  }
  function drawRedeem() {
    const p = selectedPos;
    if (!p) return;
    $("#redeemTitle")!.textContent = "#" + p.ticketNo + " · " + p.symbol;
    $("#rdDebt")!.textContent = usd(Number(p.debtCents) / 100);
    $("#rdValue")!.textContent = p.currentValueCents ? usd(Number(p.currentValueCents) / 100) : "—";
    $("#rdHealth")!.textContent = p.healthBps ? (p.healthBps / 100).toFixed(0) + "%" : "—";
    const eth = Number(lc()?.me?.ethUsdCents ?? 0);
    $("#rdEth")!.textContent = eth ? (Number(p.debtCents) / eth * 1.005).toFixed(4) + " ETH" : "—";
    ($("#redeemEthBtn") as HTMLButtonElement).disabled = false;
    ($("#redeemChipsBtn") as HTMLButtonElement).disabled = chips() < Math.ceil(Number(p.debtCents) / 100);
  }
  const redeemChipsBtn = $("#redeemChipsBtn");
  if (redeemChipsBtn) redeemChipsBtn.onclick = async () => {
    if (!requireAuth() || !selectedPos) return;
    try {
      await api("/api/redeem/with-chips", { body: { positionId: selectedPos.id }, idem: true });
      toast("Chips burned — collateral is releasing.", "gold");
      await refresh(); selectedPos = null; loadRedeem();
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  const redeemEthBtn = $("#redeemEthBtn");
  if (redeemEthBtn) redeemEthBtn.onclick = async () => {
    if (!requireAuth() || !selectedPos) return;
    if (!lc()?.chainOk) { toast("Switch to Robinhood Chain first.", "bad"); return; }
    const pos = selectedPos;
    try {
      const q = await api<{ ethOwedWei: string; treasuryAddress: string }>("/api/redeem/quote", { body: { positionId: pos.id }, idem: true });
      await lc()!.payEth(q.treasuryAddress, q.ethOwedWei);
      toast("ETH sent — releasing collateral once confirmed.", "good");
      await pollPosition(pos.id, "CLOSED");
      toast(`${pos.symbol} released back to your wallet.`, "gold");
      await refresh(); selectedPos = null; loadRedeem();
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  $$<HTMLElement>("[data-cagetab]").forEach((b) => (b.onclick = () => {
    $$("[data-cagetab]").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    const tab = b.dataset.cagetab;
    ($("#c-get") as HTMLElement).hidden = tab !== "get";
    ($("#c-sell") as HTMLElement).hidden = tab !== "sell";
    ($("#c-redeem") as HTMLElement).hidden = tab !== "redeem";
    if (tab === "sell") updateSellTop();
    if (tab === "redeem") loadRedeem();
  }));

  function loadCage() {
    loadAssets();
    updateSellTop();
  }

  /* ================================================================ FAIRNESS */
  async function loadFair() {
    if (!$("#fairHash") || !authed()) return; // fairness panel removed from UI
    try {
      const f = await api<{ serverSeedHash: string; clientSeed: string; nonce: number }>("/api/fair/current");
      $("#fairHash")!.textContent = f.serverSeedHash.slice(0, 12) + "…";
      $("#fairNonce")!.textContent = String(f.nonce);
      ($("#fairClientSeed") as HTMLInputElement).value = f.clientSeed;
    } catch { /* not signed in */ }
  }
  const fairSeedSave = $("#fairSeedSave");
  if (fairSeedSave) fairSeedSave.onclick = async () => {
    if (!requireAuth()) return;
    const seed = ($("#fairClientSeed") as HTMLInputElement).value.trim();
    if (!seed) return;
    try { await api("/api/fair/client-seed", { body: { clientSeed: seed } }); toast("Client seed set.", "good"); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const fairRotate = $("#fairRotate");
  if (fairRotate) fairRotate.onclick = async () => {
    if (!requireAuth()) return;
    try {
      const r = await api<{ revealedSeed: string | null; serverSeedHash: string }>("/api/fair/rotate", { body: {}, idem: false });
      if (r.revealedSeed) $("#fairReveal")!.textContent = "revealed: " + r.revealedSeed;
      $("#fairHash")!.textContent = r.serverSeedHash.slice(0, 12) + "…";
      $("#fairNonce")!.textContent = "0";
      toast("Server seed rotated — previous seed revealed.", "gold");
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  /* ================================================================ GAMES */
  function openGame(id: string) {
    $$<HTMLElement>("#tabs .tab").forEach((x) => x.classList.toggle("on", x.dataset.game === id));
    $$<HTMLElement>(".game").forEach((g) => (g.hidden = true));
    const g = $("#g-" + id) as HTMLElement | null;
    if (g) g.hidden = false;
  }
  $$<HTMLElement>("#tabs .tab").forEach((b) => (b.onclick = () => openGame(b.dataset.game!)));

  /* ---------------------------------------------------------------- ROLLIT */
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n: number) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
  const CSS: Record<string, string> = { red: "#C6362A", black: "#16211C", green: "#0D5843" };
  let bets: Record<string, number> = {}, spinning = false, chipVal = 5, history: number[] = [];

  const rack = $("#rack");
  if (rack) [1, 5, 25, 100, 500].forEach((v) => {
    const c = document.createElement("button");
    c.className = "chip c" + v + (v === 5 ? " on" : "");
    c.textContent = String(v);
    c.onclick = () => { chipVal = v; $$("#rack .chip").forEach((x) => x.classList.remove("on")); c.classList.add("on"); };
    rack.appendChild(c);
  });

  const board = $("#board");
  const cellMap: Record<string, HTMLElement> = {};
  function mkCell(label: string | number, key: string, cls: string, col: number | string, row: number | string, span?: number) {
    const d = document.createElement("div");
    d.className = "cell " + cls; d.textContent = String(label); d.dataset.key = key;
    d.style.gridColumn = span ? `${col} / span ${span}` : String(col);
    d.style.gridRow = String(row);
    d.onclick = () => placeBet(key, d);
    board!.appendChild(d); cellMap[key] = d; return d;
  }
  if (board) {
    mkCell("0", "n:0", "green zero", 1, "1 / span 3");
    for (let i = 0; i < 12; i++) [3 + i * 3, 2 + i * 3, 1 + i * 3].forEach((n, r) => mkCell(n, "n:" + n, colorOf(n), i + 2, r + 1));
    ([["c:3", 1], ["c:2", 2], ["c:1", 3]] as [string, number][]).forEach(([k, r]) => mkCell("2:1", k, "out", 14, r));
    ([["d:1", "1st 12", 2], ["d:2", "2nd 12", 6], ["d:3", "3rd 12", 10]] as [string, string, number][]).forEach(([k, l, c]) => mkCell(l, k, "out", c, 4, 4));
    ([["low", "1–18", 2], ["even", "Even", 4], ["red", "Red", 6], ["black", "Black", 8], ["odd", "Odd", 10], ["high", "19–36", 12]] as [string, string, number][]).forEach(([k, l, c]) => mkCell(l, k, "out", c, 5, 2));
  }
  function placeBet(key: string, el: HTMLElement) {
    if (spinning || !requireAuth()) return;
    bets[key] = (bets[key] || 0) + chipVal;
    let s = el.querySelector<HTMLElement>(".stack");
    if (!s) { s = document.createElement("div"); s.className = "stack"; el.appendChild(s); }
    s.textContent = String(bets[key]);
    s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    refreshWager();
  }
  function clearBets() { bets = {}; $$("#board .stack").forEach((s) => s.remove()); refreshWager(); }
  function refreshWager() {
    const tot = Object.values(bets).reduce((a, b) => a + b, 0);
    if ($("#rWager")) $("#rWager")!.textContent = fmt(tot);
    if ($("#rTotal")) $("#rTotal")!.textContent = fmt(tot);
    let best = 0;
    for (const k in bets) { const m = k.startsWith("n:") ? 36 : k.startsWith("d:") || k.startsWith("c:") ? 3 : 2; best = Math.max(best, bets[k] * m); }
    if ($("#rMax")) $("#rMax")!.textContent = fmt(best);
  }
  const rClear = $("#rClear"); if (rClear) rClear.onclick = () => { if (!spinning) clearBets(); };
  const rRepeat = $("#rRepeat"); if (rRepeat) rRepeat.onclick = () => toast("Repeat isn't available in live play — restake the layout.", "");

  const wcv = $<HTMLCanvasElement>("#wheel");
  const wx = wcv ? wcv.getContext("2d")! : null;
  const CX = 330, CY = 330, R_OUT = 316, R_POCK = 300, R_IN = 196, STEP = (Math.PI * 2) / 37;
  let wheelAng = 0, ballAng = -Math.PI / 2, ballR = 272;
  function drawWheel() {
    if (!wx) return;
    wx.clearRect(0, 0, 660, 660);
    const rim = wx.createLinearGradient(0, 0, 660, 660);
    rim.addColorStop(0, "#E9CE86"); rim.addColorStop(0.5, "#B98B2E"); rim.addColorStop(1, "#8C671C");
    wx.fillStyle = rim; wx.beginPath(); wx.arc(CX, CY, R_OUT, 0, 6.2832); wx.fill();
    wx.fillStyle = "#F2EDE1"; wx.beginPath(); wx.arc(CX, CY, R_OUT - 9, 0, 6.2832); wx.fill();
    ORDER.forEach((n, i) => {
      const a0 = -Math.PI / 2 + i * STEP - STEP / 2 + wheelAng;
      wx.beginPath(); wx.moveTo(CX, CY); wx.arc(CX, CY, R_POCK, a0, a0 + STEP); wx.closePath();
      wx.fillStyle = CSS[colorOf(n)]; wx.fill(); wx.strokeStyle = "rgba(242,237,225,.55)"; wx.lineWidth = 1.4; wx.stroke();
    });
    ORDER.forEach((n, i) => {
      const a = -Math.PI / 2 + i * STEP + wheelAng;
      wx.save(); wx.translate(CX + Math.cos(a) * (R_POCK - 34), CY + Math.sin(a) * (R_POCK - 34)); wx.rotate(a + Math.PI / 2);
      wx.fillStyle = "#FCFAF4"; wx.font = '700 26px "Space Mono", monospace'; wx.textAlign = "center"; wx.textBaseline = "middle"; wx.fillText(String(n), 0, 0); wx.restore();
    });
    wx.fillStyle = "#F2EDE1"; wx.beginPath(); wx.arc(CX, CY, R_IN, 0, 6.2832); wx.fill();
    wx.strokeStyle = "#B98B2E"; wx.lineWidth = 4; wx.stroke();
    const hub = wx.createRadialGradient(CX - 22, CY - 26, 6, CX, CY, 74);
    hub.addColorStop(0, "#F0D89C"); hub.addColorStop(1, "#9C7220");
    wx.fillStyle = hub; wx.beginPath(); wx.arc(CX, CY, 74, 0, 6.2832); wx.fill();
    wx.fillStyle = "#0D5843"; wx.beginPath(); wx.arc(CX, CY, 30, 0, 6.2832); wx.fill();
    const bx = CX + Math.cos(ballAng) * ballR, by = CY + Math.sin(ballAng) * ballR;
    wx.save(); wx.shadowColor = "rgba(0,0,0,.45)"; wx.shadowBlur = 12; wx.shadowOffsetY = 4;
    const g = wx.createRadialGradient(bx - 5, by - 6, 1, bx, by, 15); g.addColorStop(0, "#fff"); g.addColorStop(1, "#CFC6B2");
    wx.fillStyle = g; wx.beginPath(); wx.arc(bx, by, 14, 0, 6.2832); wx.fill(); wx.restore();
  }
  drawWheel();
  const rSpin = $("#rSpin");
  if (rSpin) rSpin.onclick = async () => {
    if (spinning || !requireAuth()) return;
    const staked = Object.values(bets).reduce((a, b) => a + b, 0);
    if (!staked) { toast("Put something on the layout first.", "bad"); return; }
    spinning = true; (rSpin as HTMLButtonElement).disabled = true;
    try {
      const betsCents: Record<string, number> = {};
      for (const k in bets) betsCents[k] = bets[k] * 100;
      const r = await api<{ outcome: { index: number; number: number; color: string }; returnCents: number }>(
        "/api/game/rollit", { body: { bets: betsCents }, idem: true }
      );
      const winIdx = r.outcome.index, win = r.outcome.number;
      const startW = wheelAng, startB = ballAng, startR = ballR;
      const endW = startW + Math.PI * 2 * 6 + Math.random() * Math.PI;
      let endB = -Math.PI / 2 + winIdx * STEP + endW;
      while (endB > startB - Math.PI * 2 * 9) endB -= Math.PI * 2;
      const T = 5000, t0 = performance.now(), ease = (x: number) => 1 - Math.pow(1 - x, 3.4);
      await new Promise<void>((res) => {
        (function step(now: number) {
          if (disposed) return res();
          const p = Math.min(1, (now - t0) / T), e = ease(p);
          wheelAng = startW + (endW - startW) * e; ballAng = startB + (endB - startB) * e;
          ballR = startR + (238 - startR) * clamp((p - 0.55) / 0.45, 0, 1);
          drawWheel(); p < 1 ? requestAnimationFrame(step) : res();
        })(t0);
      });
      history.unshift(win); history = history.slice(0, 10);
      $("#lastNums")!.innerHTML = history.map((h) => `<b style="background:${CSS[colorOf(h)]}">${h}</b>`).join("");
      const cell = cellMap["n:" + win];
      if (cell) { cell.classList.add("win"); setTimeout(() => cell.classList.remove("win"), 2400); }
      await wait(250);
      if (r.returnCents > 0) toast(`${win} ${colorOf(win)} — paid ${fmt(r.returnCents / 100)} chips.`, r.returnCents > staked * 100 ? "gold" : "good");
      else toast(`${win} ${colorOf(win)} — the layout takes it.`, "bad");
      clearBets(); await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
    finally { spinning = false; (rSpin as HTMLButtonElement).disabled = false; }
  };

  /* ---------------------------------------------------------------- COIN */
  let side = "H", flipping = false, rot = 0, cstreak: string[] = [];
  function coinReadout() { const cs = $<HTMLInputElement>("#coinStake"); if (cs && $("#coinWin")) $("#coinWin")!.textContent = fmt((+cs.value || 0) * 1.96); }
  $$<HTMLElement>(".pick").forEach((b) => (b.onclick = () => { $$(".pick").forEach((x) => x.classList.remove("on")); b.classList.add("on"); side = b.dataset.side!; }));
  const coinStake = $("#coinStake"); if (coinStake) coinStake.oninput = coinReadout;
  stepper("[data-cstake]", "coinStake");
  const tossBtn = $("#tossBtn");
  if (tossBtn) tossBtn.onclick = async () => {
    if (flipping || !requireAuth()) return;
    const stake = Math.floor(+($("#coinStake") as HTMLInputElement).value || 0);
    if (stake < 1) { toast("Set a stake first.", "bad"); return; }
    flipping = true; (tossBtn as HTMLButtonElement).disabled = true;
    $("#coinMsg")!.textContent = "In the air…"; $("#coinMsg")!.className = "msg";
    try {
      const r = await api<{ outcome: { result: string; win: boolean }; returnCents: number }>(
        "/api/game/coin", { body: { side, stakeCents: stake * 100 }, idem: true }
      );
      const res = r.outcome.result;
      rot += 360 * 7 + (res === "T" ? 180 : 0) - (((rot % 360) + 360) % 360);
      ($("#coin") as HTMLElement).style.transform = `rotateX(${rot}deg)`;
      await wait(2700);
      cstreak.unshift(res); cstreak = cstreak.slice(0, 16);
      $("#streak")!.innerHTML = cstreak.map((s) => `<b style="background:${s === "H" ? "#B98B2E" : "#0D5843"}">${s}</b>`).join("");
      if (r.returnCents > 0) { $("#coinMsg")!.textContent = (res === "H" ? "Heads" : "Tails") + " — you take " + fmt(r.returnCents / 100); $("#coinMsg")!.className = "msg w"; toast("Called it.", "good"); }
      else { $("#coinMsg")!.textContent = (res === "H" ? "Heads" : "Tails") + " — house takes it"; $("#coinMsg")!.className = "msg l"; toast("Wrong call.", "bad"); }
      await refresh();
    } catch (e) { toast((e as Error).message, "bad"); $("#coinMsg")!.textContent = "Call the toss."; }
    finally { flipping = false; (tossBtn as HTMLButtonElement).disabled = false; }
  };

  /* ---------------------------------------------------------------- SLOTS */
  const SLOT_EMOJI: Record<string, string> = {
    cherry: "\u{1F352}", lemon: "\u{1F34B}", bell: "\u{1F514}",
    star: "\u2B50", diamond: "\u{1F48E}", seven: "7\uFE0F\u20E3",
  };
  const SLOT_SYMS = Object.keys(SLOT_EMOJI);
  const randSlotEmoji = () => SLOT_EMOJI[SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)]];
  let spinningSlots = false, slotStreak: boolean[] = [];
  stepper("[data-sstake]", "slotStake");
  const spinBtn = $("#spinBtn");
  if (spinBtn) spinBtn.onclick = async () => {
    if (spinningSlots || !requireAuth()) return;
    const stake = Math.floor(+($("#slotStake") as HTMLInputElement).value || 0);
    if (stake < 1) { toast("Set a stake first.", "bad"); return; }
    const reelEls = [$("#reel0"), $("#reel1"), $("#reel2")] as HTMLElement[];
    if (reelEls.some((e) => !e)) return;
    spinningSlots = true; (spinBtn as HTMLButtonElement).disabled = true;
    $("#slotsMsg")!.textContent = "Spinning\u2026"; $("#slotsMsg")!.className = "msg";
    reelEls.forEach((el) => { el.classList.add("spin"); el.classList.remove("hit"); });
    const shuffle = setInterval(() => {
      reelEls.forEach((el) => { if (el.classList.contains("spin")) el.textContent = randSlotEmoji(); });
    }, 80);
    try {
      const r = await api<{ outcome: { reels: string[]; win: boolean }; returnCents: number }>(
        "/api/game/slots", { body: { stakeCents: stake * 100 }, idem: true }
      );
      const reels = r.outcome.reels;
      await wait(600);
      // Stop reels left-to-right for the classic slots feel.
      for (let i = 0; i < 3; i++) {
        reelEls[i].textContent = SLOT_EMOJI[reels[i]] ?? "?";
        reelEls[i].classList.remove("spin");
        if (i < 2) await wait(420);
      }
      clearInterval(shuffle);
      if (r.returnCents > 0) reelEls.forEach((el) => el.classList.add("hit"));
      slotStreak.unshift(r.returnCents > 0); slotStreak = slotStreak.slice(0, 16);
      $("#slotStreak")!.innerHTML = slotStreak
        .map((w) => `<b style="background:${w ? "#B98B2E" : "#0D5843"}">${w ? "W" : "L"}</b>`)
        .join("");
      if (r.returnCents > 0) {
        $("#slotsMsg")!.textContent = "Paid " + fmt(r.returnCents / 100);
        $("#slotsMsg")!.className = "msg w"; toast("Winner.", "good");
      } else {
        $("#slotsMsg")!.textContent = "No line \u2014 house takes it";
        $("#slotsMsg")!.className = "msg l"; toast("No match.", "bad");
      }
      await refresh();
    } catch (e) {
      reelEls.forEach((el) => el.classList.remove("spin"));
      toast((e as Error).message, "bad"); $("#slotsMsg")!.textContent = "Pull to spin.";
    } finally {
      clearInterval(shuffle); spinningSlots = false; (spinBtn as HTMLButtonElement).disabled = false;
    }
  };

  /* ---------------------------------------------------------------- cards */
  type CardV = { value: number; rank: string; suit: string; color: string } | { hidden: true };
  function cardHTML(c: CardV | undefined): string {
    if (!c || (c as { hidden?: boolean }).hidden) return `<div class="pcard back"></div>`;
    const cc = c as { rank: string; suit: string; color: string };
    return `<div class="pcard ${cc.color}"><div class="rk">${cc.rank}</div><div class="mid">${cc.suit}</div><div class="st">${cc.suit}</div></div>`;
  }

  /* ---------------------------------------------------------------- BLACKJACK */
  type BjProj = { roundId: string; player: CardV[]; dealer: CardV[]; playerScore: number; dealerScore: number; status: string; result: string | null; returnCents?: number; canDouble: boolean; shoeLeft: number };
  let bjRound: string | null = null;
  function bjButtons(live: boolean, canDouble = false) {
    ($("#hitBtn") as HTMLButtonElement).disabled = !live;
    ($("#standBtn") as HTMLButtonElement).disabled = !live;
    ($("#dblBtn") as HTMLButtonElement).disabled = !live || !canDouble;
    ($("#dealBtn") as HTMLButtonElement).disabled = live;
  }
  function renderBj(p: BjProj) {
    $("#pHand")!.innerHTML = p.player.map((c) => cardHTML(c)).join("");
    $("#dHand")!.innerHTML = p.dealer.map((c) => cardHTML(c)).join("");
    $("#pScore")!.textContent = p.player.length ? String(p.playerScore) : "—";
    $("#dScore")!.textContent = p.dealer.length ? String(p.dealerScore) : "—";
    $("#shoeLeft")!.textContent = String(p.shoeLeft);
  }
  function bjMsg(p: BjProj) {
    const m = $("#bjMsg")!;
    if (p.status === "ACTIVE") { m.textContent = "Hit, stand, or double."; m.className = "msg"; return; }
    const r = p.result, w = (p.returnCents ?? 0) / 100;
    if (r === "blackjack") { m.textContent = "Blackjack — pays " + fmt(w); m.className = "msg w"; }
    else if (r === "win") { m.textContent = "You take " + fmt(w); m.className = "msg w"; }
    else if (r === "push") { m.textContent = "Push — stake returned"; m.className = "msg p"; }
    else { m.textContent = "House takes it"; m.className = "msg l"; }
  }
  stepper("[data-bstake]", "bjStake");
  const dealBtn = $("#dealBtn");
  if (dealBtn) dealBtn.onclick = async () => {
    if (!requireAuth()) return;
    const st = Math.floor(+($("#bjStake") as HTMLInputElement).value || 0);
    if (st < 1) { toast("Set a stake first.", "bad"); return; }
    bjButtons(false);
    try {
      const p = await api<BjProj>("/api/game/blackjack/deal", { body: { stakeCents: st * 100 }, idem: true });
      bjRound = p.roundId; renderBj(p); bjMsg(p);
      if (p.status === "ACTIVE") bjButtons(true, p.canDouble); else { bjButtons(false); bjRound = null; await refresh(); }
    } catch (e) { toast((e as Error).message, "bad"); bjButtons(false); }
  };
  async function bjAction(path: string) {
    if (!bjRound) return;
    bjButtons(false);
    try {
      const p = await api<BjProj>(path, { body: { roundId: bjRound } });
      renderBj(p); bjMsg(p);
      if (p.status === "ACTIVE") bjButtons(true, p.canDouble); else { bjButtons(false); bjRound = null; await refresh(); }
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  const hitBtn = $("#hitBtn"); if (hitBtn) hitBtn.onclick = () => bjAction("/api/game/blackjack/hit");
  const standBtn = $("#standBtn"); if (standBtn) standBtn.onclick = () => bjAction("/api/game/blackjack/stand");
  const dblBtn = $("#dblBtn"); if (dblBtn) dblBtn.onclick = () => bjAction("/api/game/blackjack/double");
  bjButtons(false);

  /* ---------------------------------------------------------------- MINES */
  let mMines = 3, mineRound: string | null = null;
  const mineGrid = $("#mineGrid");
  if (mineGrid) for (let i = 0; i < 25; i++) {
    const t = document.createElement("button");
    t.className = "mtile"; t.dataset.i = String(i); t.textContent = "\u2666";
    t.onclick = () => minePick(i, t);
    mineGrid.appendChild(t);
  }
  $$<HTMLElement>("#mineCount button").forEach((b) => (b.onclick = () => {
    if (mineRound) { toast("Finish the round first.", "bad"); return; }
    $$("#mineCount button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); mMines = +b.dataset.m!;
  }));
  stepper("[data-mstake]", "mStake");
  const mStart = $("#mStart");
  if (mStart) mStart.onclick = async () => {
    if (mineRound || !requireAuth()) return;
    const st = Math.floor(+($("#mStake") as HTMLInputElement).value || 0);
    if (st < 1) { toast("Set a stake first.", "bad"); return; }
    try {
      const r = await api<{ roundId: string; nextMultBps: number }>("/api/game/mines/start", { body: { mines: mMines, stakeCents: st * 100 }, idem: true });
      mineRound = r.roundId;
      $$(".mtile").forEach((t) => { t.className = "mtile"; t.textContent = "\u2666"; });
      $("#mMult")!.textContent = "1.00×"; $("#mSub")!.textContent = "Pick a tile to start"; $("#mFound")!.textContent = "0";
      $("#mNext")!.textContent = (r.nextMultBps / 10000).toFixed(2) + "×"; $("#mOdds")!.textContent = "—";
      ($("#mStart") as HTMLButtonElement).disabled = true; ($("#mCash") as HTMLButtonElement).disabled = true;
      await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  async function minePick(i: number, el: HTMLElement) {
    if (!mineRound || el.classList.contains("safe") || el.classList.contains("bomb")) return;
    try {
      const r = await api<{ safe: boolean; done: boolean; safePicks: number; multBps: number; nextMultBps: number | null; returnCents?: number; outcome?: { bombs?: number[] } }>(
        "/api/game/mines/pick", { body: { roundId: mineRound, tile: i } }
      );
      if (!r.safe) {
        el.classList.add("bomb", "done"); el.textContent = "\u2716";
        $("#mSub")!.textContent = "Mine — round over"; $("#mMult")!.textContent = "0.00×";
        revealBombs(r.outcome?.bombs); endMine(); toast("Mine. Chips gone.", "bad"); await refresh(); return;
      }
      el.classList.add("safe", "done"); el.textContent = "\u2666";
      $("#mMult")!.textContent = (r.multBps / 10000).toFixed(2) + "×"; $("#mFound")!.textContent = String(r.safePicks);
      $("#mNext")!.textContent = r.nextMultBps ? (r.nextMultBps / 10000).toFixed(2) + "×" : "—";
      ($("#mCash") as HTMLButtonElement).disabled = false;
      $("#mCash")!.textContent = "Cash out " + fmt((Number(lc()?.me?.chipsCents ?? 0)));
      if (r.done) { $("#mSub")!.textContent = "Field cleared"; revealBombs(r.outcome?.bombs); endMine(); toast("Cleared the field. " + fmt((r.returnCents ?? 0) / 100) + " chips.", "gold"); await refresh(); }
      else $("#mSub")!.textContent = "Cash out or keep turning";
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  function revealBombs(bombs?: number[]) {
    if (!bombs) return;
    $$(".mtile").forEach((t, i) => { if (!t.classList.contains("safe") && !t.classList.contains("bomb")) { t.classList.add("done", "ghost"); t.textContent = bombs.includes(i) ? "\u2716" : "\u2666"; } });
  }
  function endMine() { mineRound = null; ($("#mStart") as HTMLButtonElement).disabled = false; ($("#mCash") as HTMLButtonElement).disabled = true; }
  const mCash = $("#mCash");
  if (mCash) mCash.onclick = async () => {
    if (!mineRound) return;
    try {
      const r = await api<{ returnCents: number; outcome?: { bombs?: number[] } }>("/api/game/mines/cashout", { body: { roundId: mineRound } });
      revealBombs(r.outcome?.bombs); $("#mSub")!.textContent = "Cashed out"; endMine();
      toast("Cashed out " + fmt(r.returnCents / 100) + " chips.", "good"); await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  /* ---------------------------------------------------------------- DICE */
  let rolling = false, dHist: { v: number; w: boolean }[] = [];
  function diceReadout() {
    const tEl = $<HTMLInputElement>("#dTarget"); if (!tEl) return;
    const t = clamp(Math.floor(+tEl.value || 2), 2, 95);
    tEl.value = String(t); ($("#dSlider") as HTMLInputElement).value = String(t);
    ($("#railFill") as HTMLElement).style.width = t + "%";
    $("#dChance")!.textContent = t.toFixed(2) + "%";
    const pay = 98 / t; $("#dPay")!.textContent = pay.toFixed(2) + "×";
    $("#dWin")!.textContent = fmt((+($("#dStake") as HTMLInputElement).value || 0) * pay);
  }
  const dSlider = $("#dSlider"); if (dSlider) dSlider.oninput = () => { ($("#dTarget") as HTMLInputElement).value = (dSlider as HTMLInputElement).value; diceReadout(); };
  const dTarget = $("#dTarget"); if (dTarget) dTarget.oninput = diceReadout;
  const dStake = $("#dStake"); if (dStake) dStake.oninput = diceReadout;
  $$<HTMLElement>("[data-dt]").forEach((b) => (b.onclick = () => { ($("#dTarget") as HTMLInputElement).value = b.dataset.dt!; diceReadout(); }));
  stepper("[data-dstake]", "dStake");
  const rollBtn = $("#rollBtn");
  if (rollBtn) rollBtn.onclick = async () => {
    if (rolling || !requireAuth()) return;
    const t = clamp(Math.floor(+($("#dTarget") as HTMLInputElement).value || 2), 2, 95);
    const stake = Math.floor(+($("#dStake") as HTMLInputElement).value || 0);
    if (stake < 1) { toast("Set a stake first.", "bad"); return; }
    rolling = true; (rollBtn as HTMLButtonElement).disabled = true;
    const out = $("#dOut")!; out.className = "n mono";
    try {
      const r = await api<{ outcome: { roll: number; win: boolean }; returnCents: number }>(
        "/api/game/dice", { body: { target: t, stakeCents: stake * 100 }, idem: true }
      );
      const t0 = performance.now();
      await new Promise<void>((res) => { (function tick(now: number) { if (disposed) return res(); const p = (now - t0) / 800; if (p < 1) { out.textContent = (Math.random() * 100).toFixed(2); requestAnimationFrame(tick); } else res(); })(t0); });
      const roll = r.outcome.roll / 100;
      out.textContent = roll.toFixed(2);
      ($("#dMarker") as HTMLElement).style.left = "calc(" + roll + "% - 1.5px)";
      out.classList.add(r.outcome.win ? "w" : "l");
      dHist.unshift({ v: roll, w: r.outcome.win }); dHist = dHist.slice(0, 12);
      $("#dHist")!.innerHTML = dHist.map((h) => `<b style="background:${h.w ? "#0D5843" : "#C6362A"}">${h.v.toFixed(2)}</b>`).join("");
      if (r.returnCents > 0) { $("#dOutLab")!.textContent = "UNDER " + t + " — PAID " + fmt(r.returnCents / 100); toast("Won " + fmt(r.returnCents / 100) + " chips.", "good"); }
      else { $("#dOutLab")!.textContent = "NEEDED UNDER " + t + " — HOUSE TAKES IT"; toast("House takes it.", "bad"); }
      await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
    finally { rolling = false; (rollBtn as HTMLButtonElement).disabled = false; }
  };

  /* ---------------------------------------------------------------- HI-LO */
  let hiloRound: string | null = null, hTrail: CardV[] = [];
  function renderHiloCard(c: CardV | null) {
    const el = $("#hiloCard")!;
    const cc = c as { rank?: string; suit?: string; color?: string } | null;
    el.className = "bigcard " + (cc?.color ?? "b");
    el.innerHTML = `<div class="rk">${cc?.rank ?? "—"}</div><div class="mid">${cc?.suit ?? "\u2660"}</div><div class="st">${cc?.suit ?? "\u2660"}</div>`;
    void el.offsetWidth; if (c) el.classList.add("flip");
    if (cc && typeof (c as { value?: number }).value === "number") {
      const v = (c as { value: number }).value;
      $("#hiOdds")!.textContent = (0.97 / ((14 - v) / 13)).toFixed(2) + "×";
      $("#loOdds")!.textContent = (0.97 / (v / 13)).toFixed(2) + "×";
    }
  }
  function hiloButtons(live: boolean) {
    ($("#hiBtn") as HTMLButtonElement).disabled = !live;
    ($("#loBtn") as HTMLButtonElement).disabled = !live;
    ($("#hStart") as HTMLButtonElement).disabled = live;
    ($("#hCash") as HTMLButtonElement).disabled = !live;
  }
  stepper("[data-hstake]", "hStake");
  const hStart = $("#hStart");
  if (hStart) hStart.onclick = async () => {
    if (hiloRound || !requireAuth()) return;
    const st = Math.floor(+($("#hStake") as HTMLInputElement).value || 0);
    if (st < 1) { toast("Set a stake first.", "bad"); return; }
    try {
      const r = await api<{ roundId: string; card: CardV; multBps: number }>("/api/game/hilo/start", { body: { stakeCents: st * 100 }, idem: true });
      hiloRound = r.roundId; hTrail = [r.card]; renderHiloCard(r.card);
      $("#hMult")!.textContent = "1.00×"; $("#hCalls")!.textContent = "0"; $("#hiloTrail")!.innerHTML = "";
      $("#hCash")!.textContent = "Take 0";
      const m = $("#hiloMsg")!; m.textContent = "Call the next card."; m.className = "msg";
      hiloButtons(true); ($("#hCash") as HTMLButtonElement).disabled = true;
      await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
  };
  async function hiloCall(dir: "hi" | "lo") {
    if (!hiloRound) return;
    hiloButtons(false);
    try {
      const r = await api<{ card: CardV; won: boolean; done: boolean; multBps: number; calls: number; returnCents?: number }>(
        "/api/game/hilo/call", { body: { roundId: hiloRound, dir } }
      );
      hTrail.push(r.card); hTrail = hTrail.slice(-14); renderHiloCard(r.card);
      $("#hiloTrail")!.innerHTML = hTrail.map((c) => { const cc = c as { rank: string; color: string }; return `<b class="${cc.color}">${cc.rank}</b>`; }).join("");
      $("#hMult")!.textContent = ((r.multBps ?? 10000) / 10000).toFixed(2) + "×"; $("#hCalls")!.textContent = String(r.calls ?? 0);
      const m = $("#hiloMsg")!;
      if (r.done) { m.textContent = "Wrong call — round over"; m.className = "msg l"; hiloRound = null; hiloButtons(false); ($("#hStart") as HTMLButtonElement).disabled = false; toast("Missed it.", "bad"); await refresh(); }
      else { m.textContent = "Correct — running " + ((r.multBps ?? 10000) / 10000).toFixed(2) + "×"; m.className = "msg w"; $("#hCash")!.textContent = "Take " + fmt((Number(lc()?.me?.chipsCents ?? 0))); hiloButtons(true); }
    } catch (e) { toast((e as Error).message, "bad"); hiloButtons(true); }
  }
  const hiBtn = $("#hiBtn"); if (hiBtn) hiBtn.onclick = () => hiloCall("hi");
  const loBtn = $("#loBtn"); if (loBtn) loBtn.onclick = () => hiloCall("lo");
  const hCash = $("#hCash");
  if (hCash) hCash.onclick = async () => {
    if (!hiloRound) return;
    try {
      const r = await api<{ returnCents: number }>("/api/game/hilo/cashout", { body: { roundId: hiloRound } });
      hiloRound = null; hiloButtons(false); ($("#hStart") as HTMLButtonElement).disabled = false;
      const m = $("#hiloMsg")!; m.textContent = "Took " + fmt(r.returnCents / 100); m.className = "msg p";
      toast("Took " + fmt(r.returnCents / 100) + " chips.", "gold"); await refresh();
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  /* ---------------------------------------------------------------- boot */
  diceReadout();
  coinReadout();
  setTimeout(() => { if (!disposed && !authed()) toast("Connect your Robinhood wallet to get chips against collateral."); }, 4000);

  return () => { disposed = true; cleanups.forEach((c) => c()); };
}
