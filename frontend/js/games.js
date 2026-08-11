/**
 * Spin Wheel + Scratch Card UI. Reward amounts always come from the backend
 * (drawn from the admin's configured range) — everything drawn here (wheel
 * rotation, which segment it visually stops on, scratch reveal) is cosmetic
 * animation built around the server's response, never a source of truth.
 */
// Curated, professional palette — deep violet/indigo family with a single warm
// gold accent segment, echoing recognizable exchange-app wheels (Binance etc.)
// instead of a clashing full rainbow.
const WHEEL_COLORS = ["#7C3AED", "#4C1D95", "#8B5CF6", "#5B21B6", "#6D28D9", "#4338CA", "#9333EA", "#3730A3"];
const WHEEL_ACCENT_COLOR = "#F0B90B"; // single gold "jackpot" slice for visual anchor, Binance-style

let wheelRotation = 0;
let wheelSpinning = false;
let scratchBusy = false;
// A scratch round the server has already resolved, waiting for the player
// to tap cells to reveal it. Null when no round is in progress.
let scratchPending = null; // { reward, winningCells: Set<number> }
let scratchRevealed = new Set();

function fmtUsdG(n) { return `$${Number(n).toFixed(4)}`; }

// ---------- SPIN WHEEL ----------
function renderSpinWheel(spinStatus) {
  if (!spinStatus) return `<div class="skeleton h-72 w-full"></div>`;
  const segments = spinStatus.segments && spinStatus.segments.length ? spinStatus.segments : [0];
  const n = segments.length;
  const slice = 360 / n;

  const gradientStops = segments.map((val, i) => {
    const isJackpot = val === Math.max(...segments);
    const color = isJackpot ? WHEEL_ACCENT_COLOR : WHEEL_COLORS[i % WHEEL_COLORS.length];
    return `${color} ${i * slice}deg ${(i + 1) * slice}deg`;
  }).join(", ");

  const labels = segments.map((val, i) => {
    const angle = i * slice + slice / 2;
    return `<div class="wheel-label" style="transform: rotate(${angle}deg) translateY(-98px) rotate(${-angle}deg);">${fmtUsdG(val)}</div>`;
  }).join("");

  // Thin divider spokes at each segment boundary so slices read as distinct wedges.
  const spokes = segments.map((_, i) =>
    `<div class="wheel-spoke" style="transform: rotate(${i * slice}deg);"></div>`
  ).join("");

  const canPlayFree = spinStatus.free_spins_left > 0;
  const blocked = spinStatus.max_reached || (!canPlayFree && !spinStatus.needs_ad && spinStatus.cooldown_remaining > 0);
  const btnLabel = spinStatus.max_reached
    ? "Come back tomorrow"
    : spinStatus.cooldown_remaining > 0
      ? `Wait ${spinStatus.cooldown_remaining}s…`
      : canPlayFree
        ? `Spin (${spinStatus.free_spins_left} free left)`
        : spinStatus.needs_ad
          ? "▶ Watch Ad to Spin"
          : "Spin";

  return `
    <div class="card-feature p-5 pt-6 mt-2 text-center">
      <span class="pill-chip mb-2.5">🎡 Spin Wheel</span>
      <p class="text-xs text-gray-400 mb-5 px-2">Every spin wins a random USDT reward — good luck!</p>
      <div class="wheel-wrap">
        <div class="wheel-pointer"></div>
        <div id="spin-wheel" class="wheel" style="background: conic-gradient(${gradientStops}); transform: rotate(${wheelRotation}deg);">
          ${spokes}
          ${labels}
        </div>
        <div class="wheel-hub">🎯</div>
      </div>
      <button id="btn-spin-wheel" class="w-full btn-primary py-3.5 text-sm mt-6 ${blocked || wheelSpinning ? "opacity-40 pointer-events-none" : ""}">
        ${wheelSpinning ? "Spinning…" : btnLabel}
      </button>
      <p class="text-[11px] text-gray-500 mt-2">${spinStatus.played_today} played today${spinStatus.max_daily_spins ? ` · max ${spinStatus.max_daily_spins}/day` : ""}</p>
    </div>
  `;
}

async function handleSpinClick() {
  if (wheelSpinning) return;
  const s = state.spinStatus;
  if (!s || s.max_reached) return;

  try {
    let adEvent = null;
    if (s.free_spins_left <= 0 && s.needs_ad) {
      adEvent = await showRewardedAd();
    }
    wheelSpinning = true;
    renderActiveTab();

    const res = await Api.spinPlay(adEvent);

    const segments = res.segments;
    const n = segments.length;
    const slice = 360 / n;
    // The pointer is fixed at the top (0deg). To land the chosen segment there,
    // the wheel's *normalized* rotation must end at (360 - segmentCenterAngle).
    // Rotation is cumulative (never reset to a small absolute value) — always
    // spin forward several full turns from wherever the wheel currently sits,
    // so every spin feels powerful and never looks like a short backward flick.
    const segmentCenterAngle = res.landed_index * slice + slice / 2;
    const desiredNormalized = (360 - segmentCenterAngle + 360) % 360;
    const currentNormalized = ((wheelRotation % 360) + 360) % 360;
    let forwardDelta = desiredNormalized - currentNormalized;
    if (forwardDelta <= 0) forwardDelta += 360;
    const EXTRA_FULL_TURNS = 7;
    wheelRotation += forwardDelta + 360 * EXTRA_FULL_TURNS;

    const wheelEl = document.getElementById("spin-wheel");
    if (wheelEl) {
      wheelEl.style.transition = "transform 3.6s cubic-bezier(0.11, 0.82, 0.1, 1)";
      wheelEl.style.transform = `rotate(${wheelRotation}deg)`;
    }

    setTimeout(async () => {
      wheelSpinning = false;
      showToast(`🎉 You won ${res.reward.toFixed(4)} USDT!`);
      state.user = await Api.syncUser();
      state.spinStatus = await Api.spinStatus();
      renderActiveTab();
    }, 3700);
  } catch (err) {
    wheelSpinning = false;
    renderActiveTab();
    showToast(err.message, "error");
  }
}

// ---------- SCRATCH CARD ----------
// Cards are tappable: pressing the button resolves the round with the server,
// then the player scratches individual cells to reveal it — matching 3
// diamonds finishes the round early (the reward is already locked in either way).
function renderScratchCard(scratchStatus) {
  if (!scratchStatus) return `<div class="skeleton h-56 w-full mt-4"></div>`;

  const canPlayFree = scratchStatus.free_plays_left > 0;
  const inRound = !!scratchPending;
  // The exact count for the active round comes from the server's play response;
  // before a round starts we show the admin-configured default from status.
  const neededCount = inRound ? scratchPending.winningCells.size : (scratchStatus.winning_cells_needed || 3);
  const btnLabel = inRound
    ? "Tap the cards to reveal 👆"
    : scratchStatus.max_reached
      ? "Come back tomorrow"
      : canPlayFree
        ? `Scratch (${scratchStatus.free_plays_left} free left)`
        : scratchStatus.needs_ad
          ? "▶ Watch Ad to Scratch"
          : "Scratch";
  const blocked = scratchStatus.max_reached && !inRound;

  const cells = Array.from({ length: 9 }, (_, i) => {
    const revealed = scratchRevealed.has(i);
    const isWin = inRound && scratchPending.winningCells.has(i) && revealed;
    const symbol = revealed ? (isWin ? "💎" : "✖") : "❓";
    const cls = ["scratch-cell", revealed ? "revealed" : "", isWin ? "win" : "", inRound && !revealed ? "armed" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-cell="${i}"><span>${symbol}</span></div>`;
  }).join("");

  return `
    <div class="card-feature p-5 mt-4 text-center">
      <span class="pill-chip mb-3">🎫 Scratch &amp; Win</span>
      <p class="text-xs text-gray-400 mb-4">Match ${neededCount} diamond${neededCount === 1 ? "" : "s"} to reveal your prize.</p>
      <div id="scratch-grid" class="scratch-grid">${cells}</div>
      <button id="btn-scratch-play" class="w-full btn-primary py-3.5 text-sm mt-5 ${blocked || scratchBusy || inRound ? "opacity-40 pointer-events-none" : ""}">
        ${scratchBusy ? "Revealing…" : btnLabel}
      </button>
      <p class="text-[11px] text-gray-500 mt-2">${scratchStatus.played_today} played today${scratchStatus.max_daily ? ` · max ${scratchStatus.max_daily}/day` : ""}</p>
    </div>
  `;
}

async function handleScratchClick() {
  if (scratchBusy || scratchPending) return;
  const s = state.scratchStatus;
  if (!s || s.max_reached) return;

  try {
    let adEvent = null;
    if (s.free_plays_left <= 0 && s.needs_ad) {
      adEvent = await showRewardedAd();
    }
    scratchBusy = true;
    renderActiveTab();

    const res = await Api.scratchPlay(adEvent);
    scratchRevealed = new Set();
    scratchPending = { reward: res.reward, winningCells: new Set(res.winning_cells) };
    scratchBusy = false;
    renderActiveTab();
  } catch (err) {
    scratchBusy = false;
    renderActiveTab();
    showToast(err.message, "error");
  }
}

async function handleScratchCellTap(index) {
  if (!scratchPending || scratchRevealed.has(index)) return;

  scratchRevealed.add(index);
  const needed = scratchPending.winningCells.size;
  const foundDiamonds = [...scratchRevealed].filter((i) => scratchPending.winningCells.has(i)).length;
  renderActiveTab();

  // Finish the round once the admin-configured number of diamonds is found
  // (or every cell has been tapped, whichever comes first).
  if (foundDiamonds >= needed || scratchRevealed.size >= 9) {
    const reward = scratchPending.reward;
    setTimeout(async () => {
      // Flash-reveal any cells the player didn't get to.
      for (let i = 0; i < 9; i++) scratchRevealed.add(i);
      renderActiveTab();
      setTimeout(async () => {
        scratchPending = null;
        scratchRevealed = new Set();
        showToast(`🎉 You won ${reward.toFixed(4)} USDT!`);
        state.user = await Api.syncUser();
        state.scratchStatus = await Api.scratchStatus();
        renderActiveTab();
      }, 500);
    }, 350);
  }
}
