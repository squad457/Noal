/**
 * Wraps Adsgram's SDK (loaded via <script src="https://sad.adsgram.ai/js/sad.min.js">).
 * Docs: https://docs.adsgram.ai
 *
 * The block ID is fetched from the backend's /api/ads/status endpoint —
 * which reads it from the `settings` table — so changing "Adsgram Block ID"
 * in the admin dashboard takes effect immediately.
 */
let AdController = null;
let cachedBlockId = null;

async function getAdController() {
  const status = await Api.adStatus();
  const blockId = status.adsgram_block_id;

  if (!blockId) {
    throw new Error("Ads are currently unavailable. Please try again later.");
  }
  if (!window.Adsgram) {
    throw new Error("Ad system is not available right now. Please try again.");
  }

  if (!AdController || cachedBlockId !== blockId) {
    cachedBlockId = blockId;
    AdController = window.Adsgram.init({ blockId: cachedBlockId });
  }
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
    throw new Error(err?.description || "Ad was skipped or failed to load. Please try again.");
  }
}
