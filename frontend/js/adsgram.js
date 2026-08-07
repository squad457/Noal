/**
 * Wraps Adsgram's SDK (loaded via <script src="https://sad.adsgram.ai/js/sad.min.js">).
 * Docs: https://docs.adsgram.ai
 *
 * The block ID is now fetched from the backend's /api/ads/status endpoint —
 * which reads it from the `settings` table — so changing "Adsgram Block ID"
 * in the admin dashboard takes effect immediately, no code edit or redeploy
 * needed. We cache it after the first successful fetch so we don't need a
 * network round-trip every single time the user taps "Watch Ad".
 */
let AdController = null;
let cachedBlockId = null;

async function getAdController() {
  if (AdController) return AdController;

  if (!cachedBlockId) {
    const status = await Api.adStatus();
    cachedBlockId = status.adsgram_block_id;
  }
  if (!cachedBlockId) {
    throw new Error("Adsgram Block ID isn't set yet — set it in the admin dashboard's Settings tab");
  }
  if (!window.Adsgram) {
    throw new Error("Ad SDK not available");
  }

  AdController = window.Adsgram.init({ blockId: cachedBlockId });
  return AdController;
}

/**
 * Shows a rewarded ad. Resolves with the reward_event id (to send to the backend)
 * or rejects if the user skipped/closed the ad or it failed to load.
 */
async function showRewardedAd() {
  const controller = await getAdController();
  try {
    const result = await controller.show();
    // Adsgram resolves the promise only on a fully-watched, reward-eligible view.
    return result?.reward_event || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch (err) {
    throw new Error(err?.description || "Ad was skipped or failed to load");
  }
}
