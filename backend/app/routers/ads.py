"""
Adsgram integration.

Two ways Adsgram can confirm a reward — this router supports both so you can
pick whichever your Adsgram dashboard is configured for:

1. SERVER-TO-SERVER POSTBACK (recommended, harder to spoof):
   Adsgram's ad server calls `GET /api/ads/postback` directly with the viewer's
   telegram_id and a signature. The Mini App frontend is never trusted to report
   the reward itself. Configure this URL in Adsgram dashboard -> your block -> Postback URL.

2. CLIENT-REPORTED (fallback, used here with extra guards):
   The frontend's Adsgram SDK fires `onReward`, then calls `POST /api/ads/claim`
   with the event id Adsgram gave it. We still enforce a daily limit, a cooldown
   between claims, and a UNIQUE constraint on reward_event so the same ad view
   can never be credited twice.

All economy numbers (reward amount, daily limit, cooldown, ads on/off) come from
the `settings` table so the admin dashboard can tune them live, with config.py
values used only as the first-boot defaults.
"""
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.config import settings as env_settings
from app.database import get_db, get_settings
from app.models import AdRewardPayload

router = APIRouter(prefix="/api/ads", tags=["ads"])


async def _credit_ad_reward(db, telegram_id: int, reward_event: str) -> tuple[float, float]:
    """Shared logic: check limits, insert ad_event, credit balance. Returns (reward, new_balance)."""
    cfg = await get_settings(db)
    if not cfg["ads_enabled"]:
        raise HTTPException(status_code=403, detail="Ads are currently disabled")

    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=24)).isoformat()

    count_cursor = await db.execute(
        "SELECT COUNT(*) as c FROM ad_events WHERE telegram_id = ? AND created_at >= ?",
        (telegram_id, since),
    )
    count_row = await count_cursor.fetchone()
    if count_row["c"] >= cfg["ad_daily_limit"]:
        raise HTTPException(status_code=429, detail="Daily ad limit reached, come back tomorrow")

    last_cursor = await db.execute(
        "SELECT created_at FROM ad_events WHERE telegram_id = ? ORDER BY id DESC LIMIT 1",
        (telegram_id,),
    )
    last_row = await last_cursor.fetchone()
    if last_row:
        last_time = datetime.fromisoformat(last_row["created_at"]).replace(tzinfo=timezone.utc)
        if (now - last_time).total_seconds() < cfg["ad_cooldown_seconds"]:
            raise HTTPException(status_code=429, detail="Please wait before watching another ad")

    reward = cfg["ad_reward_usdt"]

    try:
        await db.execute(
            "INSERT INTO ad_events (telegram_id, reward_event, amount) VALUES (?, ?, ?)",
            (telegram_id, reward_event, reward),
        )
    except Exception:
        # UNIQUE constraint on reward_event -> this exact ad view was already credited
        raise HTTPException(status_code=409, detail="This ad view was already rewarded")

    user_cursor = await db.execute("SELECT balance FROM users WHERE telegram_id = ?", (telegram_id,))
    current_balance = (await user_cursor.fetchone())["balance"]
    new_balance = current_balance + reward

    await db.execute(
        "UPDATE users SET balance = ?, total_earned = total_earned + ? WHERE telegram_id = ?",
        (new_balance, reward, telegram_id),
    )
    await db.execute(
        """INSERT INTO transactions (telegram_id, type, amount, balance_after, meta)
           VALUES (?, 'ad_reward', ?, ?, ?)""",
        (telegram_id, reward, new_balance, json.dumps({"reward_event": reward_event})),
    )
    await _pay_referral_commission(db, telegram_id, reward, cfg["referral_commission_percent"])
    return reward, new_balance


async def _pay_referral_commission(db, telegram_id: int, base_amount: float, commission_percent: float):
    """If this user was referred, credit the referrer their commission percentage."""
    ref_cursor = await db.execute("SELECT referred_by FROM users WHERE telegram_id = ?", (telegram_id,))
    row = await ref_cursor.fetchone()
    if not row or not row["referred_by"]:
        return
    referrer_id = row["referred_by"]
    commission = round(base_amount * commission_percent / 100, 6)
    if commission <= 0:
        return

    ref_balance_cursor = await db.execute("SELECT balance FROM users WHERE telegram_id = ?", (referrer_id,))
    ref_row = await ref_balance_cursor.fetchone()
    if not ref_row:
        return
    new_ref_balance = ref_row["balance"] + commission

    await db.execute(
        "UPDATE users SET balance = ?, total_earned = total_earned + ? WHERE telegram_id = ?",
        (new_ref_balance, commission, referrer_id),
    )
    await db.execute(
        """INSERT INTO transactions (telegram_id, type, amount, balance_after, meta)
           VALUES (?, 'referral_commission', ?, ?, ?)""",
        (referrer_id, commission, new_ref_balance, json.dumps({"from_user": telegram_id})),
    )
    await db.execute(
        "UPDATE referrals SET total_commission = total_commission + ? WHERE referrer_id = ? AND referred_id = ?",
        (commission, referrer_id, telegram_id),
    )


@router.post("/claim")
async def claim_ad_reward(payload: AdRewardPayload, user: dict = Depends(get_current_user)):
    """Client-reported path — called from the frontend right after Adsgram's onReward fires."""
    async with get_db() as db:
        reward, new_balance = await _credit_ad_reward(db, user["telegram_id"], payload.reward_event)
        await db.commit()
    return {"reward": reward, "new_balance": round(new_balance, 4)}


@router.get("/postback")
async def adsgram_postback(
    userid: int = Query(..., description="telegram_id, passed back by Adsgram from the SDK init"),
    reward_event: str = Query(...),
    signature: str = Query(..., description="HMAC-SHA256 of 'userid:reward_event' using ADSGRAM_CALLBACK_SECRET"),
):
    """
    Server-to-server path — set this as your Postback URL in the Adsgram dashboard:
    https://your-backend.up.railway.app/api/ads/postback?userid={telegram_id}&reward_event={event_id}&signature={sig}
    (exact query param names depend on your Adsgram plan — adjust to match their docs)
    """
    expected_sig = hmac.new(
        env_settings.ADSGRAM_CALLBACK_SECRET.encode(),
        f"{userid}:{reward_event}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, signature):
        raise HTTPException(status_code=401, detail="Invalid postback signature")

    async with get_db() as db:
        user_cursor = await db.execute("SELECT telegram_id FROM users WHERE telegram_id = ?", (userid,))
        if not await user_cursor.fetchone():
            raise HTTPException(status_code=404, detail="Unknown user")
        await _credit_ad_reward(db, userid, reward_event)
        await db.commit()

    return {"status": "ok"}


@router.get("/status")
async def ad_status(user: dict = Depends(get_current_user)):
    """Frontend polls this before showing the 'Watch Ad' button to grey it out during cooldown/limit."""
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    async with get_db() as db:
        cfg = await get_settings(db)
        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM ad_events WHERE telegram_id = ? AND created_at >= ?",
            (user["telegram_id"], since),
        )
        watched_today = (await cursor.fetchone())["c"]
    return {
        "ads_enabled": cfg["ads_enabled"],
        "watched_today": watched_today,
        "daily_limit": cfg["ad_daily_limit"],
        "reward_per_ad": cfg["ad_reward_usdt"],
        "cooldown_seconds": cfg["ad_cooldown_seconds"],
    }
