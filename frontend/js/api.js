/**
 * Thin fetch wrapper. Every request carries the raw Telegram initData string
 * in a header so the backend can verify it (see backend/app/auth.py).
 *
 * Set API_BASE to your Railway backend URL after deployment.
 */
const API_BASE = "https://your-backend.up.railway.app"; // <-- replace after deploying to Railway

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || "";

async function apiRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const message = data?.detail || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

const Api = {
  syncUser: () => apiRequest("/api/user/sync"),
  checkin: () => apiRequest("/api/user/checkin", { method: "POST" }),
  transactions: () => apiRequest("/api/user/transactions"),

  adStatus: () => apiRequest("/api/ads/status"),
  claimAdReward: (reward_event) =>
    apiRequest("/api/ads/claim", { method: "POST", body: { reward_event } }),

  listTasks: () => apiRequest("/api/tasks"),
  completeTask: (task_id) =>
    apiRequest("/api/tasks/complete", { method: "POST", body: { task_id } }),

  walletConfig: () => apiRequest("/api/wallet/config"),
  withdraw: (payload) => apiRequest("/api/wallet/withdraw", { method: "POST", body: payload }),
  withdrawalHistory: () => apiRequest("/api/wallet/withdrawals"),

  referralStats: () => apiRequest("/api/referral/stats"),
};
