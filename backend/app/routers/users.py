import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import settings as env_settings
from app.database import get_db, get_settings

router = APIRouter(prefix="/api/user", tags=["user"])


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@router.get("/sync")
async def sync_user(user: dict = Depends(get_current_user)):
    """
    Called once when the Mini App opens. get_current_user already created/refreshed
    the row, so we just return the current snapshot the frontend needs to render.
    """
    async with get_db() as db:
        cfg = await get_settings(db)

    return {
        "telegram_id": user["telegram_id"],
        "username": user["username"],
        "first_name": user["first_name"],
        "balance": round(user["balance"], 4),
        "total_earned": round(user["total_earned"], 4),
        "streak_count": user["streak_count"],
        "last_checkin_date": user["last_checkin_date"],
        "checked_in_today": user["last_checkin_date"] == _today_utc(),
        "daily_checkin_enabled": cfg["daily_checkin_enabled"],
        "binance_pay_id": user["binance_pay_id"],
        "referral_link": f"https://t.me/{env_settings.BOT_USERNAME}/{env_settings.MINI_APP_SHORT_NAME}?startapp={user['telegram_id']}",
        "support_username": cfg["support_username"],
    }


@router.post("/checkin")
async def daily_checkin(user: dict = Depends(get_current_user)):
    today = _today_utc()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    if user["last_checkin_date"] == today:
        raise HTTPException(status_code=400, detail="Already checked in today")

    async with get_db() as db:
        cfg = await get_settings(db)
        if not cfg["daily_checkin_enabled"]:
            raise HTTPException(status_code=403, detail="Daily check-in is currently disabled")

        # Streak continues only if the last check-in was yesterday; otherwise it resets to day 1
        new_streak = user["streak_count"] + 1 if user["last_checkin_date"] == yesterday else 1
        streak_rewards = cfg["streak_rewards"] or [0.002]
        reward = streak_rewards[(new_streak - 1) % len(streak_rewards)]

        new_balance = user["balance"] + reward
        await db.execute(
            """UPDATE users SET balance = ?, total_earned = total_earned + ?,
               streak_count = ?, last_checkin_date = ? WHERE telegram_id = ?""",
            (new_balance, reward, new_streak, today, user["telegram_id"]),
        )
        await db.execute(
            """INSERT INTO transactions (telegram_id, type, amount, balance_after, meta)
               VALUES (?, 'checkin', ?, ?, ?)""",
            (user["telegram_id"], reward, new_balance, json.dumps({"streak_day": new_streak})),
        )
        await db.commit()

    return {"reward": reward, "new_balance": round(new_balance, 4), "streak_count": new_streak}


@router.get("/transactions")
async def get_transactions(user: dict = Depends(get_current_user), limit: int = 50):
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT type, amount, balance_after, created_at FROM transactions
               WHERE telegram_id = ? ORDER BY id DESC LIMIT ?""",
            (user["telegram_id"], min(limit, 200)),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]
