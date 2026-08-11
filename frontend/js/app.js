/**
 * App bootstrap: tab routing, data fetching, and event delegation.
 * Keeps a single `state` object and re-renders the active tab's HTML on change.
 */
const state = {
  activeTab: "home",
  user: null,
  adStatus: null,
  tasks: null,
  walletConfig: null,
  withdrawals: null,
  referral: null,
};

const views = {
  home: () => document.getElementById("view-home"),
  earn: () => document.getElementById("view-earn"),
  wallet: () => document.getElementById("view-wallet"),
  invite: () => document.getElementById("view-invite"),
};

const renderers = { home: renderHome, earn: renderEarn, wallet: renderWallet, invite: renderInvite };

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className =
    `fixed left-1/2 -translate-x-1/2 bottom-24 z-50 toast-visible card px-5 py-3 text-sm font-medium ` +
    (type === "error" ? "text-red-400" : "text-violet");
  setTimeout(() => { toast.className = "fixed left-1/2 -translate-x-1/2 bottom-24 z-50 hidden"; }, 2500);
}

function renderActiveTab() {
  const el = views[state.activeTab]();
  el.innerHTML = renderers[state.activeTab](state);
}

function switchTab(tab) {
  state.activeTab = tab;
  Object.entries(views).forEach(([name, getEl]) => getEl().classList.toggle("hidden", name !== tab));
  document.querySelectorAll(".nav-btn").forEach(btn =>
    btn.classList.toggle("active-nav", btn.dataset.tab === tab)
  );
  renderActiveTab();
  loadTabData(tab); // lazy-load data the first time a tab is opened, and refresh balances each visit
}

async function loadTabData(tab) {
  try {
    if (tab === "home") {
      state.user = await Api.syncUser();
    } else if (tab === "earn") {
      const [adStatus, tasks] = await Promise.all([Api.adStatus(), Api.listTasks()]);
      state.adStatus = adStatus;
      state.tasks = tasks;
    } else if (tab === "wallet") {
      const [user, walletConfig, withdrawals] = await Promise.all([
        Api.syncUser(), Api.walletConfig(), Api.withdrawalHistory(),
      ]);
      state.user = user;
      state.walletConfig = walletConfig;
      state.withdrawals = withdrawals;
    } else if (tab === "invite") {
      state.referral = await Api.referralStats();
    }
    document.getElementById("streak-count").textContent = state.user?.streak_count ?? 0;
    if (state.user) {
      const avatarEl = document.getElementById("user-avatar");
      const nameEl = document.getElementById("user-name-label");
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (avatarEl) {
        if (tgUser?.photo_url) {
          avatarEl.innerHTML = `<img src="${tgUser.photo_url}" alt="Profile" class="w-full h-full rounded-full object-cover" />`;
        } else {
          avatarEl.textContent = state.user.first_name?.[0]?.toUpperCase() || "U";
        }
      }
      if (nameEl) nameEl.textContent = state.user.first_name || "";
    }
    renderActiveTab();
    const splash = document.getElementById("splash");
    if (splash) setTimeout(() => splash.classList.add("hide"), 400);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---------- Event delegation (handles buttons rendered dynamically) ----------
document.addEventListener("click", async (e) => {
  // Bottom nav + "go to tab" shortcuts
  const navBtn = e.target.closest(".nav-btn");
  if (navBtn) { switchTab(navBtn.dataset.tab); return; }

  const gotoBtn = e.target.closest("[data-goto]");
  if (gotoBtn) { switchTab(gotoBtn.dataset.goto); return; }

  // Daily check-in
  if (e.target.closest("#btn-checkin")) {
    try {
      const res = await Api.checkin();
      showToast(`+${res.reward.toFixed(4)} USDT claimed!`);
      state.user = await Api.syncUser();
      renderActiveTab();
    } catch (err) { showToast(err.message, "error"); }
    return;
  }

  // Watch ad
  if (e.target.closest("#btn-watch-ad")) {
    try {
      const rewardEvent = await showRewardedAd();
      const res = await Api.claimAdReward(rewardEvent);
      showToast(`+${res.reward.toFixed(4)} USDT earned!`);
      state.adStatus = await Api.adStatus();
      state.user = await Api.syncUser();
      renderActiveTab();
    } catch (err) { showToast(err.message, "error"); }
    return;
  }

  // Complete a custom task: open the link, then mark complete
  const taskBtn = e.target.closest(".btn-task");
  if (taskBtn) {
    const taskId = Number(taskBtn.dataset.taskId);
    const url = taskBtn.dataset.taskUrl;
    if (url) tg?.openLink ? tg.openLink(url) : window.open(url, "_blank");
    try {
      const res = await Api.completeTask(taskId);
      showToast(`+${res.reward.toFixed(4)} USDT earned!`);
      state.tasks = await Api.listTasks();
      renderActiveTab();
    } catch (err) { showToast(err.message, "error"); }
    return;
  }

  // Select payout method
  const methodBtn = e.target.closest(".method-btn");
  if (methodBtn) {
    const method = methodBtn.dataset.method;
    state.selectedMethod = method;
    document.querySelectorAll(".method-btn").forEach(b => {
      const active = b === methodBtn;
      b.className = `method-btn card py-2.5 text-xs font-semibold text-center ${active ? 'border-violet text-violet bg-violet/10' : 'text-gray-400'}`;
    });
    const label = document.getElementById("payout-label");
    const input = document.getElementById("input-payout-id");
    if (label && input) {
      if (method === 'binance_pay') {
        label.textContent = "Enter Binance Pay ID";
        input.placeholder = "e.g. 123456789";
      } else {
        label.textContent = "Enter USDT (BEP20) Wallet Address";
        input.placeholder = "e.g. 0x...";
      }
    }
    return;
  }

  // Withdrawal tier selection
  const tierBtn = e.target.closest(".tier-btn");
  if (tierBtn) {
    document.querySelectorAll(".tier-btn").forEach(b => b.classList.remove("card-feature"));
    tierBtn.classList.add("card-feature");
    tierBtn.dataset.selected = "true";
    document.querySelectorAll(".tier-btn").forEach(b => { if (b !== tierBtn) delete b.dataset.selected; });
    const amtInput = document.getElementById("input-withdraw-amount");
    if (amtInput) amtInput.value = tierBtn.dataset.amount;
    return;
  }

  // Submit withdrawal
  if (e.target.closest("#btn-withdraw")) {
    const amtInput = document.getElementById("input-withdraw-amount");
    const selectedTier = document.querySelector(".tier-btn[data-selected='true']");
    const amount = parseFloat(amtInput?.value || selectedTier?.dataset?.amount);
    const payoutId = document.getElementById("input-payout-id").value.trim();
    if (!amount || isNaN(amount) || amount <= 0) { showToast("Enter or select a valid withdrawal amount", "error"); return; }
    if (!payoutId) { showToast("Enter your Binance Pay ID or USDT (BEP20) address", "error"); return; }

    try {
      await Api.withdraw({
        amount: amount,
        method: state.selectedMethod || "binance_pay",
        payout_id: payoutId,
      });
      showToast("Withdrawal submitted!");
      await loadTabData("wallet");
    } catch (err) { showToast(err.message, "error"); }
    return;
  }

  // Copy / share referral link
  if (e.target.closest("#btn-copy-link")) {
    navigator.clipboard?.writeText(state.referral.referral_link);
    showToast("Link copied!");
    return;
  }
  if (e.target.closest("#btn-share-link")) {
    const url = `https://t.me/share/url?url=${encodeURIComponent(state.referral.referral_link)}&text=${encodeURIComponent("Join me and start earning USDT! 💰")}`;
    tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, "_blank");
    return;
  }
});

// ---------- Boot ----------
(function init() {
  const BOT_APP_URL = "https://t.me/UsdtReward1bot/app";

  // If opened outside Telegram (no initData), the API can never authenticate,
  // so loadTabData() will always fail and the splash would spin forever.
  // Stop that here: hide the splash immediately and show a real gate instead
  // of a permanently-frozen loading screen.
  if (!window.Telegram?.WebApp?.initData) {
    document.getElementById("splash")?.classList.add("hide");

    const gate = document.createElement("div");
    gate.className = "fixed inset-0 z-[1000] bg-base flex flex-col items-center justify-center p-6 text-center";
    gate.innerHTML = `
      <div class="brand-mark w-14 h-14 text-xl mb-4">N</div>
      <h2 class="font-display text-lg font-bold mb-2">Open this ledger in Telegram</h2>
      <p class="text-xs text-gray-400 max-w-xs mb-6">Noal runs as a Telegram Mini App and needs Telegram to verify your account. Launch it from the bot below.</p>
      <a href="${BOT_APP_URL}" class="btn-primary px-6 py-3 text-sm font-semibold rounded-xl text-white">Launch in Telegram</a>
    `;
    document.body.appendChild(gate);
    return; // don't attempt to boot the app shell without Telegram context
  }

  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.("#0D0B1A");
  tg?.setBackgroundColor?.("#0D0B1A");

  // Safety net: if something else stalls loadTabData (slow network, backend
  // hiccup), never leave the splash frozen indefinitely.
  setTimeout(() => document.getElementById("splash")?.classList.add("hide"), 6000);

  switchTab("home");
})();
