"""
In-app games: Spin Wheel and Scratch Card.

Design (per product requirement):
- The admin sets a payout RANGE (e.g. 0.04–0.09 USDT). Every play pays a random
  amount drawn from that range — the reward is NEVER derived from which segment
  the wheel visually lands on. The segment numbers are purely cosmetic and are
  freely editable by the admin (min 6 segments recommended) via /api/admin/settings.
- Each user gets a small number of free plays per day (admin-configurable).
  Once those are used, playing again requires watching a rewarded Adsgram ad
  first — the frontend calls showRewardedAd() and passes the resulting
  reward_event here, which is checked for uniqueness so the same ad view can't
  unlock more than one extra play.
- An optional hard daily cap (spin_max_daily_spins / scratch_max_daily) still
  applies even to ad-unlocked plays, so the games can't be farmed indefinitely.
"""
import json
import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import get_db, get_settings
from app.models import GamePlayPayload

router = APIRouter(prefix="/api/games", tags=["games"])


def _today_range():
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=24)).isoformat()
    return now, since


async def _plays_today(db, telegram_id: int, game_type: str) -> int:
    _, since = _today_range()
    cursor = await db.execute(
        "SELECT COUNT(*) as c FROM game_events WHERE telegram_id = ? AND game_type = ? AND created_at >= ?",
        (telegram_id, game_type, since),
    )
    return (await cursor.fetchone())["c"]


async def _last_play_time(db, telegram_id: int, game_type: str):
    cursor = await db.execute(
        "SELECT created_at FROM game_events WHERE telegram_id = ? AND game_type = ? ORDER BY id DESC LIMIT 1",
        (telegram_id, game_type),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    return datetime.fromisoformat(row["created_at"]).replace(tzinfo=timezone.utc)


async def _consume_ad_unlock(db, telegram_id: int, game_type: str, reward_event: str | None):
    """Raises if the extra play isn't legitimately unlocked. Returns True if an ad was used."""
    if not reward_event:
        raise HTTPException(status_code=402, detail="Watch an ad to play again")
    try:
        await db.execute(
            "INSERT INTO game_ad_unlocks (telegram_id, game_type, reward_event) VALUES (?, ?, ?)",
            (telegram_id, game_type, reward_event),
        )
    except Exception:
        raise HTTPException(status_code=409, detail="This ad view was already used")
    return True


async def _credit(db, telegram_id: int, game_type: str, reward: float, used_ad: bool, meta: dict):
    await db.execute(
        "INSERT INTO game_events (telegram_id, game_type, amount, used_ad, meta) VALUES (?, ?, ?, ?, ?)",
        (telegram_id, game_type, reward, 1 if used_ad else 0, json.dumps(meta)),
    )
    user_cursor = await db.execute("SELECT balance FROM users WHERE telegram_id = ?", (telegram_id,))
    current_balance = (await user_cursor.fetchone())["balance"]
    new_balance = current_balance + reward
    await db.execute(
        "UPDATE users SET balance = ?, total_earned = total_earned + ? WHERE telegram_id = ?",
        (new_balance, reward, telegram_id),
    )
    await db.execute(
        """INSERT INTO transactions (telegram_id, type, amount, balance_after, meta)
           VALUES (?, ?, ?, ?, ?)""",
        (telegram_id, f"{game_type}_reward", reward, new_balance, json.dumps(meta)),
    )
    return new_balance


# ───────────────────────── Spin Wheel ─────────────────────────

@router.get("/spin/status")
async def spin_status(user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cfg = await get_settings(db)
        played_today = await _plays_today(db, user["telegram_id"], "spin")
        last_play = await _last_play_time(db, user["telegram_id"], "spin")

    free_left = max(0, cfg["spin_daily_free_spins"] - played_today)
    max_reached = cfg["spin_max_daily_spins"] > 0 and played_today >= cfg["spin_max_daily_spins"]
    needs_ad = free_left == 0 and cfg["spin_require_ad_after_free"] and not max_reached

    cooldown_remaining = 0
    if last_play:
        elapsed = (datetime.now(timezone.utc) - last_play).total_seconds()
        cooldown_remaining = max(0, cfg["spin_cooldown_seconds"] - int(elapsed))

    return {
        "enabled": cfg["spin_enabled"],
        "segments": cfg["spin_segments"],
        "played_today": played_today,
        "free_spins_left": free_left,
        "max_daily_spins": cfg["spin_max_daily_spins"],
        "max_reached": max_reached,
        "needs_ad": needs_ad,
        "cooldown_remaining": cooldown_remaining,
    }


@router.post("/spin/play")
async def spin_play(payload: GamePlayPayload, user: dict = Depends(get_current_user)):
    telegram_id = user["telegram_id"]
    async with get_db() as db:
        cfg = await get_settings(db)
        if not cfg["spin_enabled"]:
            raise HTTPException(status_code=403, detail="Spin game is currently disabled")

        played_today = await _plays_today(db, telegram_id, "spin")
        if cfg["spin_max_daily_spins"] > 0 and played_today >= cfg["spin_max_daily_spins"]:
            raise HTTPException(status_code=429, detail="Daily spin limit reached, come back tomorrow")

        last_play = await _last_play_time(db, telegram_id, "spin")
        if last_play and (datetime.now(timezone.utc) - last_play).total_seconds() < cfg["spin_cooldown_seconds"]:
            raise HTTPException(status_code=429, detail="Please wait a moment before spinning again")

        used_ad = False
        if played_today >= cfg["spin_daily_free_spins"]:
            if cfg["spin_require_ad_after_free"]:
                used_ad = await _consume_ad_unlock(db, telegram_id, "spin", payload.ad_reward_event)
            # else: unlimited free spins beyond the guaranteed minimum, gated only by cooldown/cap

        min_r, max_r = cfg["spin_min_reward"], cfg["spin_max_reward"]
        if max_r < min_r:
            min_r, max_r = max_r, min_r
        reward = round(random.uniform(min_r, max_r), 4)

        segments = cfg["spin_segments"] or [reward]
        landed_index = random.randrange(len(segments))

        new_balance = await _credit(
            db, telegram_id, "spin", reward, used_ad, {"landed_index": landed_index}
        )
        await db.commit()

    return {
        "reward": reward,
        "new_balance": round(new_balance, 4),
        "landed_index": landed_index,
        "segments": segments,
    }


# ───────────────────────── Scratch Card ─────────────────────────

@router.get("/scratch/status")
async def scratch_status(user: dict = Depends(get_current_user)):
    async with get_db() as db:
        cfg = await get_settings(db)
        played_today = await _plays_today(db, user["telegram_id"], "scratch")

    free_left = max(0, cfg["scratch_daily_free"] - played_today)
    max_reached = cfg["scratch_max_daily"] > 0 and played_today >= cfg["scratch_max_daily"]
    needs_ad = free_left == 0 and cfg["scratch_require_ad_after_free"] and not max_reached

    return {
        "enabled": cfg["scratch_enabled"],
        "played_today": played_today,
        "free_plays_left": free_left,
        "max_daily": cfg["scratch_max_daily"],
        "max_reached": max_reached,
        "needs_ad": needs_ad,
        "winning_cells_needed": cfg["scratch_winning_cells"],
    }


@router.post("/scratch/play")
async def scratch_play(payload: GamePlayPayload, user: dict = Depends(get_current_user)):
    telegram_id = user["telegram_id"]
    async with get_db() as db:
        cfg = await get_settings(db)
        if not cfg["scratch_enabled"]:
            raise HTTPException(status_code=403, detail="Scratch card is currently disabled")

        played_today = await _plays_today(db, telegram_id, "scratch")
        if cfg["scratch_max_daily"] > 0 and played_today >= cfg["scratch_max_daily"]:
            raise HTTPException(status_code=429, detail="Daily scratch limit reached, come back tomorrow")

        used_ad = False
        if played_today >= cfg["scratch_daily_free"]:
            if cfg["scratch_require_ad_after_free"]:
                used_ad = await _consume_ad_unlock(db, telegram_id, "scratch", payload.ad_reward_event)

        min_r, max_r = cfg["scratch_min_reward"], cfg["scratch_max_reward"]
        if max_r < min_r:
            min_r, max_r = max_r, min_r
        reward = round(random.uniform(min_r, max_r), 4)

        # 9-cell card; how many cells are the "winning" symbol is admin-configurable
        # (scratch_winning_cells) so the difficulty/feel can be tuned without a redeploy.
        winning_count = max(1, min(9, cfg["scratch_winning_cells"]))
        winning_cells = sorted(random.sample(range(9), winning_count))

        new_balance = await _credit(
            db, telegram_id, "scratch", reward, used_ad, {"winning_cells": winning_cells}
        )
        await db.commit()

    return {
        "reward": reward,
        "new_balance": round(new_balance, 4),
        "winning_cells": winning_cells,
    }
