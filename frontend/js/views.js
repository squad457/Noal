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
    <div class="glass-card p-6 mt-2 text-center border-glow">
      <p class="text-sm text-gray-400 mb-1">Your Balance</p>
      <h1 class="font-display text-4xl font-bold text-glow-green">${fmtUsd(user.balance)}</h1>
      <p class="text-xs text-gray-500 mt-1">Lifetime earned: ${fmtUsd(user.total_earned)}</p>
    </div>

    <div class="glass-card p-5 mt-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display font-semibold">Daily Streak</h3>
        <span class="text-xs text-neon font-medium">${user.streak_count} day${user.streak_count === 1 ? "" : "s"}</span>
      </div>
      <div class="flex justify-between gap-1.5 mb-4">${streakDots}</div>
      <button id="btn-checkin" class="w-full btn-primary py-3 text-sm ${user.checked_in_today ? "opacity-40 pointer-events-none" : "pulse"}">
        ${user.checked_in_today ? "✓ Checked in today" : "Claim Daily Reward"}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3 mt-4">
      <button data-goto="earn" class="glass-card p-4 text-left">
        <p class="text-2xl mb-1">📺</p>
        <p class="font-semibold text-sm">Watch & Earn</p>
        <p class="text-xs text-gray-500">Watch ads for USDT</p>
      </button>
      <button data-goto="invite" class="glass-card p-4 text-left">
        <p class="text-2xl mb-1">👥</p>
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
      <div class="glass-card p-4 flex items-center justify-between border-glow">
        <div class="flex items-center gap-3 min-w-0 pr-3">
          <div class="w-10 h-10 rounded-xl bg-neon/10 flex items-center justify-center text-lg shrink-0">🎬</div>
          <div class="min-w-0">
            <p class="font-semibold text-sm truncate">Watch Ad</p>
            <p class="text-xs text-neon">${fmtUsd(adStatus.reward_per_ad)} <span class="text-gray-500">• ${adStatus.watched_today}/${adStatus.daily_limit} done</span></p>
          </div>
        </div>
        <button id="btn-watch-ad" class="btn-task shrink-0 ${adStatus.watched_today >= adStatus.daily_limit ? "btn-secondary opacity-40 pointer-events-none" : "btn-primary"} px-4 py-2 text-xs font-semibold">
          ${adStatus.watched_today >= adStatus.daily_limit ? "✓ Limit" : "▶ Watch"}
        </button>
      </div>
    `
    : skeletonBlock();

  const taskList = tasks
    ? tasks.map(t => `
        <div class="glass-card p-4 flex items-center justify-between">
          <div class="flex-1 min-w-0 pr-3">
            <p class="font-semibold text-sm truncate">${t.title}</p>
            <p class="text-xs text-gray-500 truncate">${t.description || ""}</p>
          </div>
          <button data-task-id="${t.id}" data-task-url="${t.url}"
            class="btn-task shrink-0 ${t.completed ? "btn-secondary opacity-40 pointer-events-none" : "btn-primary"} px-4 py-2 text-xs font-semibold">
            ${t.completed ? "✓ Done" : `+${t.reward.toFixed(3)}`}
          </button>
        </div>
      `).join("")
    : skeletonBlock();

  return `
    <div class="mt-2">${adSection}</div>
    <h3 class="font-display font-semibold mt-5 mb-3">Task</h3>
    <div class="space-y-2.5">${tasks && tasks.length === 0 ? emptyState("No tasks right now — check back soon.") : taskList}</div>
  `;
}

// ---------- WALLET ----------
function renderWallet(state) {
  const { user, walletConfig, withdrawals } = state;
  if (!user || !walletConfig) return skeletonBlock();

  const tierButtons = walletConfig.tiers.map(t => `
    <button data-amount="${t}" class="tier-btn glass-card py-3 text-sm font-semibold text-center">$${t}</button>
  `).join("");

  const historyRows = withdrawals
    ? withdrawals.map(w => `
        <div class="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
          <div>
            <p class="text-sm font-medium">$${w.amount.toFixed(2)}</p>
            <p class="text-xs text-gray-500">${new Date(w.requested_at + "Z").toLocaleDateString()}</p>
          </div>
          ${statusBadge(w.status)}
        </div>
      `).join("")
    : "";

  return `
    <div class="glass-card p-5 mt-2 text-center">
      <p class="text-sm text-gray-400">Available to Withdraw</p>
      <h2 class="font-display text-3xl font-bold mt-1">${fmtUsd(user.balance)}</h2>
    </div>

    <div class="glass-card p-5 mt-4">
      <h3 class="font-display font-semibold mb-3">Request Withdrawal</h3>

      <label class="text-xs text-gray-400 mb-1.5 block">Quick Select Amount</label>
      <div class="grid grid-cols-3 gap-2 mb-3" id="tier-buttons">${tierButtons}</div>

      <label class="text-xs text-gray-400 mb-1.5 block">Or Enter Amount (USDT)</label>
      <input id="input-withdraw-amount" type="number" step="0.01" placeholder="e.g. 15.50"
        class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-3 outline-none focus:border-neon/50" />

      <label class="text-xs text-gray-400 mb-1.5 block">Binance Pay ID or USDT Wallet Address</label>
      <input id="input-payout-id" type="text" placeholder="e.g. 123456789"
        value="${user.binance_pay_id || ""}"
        class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-4 outline-none focus:border-neon/50" />

      <button id="btn-withdraw" class="w-full btn-primary py-3.5 text-sm">Submit Withdrawal</button>
      <p class="text-xs text-gray-500 mt-2 text-center">Minimum withdrawal: $${walletConfig.min_withdrawal}</p>
    </div>

    <div class="glass-card p-5 mt-4">
      <h3 class="font-display font-semibold mb-2">Payout History</h3>
      ${withdrawals && withdrawals.length === 0 ? emptyState("No withdrawals yet.") : historyRows}
    </div>
  `;
}

function statusBadge(status) {
  const map = {
    pending: "bg-yellow-500/15 text-yellow-400",
    approved: "bg-neon/15 text-neon",
    rejected: "bg-red-500/15 text-red-400",
  };
  return `<span class="text-xs font-medium px-2.5 py-1 rounded-full ${map[status] || ""}">${status}</span>`;
}

// ---------- INVITE ----------
function renderInvite(state) {
  const { referral } = state;
  if (!referral) return skeletonBlock();

  const recentRows = referral.recent_referrals.length
    ? referral.recent_referrals.map(r => `
        <div class="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
          <p class="text-sm">${r.first_name || "User"} ${r.username ? "@" + r.username : ""}</p>
          <p class="text-xs text-neon">+${fmtUsd(r.total_commission)}</p>
        </div>
      `).join("")
    : emptyState("No referrals yet — share your link!");

  return `
    <div class="glass-card p-6 mt-2 text-center border-glow">
      <p class="text-3xl mb-2">🎁</p>
      <h3 class="font-display font-semibold text-lg mb-1">Invite & Earn ${fmtUsd(referral.referral_fixed_reward)} + ${referral.commission_percent}%</h3>
      <p class="text-sm text-gray-400">Get ${fmtUsd(referral.referral_fixed_reward)} per invite + earn ${referral.commission_percent}% commission on their activity!</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mt-4">
      <div class="glass-card p-4 text-center">
        <p class="font-display text-2xl font-bold">${referral.total_referrals}</p>
        <p class="text-xs text-gray-500">Referrals</p>
      </div>
      <div class="glass-card p-4 text-center">
        <p class="font-display text-2xl font-bold text-neon">${fmtUsd(referral.total_commission_earned)}</p>
        <p class="text-xs text-gray-500">Earned</p>
      </div>
    </div>

    <div class="glass-card p-5 mt-4">
      <label class="text-xs text-gray-400 mb-1.5 block">Your Referral Link</label>
      <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-3">
        <span id="referral-link-text" class="text-xs text-gray-300 truncate flex-1">${referral.referral_link}</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button id="btn-copy-link" class="btn-secondary py-3 text-sm font-medium">📋 Copy Link</button>
        <button id="btn-share-link" class="btn-primary py-3 text-sm font-medium">↗ Share</button>
      </div>
    </div>

    <div class="glass-card p-5 mt-4">
      <h3 class="font-display font-semibold mb-2">Recent Referrals</h3>
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
