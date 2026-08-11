/**
 * Spin Wheel + Scratch Card UI. Reward amounts always come from the backend
 * (drawn from the admin's configured range) — everything drawn here (wheel
 * rotation, which segment it visually stops on, scratch reveal) is cosmetic
 * animation built around the server's response, never a source of truth.
 */
const WHEEL_COLORS = ["#8B5CF6", "#EC4899", "#3DDC97", "#F59E0B", "#6366F1", "#F472B6", "#22D3EE", "#A3E635"];

let wheelRotation = 0;
let wheelSpinning = false;
let scratchBusy = false;

function fmtUsdG(n) { return `$${Number(n).toFixed(4)}`; }

// ---------- SPIN WHEEL ----------
function renderSpinWheel(spinStatus) {
  if (!spinStatus) return `<div class="skeleton h-72 w-full"></div>`;
  const segments = spinStatus.segments && spinStatus.segments.length ? spinStatus.segments : [0];
  const n = segments.length;
  const slice = 360 / n;

  const gradientStops = segments.map((_, i) =>
    `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * slice}deg ${(i + 1) * slice}deg`
  ).join(", ");

  const labels = segments.map((val, i) => {
    const angle = i * slice + slice / 2;
    return `<div class="wheel-label" style="transform: rotate(${angle}deg) translateY(-92px) rotate(${-angle}deg);">${fmtUsdG(val)}</div>`;
  }).join("");

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
    <div class="card-feature p-5 mt-2 text-center">
      <span class="pill-chip mb-3">🎡 Spin Wheel</span>
      <p class="text-xs text-gray-400 mb-4">Every spin wins a random USDT reward — good luck!</p>
      <div class="wheel-wrap">
        <div class="wheel-pointer">▼</div>
        <div id="spin-wheel" class="wheel" style="background: conic-gradient(${gradientStops}); transform: rotate(${wheelRotation}deg);">
          ${labels}
        </div>
      </div>
      <button id="btn-spin-wheel" class="w-full btn-primary py-3.5 text-sm mt-5 ${blocked || wheelSpinning ? "opacity-40 pointer-events-none" : ""}">
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
    // Land the pointer (fixed at top / 0deg) on the center of the chosen segment,
    // plus several full extra turns so the spin animation feels satisfying.
    const targetAngle = 360 * 6 - (res.landed_index * slice + slice / 2);
    wheelRotation = targetAngle;

    const wheelEl = document.getElementById("spin-wheel");
    if (wheelEl) {
      wheelEl.style.transition = "transform 3.2s cubic-bezier(0.17, 0.67, 0.12, 0.99)";
      wheelEl.style.transform = `rotate(${wheelRotation}deg)`;
    }

    setTimeout(async () => {
      wheelSpinning = false;
      showToast(`🎉 You won ${res.reward.toFixed(4)} USDT!`);
      state.user = await Api.syncUser();
      state.spinStatus = await Api.spinStatus();
      renderActiveTab();
    }, 3300);
  } catch (err) {
    wheelSpinning = false;
    renderActiveTab();
    showToast(err.message, "error");
  }
}

// ---------- SCRATCH CARD ----------
function renderScratchCard(scratchStatus) {
  if (!scratchStatus) return `<div class="skeleton h-56 w-full mt-4"></div>`;

  const canPlayFree = scratchStatus.free_plays_left > 0;
  const btnLabel = scratchStatus.max_reached
    ? "Come back tomorrow"
    : canPlayFree
      ? `Scratch (${scratchStatus.free_plays_left} free left)`
      : scratchStatus.needs_ad
        ? "▶ Watch Ad to Scratch"
        : "Scratch";
  const blocked = scratchStatus.max_reached;

  const cells = Array.from({ length: 9 }, (_, i) =>
    `<div class="scratch-cell" data-cell="${i}"><span>❓</span></div>`
  ).join("");

  return `
    <div class="card-feature p-5 mt-4 text-center">
      <span class="pill-chip mb-3">🎫 Scratch &amp; Win</span>
      <p class="text-xs text-gray-400 mb-4">Match 3 diamonds to reveal your prize.</p>
      <div id="scratch-grid" class="scratch-grid">${cells}</div>
      <button id="btn-scratch-play" class="w-full btn-primary py-3.5 text-sm mt-5 ${blocked || scratchBusy ? "opacity-40 pointer-events-none" : ""}">
        ${scratchBusy ? "Revealing…" : btnLabel}
      </button>
      <p class="text-[11px] text-gray-500 mt-2">${scratchStatus.played_today} played today${scratchStatus.max_daily ? ` · max ${scratchStatus.max_daily}/day` : ""}</p>
    </div>
  `;
}

async function handleScratchClick() {
  if (scratchBusy) return;
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
    const cells = document.querySelectorAll("#scratch-grid .scratch-cell");
    const winningSet = new Set(res.winning_cells);

    cells.forEach((cell, i) => {
      setTimeout(() => {
        cell.classList.add("revealed");
        cell.querySelector("span").textContent = winningSet.has(i) ? "💎" : "✖";
        if (winningSet.has(i)) cell.classList.add("win");
      }, i * 90);
    });

    setTimeout(async () => {
      scratchBusy = false;
      showToast(`🎉 You won ${res.reward.toFixed(4)} USDT!`);
      state.user = await Api.syncUser();
      state.scratchStatus = await Api.scratchStatus();
      renderActiveTab();
    }, cells.length * 90 + 500);
  } catch (err) {
    scratchBusy = false;
    renderActiveTab();
    showToast(err.message, "error");
  }
}
