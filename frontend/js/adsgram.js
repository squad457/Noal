/**
 * Wraps Adsgram's SDK (loaded via <script src="https://sad.adsgram.ai/js/sad.min.js">).
 * Docs: https://docs.adsgram.ai
 *
 * The block ID (and debug flag) are fetched from the backend's /api/ads/status
 * endpoint — which reads them from the `settings` table — so changing them in
 * the admin dashboard takes effect immediately without a redeploy.
 *
 * IMPORTANT — why ads used to get rejected / show 0 conversions:
 * 1. Adsgram's client SDK resolves `AdController.show()` with
 *    `{ done, description, state }` — there is NO `reward_event` field in that
 *    result. Relying on it (as the old code did) silently always fell through
 *    to a locally-generated id. That's fine for unlocking things client-side,
 *    but it is NOT proof a real ad was served — the actual proof has to come
 *    from Adsgram's server-to-server Reward URL (see backend/app/routers/ads.py,
 *    GET /api/ads/p). Make sure that URL is configured in your Adsgram block.
 * 2. Debug/test mode ad views are excluded from Adsgram's own stats AND never
 *    trigger the Reward URL — leaving `adsgram_debug` on anywhere in production
 *    will always look like "0 real traffic" no matter how many times you test.
 */
let AdController = null;
let cachedBlockId = null;
let cachedDebug = null;

function log(...args) {
  console.log("[Adsgram]", ...args);
}

async function getAdController() {
  const status = await Api.adStatus();
  const blockId = status.adsgram_block_id;
  const debug = !!status.adsgram_debug;

  if (!blockId) {
    throw new Error("Ads are currently unavailable. Please try again later.");
  }
  if (!window.Adsgram || typeof window.Adsgram.init !== "function") {
    throw new Error("Ad system failed to load. Check your connection and try again.");
  }

  if (debug) {
    log("WARNING: adsgram_debug is ON — this ad view will NOT count toward Adsgram's real stats and will NOT trigger the Reward URL. Turn this off in the admin dashboard before going live.");
  }

  if (!AdController || cachedBlockId !== blockId || cachedDebug !== debug) {
    cachedBlockId = blockId;
    cachedDebug = debug;
    AdController = window.Adsgram.init({ blockId: cachedBlockId, debug: cachedDebug });
    log("Initialized controller for block", cachedBlockId, "debug:", cachedDebug);
  }
  return AdController;
}

/**
 * Shows a rewarded ad. Resolves with a locally-generated view id (for the
 * client-reported ad-claim and game-play fallback paths) or
 * rejects if the user skipped/closed the ad, it failed to load, or there was
 * no fill (no ad available for this user/region right now).
 */
async function showRewardedAd() {
  const controller = await getAdController();
  try {
    const result = await controller.show();
    log("Ad completed:", result);
    // No reward_event exists on Adsgram's client result — this id is only used
    // to satisfy our own UNIQUE-constraint dedupe on the client-reported path.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch (err) {
    log("Ad not completed:", err);
    const description = err?.description || err?.message || (typeof err === "string" ? err : null);
    if (description && /no.?fill|not available|no ad/i.test(description)) {
      throw new Error("No ads available right now. Please try again in a bit.");
    }
    throw new Error(description ? `Ad error: ${description}` : "Ad was skipped or failed to load. Please try again.");
  }
}
