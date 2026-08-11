/**
 * Each render_X(state) function returns an HTML string for its tab.
 * `state` is the shared app state object maintained in app.js.
 */

function fmtUsd(n) {
  return `$${Number(n).toFixed(4)}`;
}

// ---------- HOME ----------
function renderHome(state) {
  const { user } = state;
  if (!user) return skeletonBlock();

  const streakDots = Array.from({ length: 7 }, (_, i) => {
    const day = i + 1;
    const cls = day < ((user.streak_count % 7) || 7) || (day <= user.streak_count && user.checked_in_today)
      ? "done"
      : (day === ((user.streak_count % 7) || 7) && !user.checked_in_today ? "today" : "");
    return `<div class="streak-dot ${cls}">${day}</div>`;
  }).join("");

  return `
    <div class="card-feature p-6 mt-2 text-center">
      <span class="pill-chip mb-3">✓ Verified Ledger</span>
      <p class="text-[11px] uppercase tracking-[0.14em] text-gray-500 mt-3">Your Balance</p>
      <h1 class="font-display text-4xl font-bold grad-text mt-1 font-mono">${fmtUsd(user.balance)}</h1>
      <p class="text-xs text-gray-500 mt-2">Lifetime earned&nbsp;<span class="font-mono">${fmtUsd(user.total_earned)}</span></p>
    </div>

    <div class="mt-4 card p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display font-semibold">Daily Streak</h3>
        <span class="text-xs text-violet font-mono font-medium">${user.streak_count} day${user.streak_count === 1 ? "" : "s"}</span>
      </div>
      <div class="flex justify-between gap-1.5 mb-4">${streakDots}</div>
      <button id="btn-checkin" class="w-full btn-primary py-3 text-sm ${user.checked_in_today ? "opacity-40 pointer-events-none" : "pulse"}">
        ${user.checked_in_today ? "✓ Checked in today" : "Claim Daily Reward"}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3 mt-4">
      <button data-goto="earn" class="card p-4 text-left">
        <div class="w-8 h-8 rounded-lg bg-mint/10 border border-mint/40 flex items-center justify-center text-mint text-sm mb-2">▶</div>
        <p class="font-semibold text-sm">Watch &amp; Earn</p>
        <p class="text-xs text-gray-500">Watch ads for USDT</p>
      </button>
      <button data-goto="invite" class="card p-4 text-left">
        <div class="w-8 h-8 rounded-lg bg-violet/10 border border-violet/40 flex items-center justify-center text-violet text-sm mb-2">+</div>
        <p class="font-semibold text-sm">Invite Friends</p>
        <p class="text-xs text-gray-500">Earn commission</p>
      </button>
    </div>
  `;
}

// ---------- EARN ----------
function renderEarn(state) {
  const { adStatus, tasks } = state;

  const adSection = adStatus
    ? `
      <div class="card-feature p-4 flex items-center justify-between">
        <div class="flex items-center gap-3 min-w-0 pr-2">
          <div class="w-9 h-9 rounded-lg bg-mint/10 border border-mint/40 flex items-center justify-center text-mint text-sm shrink-0">▶</div>
          <div class="min-w-0">
            <p class="font-semibold text-xs tracking-wide">Watch Ad for USDT</p>
            <p class="text-[11px] text-violet mt-0.5 font-mono">${fmtUsd(adStatus.reward_per_ad)} <span class="text-gray-500 font-body">• ${adStatus.watched_today}/${adStatus.daily_limit} today</span></p>
          </div>
        </div>
        <button id="btn-watch-ad" class="btn-task shrink-0 ${adStatus.watched_today >= adStatus.daily_limit ? "btn-secondary opacity-40 pointer-events-none" : "btn-primary"} px-3.5 py-2 text-xs font-semibold">
          ${adStatus.watched_today >= adStatus.daily_limit ? "✓ Done" : "Watch"}
        </button>
      </div>
    `
    : skeletonBlock();

  const taskList = tasks
    ? `<div class="card px-4 ">` + tasks.map(t => `
        <div class="row-item">
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm truncate">${t.title}</p>
            <p class="text-xs text-gray-500 truncate">${t.description || ""}</p>
          </div>
          
          <button data-task-id="${t.id}" data-task-url="${t.url}"
            class="btn-task shrink-0 font-mono ${t.completed ? "btn-secondary opacity-40 pointer-events-none" : "btn-primary"} px-4 py-2 text-xs font-semibold">
            ${t.completed ? "✓ Done" : `+${t.reward.toFixed(3)}`}
          </button>
        </div>
      `).join("") + `</div>`
    : skeletonBlock();

  return `
    <div class="mt-1">${adSection}</div>
    <h3 class="font-display font-semibold mt-5 mb-2.5 text-sm uppercase tracking-[0.1em] text-gray-500">Tasks</h3>
    ${tasks && tasks.length === 0 ? emptyState("No tasks right now — check back soon.") : taskList}
  `;
}

// ---------- WALLET ----------
function renderWallet(state) {
  const { user, walletConfig, withdrawals } = state;
  if (!user || !walletConfig) return skeletonBlock();

  const tierButtons = walletConfig.tiers.map(t => `
    <button data-amount="${t}" class="tier-btn card py-3 text-sm font-semibold text-center">$${t}</button>
  `).join("");

  const historyRows = withdrawals
    ? withdrawals.map(w => `
        <div class="row-item">
          <div>
            <p class="text-sm font-medium font-mono">$${w.amount.toFixed(2)}</p>
            <p class="text-xs text-gray-500">${new Date(w.requested_at + "Z").toLocaleDateString()}</p>
          </div>
          ${statusBadge(w.status)}
        </div>
      `).join("")
    : "";

  const selectedMethod = state.selectedMethod || 'binance_pay';
  const isBinance = selectedMethod === 'binance_pay';

  return `
    <div class="card-feature p-5 mt-2 text-center">
      <p class="text-[11px] uppercase tracking-[0.14em] text-gray-500">Available to Withdraw</p>
      <h2 class="font-display text-3xl font-bold mt-1 font-mono">${fmtUsd(user.balance)}</h2>
    </div>

    <div class="card p-5 mt-4">
      <h3 class="font-display font-semibold mb-3">Request Withdrawal</h3>

      <label class="text-xs text-gray-400 mb-1.5 block">Quick Select Amount</label>
      <div class="grid grid-cols-3 gap-2 mb-3" id="tier-buttons">${tierButtons}</div>

      <label class="text-xs text-gray-400 mb-1.5 block">Or Enter Amount (USDT)</label>
      <input id="input-withdraw-amount" type="number" step="0.01" placeholder="e.g. 15.50"
        class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-3 outline-none focus:border-violet/50 font-mono" />

      <label class="text-xs text-gray-400 mb-1.5 block">Select Payout Method</label>
      <div class="grid grid-cols-2 gap-2 mb-3">
        <button data-method="binance_pay" class="method-btn card py-2.5 text-xs font-semibold text-center ${isBinance ? 'border-violet text-violet bg-violet/10' : 'text-gray-400'}">Binance Pay ID</button>
        <button data-method="usdt_address" class="method-btn card py-2.5 text-xs font-semibold text-center ${!isBinance ? 'border-violet text-violet bg-violet/10' : 'text-gray-400'}">USDT (BEP20)</button>
      </div>

      <label class="text-xs text-gray-400 mb-1.5 block" id="payout-label">${isBinance ? 'Enter Binance Pay ID' : 'Enter USDT (BEP20) Wallet Address'}</label>
      <input id="input-payout-id" type="text" placeholder="${isBinance ? 'e.g. 123456789' : 'e.g. 0x...'}"
        value="${user.binance_pay_id || ""}"
        class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-4 outline-none focus:border-violet/50 font-mono" />

      <button id="btn-withdraw" class="w-full btn-primary py-3.5 text-sm">Submit Withdrawal</button>
      <p class="text-xs text-gray-500 mt-2 text-center">Minimum withdrawal: <span class="font-mono">$${walletConfig.min_withdrawal}</span></p>
    </div>

    <div class="card p-5 mt-4">
      <h3 class="font-display font-semibold mb-1">Payout History</h3>
      ${withdrawals && withdrawals.length === 0 ? emptyState("No withdrawals yet.") : `<div class="">${historyRows}</div>`}
    </div>
  `;
}

function statusBadge(status) {
  const map = { pending: "pending", approved: "approved", rejected: "rejected" };
  return `<span class="stamp-badge ${map[status] || "pending"}">${status}</span>`;
}

// ---------- INVITE ----------
function renderInvite(state) {
  const { referral } = state;
  if (!referral) return skeletonBlock();

  const recentRows = referral.recent_referrals.length
    ? `<div class="">` + referral.recent_referrals.map(r => `
        <div class="row-item">
          <p class="text-sm truncate">${r.first_name || "User"} ${r.username ? "@" + r.username : ""}</p>
          
          <p class="text-xs text-violet font-mono shrink-0">+${fmtUsd(r.total_commission)}</p>
        </div>
      `).join("") + `</div>`
    : emptyState("No referrals yet — share your link!");

  return `
    <div class="card-feature p-6 mt-2 text-center">
      <span class="pill-chip mb-3">Referral Program</span>
      <h3 class="font-display font-semibold text-lg mt-3 mb-1">Invite &amp; earn <span class="font-mono">${fmtUsd(referral.referral_fixed_reward)}</span> + ${referral.commission_percent}%</h3>
      <p class="text-sm text-gray-400">Get <span class="font-mono">${fmtUsd(referral.referral_fixed_reward)}</span> per invite, plus ${referral.commission_percent}% commission on their activity.</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mt-4">
      <div class="card p-4 text-center">
        <p class="font-display text-2xl font-bold font-mono">${referral.total_referrals}</p>
        <p class="text-xs text-gray-500 mt-0.5">Referrals</p>
      </div>
      <div class="card p-4 text-center">
        <p class="font-display text-2xl font-bold text-violet font-mono">${fmtUsd(referral.total_commission_earned)}</p>
        <p class="text-xs text-gray-500 mt-0.5">Earned</p>
      </div>
    </div>

    <div class="card p-5 mt-4">
      <label class="text-xs text-gray-400 mb-1.5 block">Your Referral Link</label>
      <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-3">
        <span id="referral-link-text" class="text-xs text-gray-300 truncate flex-1 font-mono">${referral.referral_link}</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button id="btn-copy-link" class="btn-secondary py-3 text-sm font-medium">Copy Link</button>
        <button id="btn-share-link" class="btn-primary py-3 text-sm font-medium">Share</button>
      </div>
    </div>

    <div class="card p-5 mt-4">
      <h3 class="font-display font-semibold mb-1">Recent Referrals</h3>
      ${recentRows}
    </div>
  `;
}

// ---------- helpers ----------
function skeletonBlock() {
  return `
    <div class="mt-2 space-y-3">
      <div class="skeleton h-28 w-full"></div>
      <div class="skeleton h-20 w-full"></div>
    </div>
  `;
}

function emptyState(text) {
  return `<p class="text-sm text-gray-500 text-center py-6">${text}</p>`;
}
