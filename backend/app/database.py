"""
aiosqlite database layer.

Schema overview
----------------
users            one row per Telegram user
transactions     immutable ledger of every balance change (ads, tasks, referral, withdrawal, admin adjustment)
tasks            admin-configurable custom tasks (join channel, visit link, etc.)
user_tasks       which users completed which tasks
withdrawals      withdrawal requests + status tracking
ad_events        one row per verified Adsgram reward, used for daily-limit / cooldown checks
referrals        referral edges (referrer -> referred) + commission paid
"""
import aiosqlite
import contextlib
from app.config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    telegram_id       INTEGER PRIMARY KEY,
    username          TEXT,
    first_name        TEXT,
    balance           REAL NOT NULL DEFAULT 0,       -- current withdrawable USDT balance
    total_earned      REAL NOT NULL DEFAULT 0,       -- lifetime earnings, never decreases
    streak_count      INTEGER NOT NULL DEFAULT 0,
    last_checkin_date TEXT,                          -- 'YYYY-MM-DD' in UTC
    referred_by       INTEGER,                       -- telegram_id of referrer, NULL if none
    binance_pay_id    TEXT,                           -- last-used payout ID, prefilled on wallet page
    is_banned         INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (referred_by) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   INTEGER NOT NULL,
    type          TEXT NOT NULL,      -- 'ad_reward' | 'task_reward' | 'referral_commission' | 'referral_bonus' | 'checkin' | 'withdrawal' | 'admin_adjust'
    amount        REAL NOT NULL,      -- positive = credit, negative = debit
    balance_after REAL NOT NULL,
    meta          TEXT,               -- JSON string, e.g. {"ad_block_id": "..."} for audit trail
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    url         TEXT NOT NULL,        -- link the user must visit / channel to join
    reward      REAL NOT NULL,
    task_type   TEXT NOT NULL DEFAULT 'link',  -- 'link' | 'telegram_join'
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  INTEGER NOT NULL,
    task_id      INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'pending_review'
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(telegram_id, task_id),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id    INTEGER NOT NULL,
    amount         REAL NOT NULL,
    method         TEXT NOT NULL DEFAULT 'binance_pay', -- 'binance_pay' | 'usdt_address'
    payout_id      TEXT NOT NULL,      -- Binance Pay ID or wallet address
    network        TEXT,               -- e.g. 'TRC20', 'BEP20' — only used when method = usdt_address
    status         TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
    admin_note     TEXT,
    requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at    TEXT,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS ad_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  INTEGER NOT NULL,
    reward_event TEXT,                 -- Adsgram's event id, used to reject duplicate postbacks
    amount       REAL NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(reward_event),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS referrals (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id      INTEGER NOT NULL,
    referred_id      INTEGER NOT NULL UNIQUE,
    total_commission REAL NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (referrer_id) REFERENCES users(telegram_id),
    FOREIGN KEY (referred_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(telegram_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_ad_events_user_date ON ad_events(telegram_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
"""


# Settings that live in the DB (admin-editable at runtime) instead of only in env vars.
# Seeded from config.py defaults the first time the app boots; after that, the DB row wins.
DEFAULT_SETTINGS = {
    "ads_enabled": "1",
    "adsgram_block_id": settings.ADSGRAM_BLOCK_ID,
    "ad_reward_usdt": str(settings.AD_REWARD_USDT),
    "ad_daily_limit": str(settings.AD_DAILY_LIMIT),
    "ad_cooldown_seconds": str(settings.AD_COOLDOWN_SECONDS),
    "referral_commission_percent": str(settings.REFERRAL_COMMISSION_PERCENT),
    "referral_signup_bonus": str(settings.REFERRAL_SIGNUP_BONUS),
    "min_withdrawal_usdt": str(settings.MIN_WITHDRAWAL_USDT),
    "withdrawal_tiers": ",".join(str(t) for t in settings.WITHDRAWAL_TIERS),
    "streak_rewards": ",".join(str(r) for r in settings.STREAK_REWARDS),
    "daily_checkin_enabled": "1",
    "support_username": "",
    "maintenance_mode": "0",
    "maintenance_message": "We'll be back shortly — thanks for your patience!",
}


async def init_db():
    """Run once on app startup. Creates tables if they don't exist yet — safe to re-run."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.executescript(SCHEMA)
        # Seed any settings keys that don't exist yet (won't overwrite admin-edited values)
        for key, value in DEFAULT_SETTINGS.items():
            await db.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value)
            )
        await db.commit()


async def get_settings(db) -> dict:
    """Returns all runtime settings as a dict of native-typed values."""
    cursor = await db.execute("SELECT key, value FROM settings")
    raw = {row["key"]: row["value"] for row in await cursor.fetchall()}

    def _f(key, default=0.0):
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    def _i(key, default=0):
        try:
            return int(float(raw.get(key, default)))
        except (TypeError, ValueError):
            return default

    def _b(key, default=False):
        return raw.get(key, "1" if default else "0") == "1"

    def _list_f(key, default):
        val = raw.get(key)
        if not val:
            return default
        try:
            return [float(x) for x in val.split(",") if x.strip() != ""]
        except ValueError:
            return default

    return {
        "ads_enabled": _b("ads_enabled", True),
        "adsgram_block_id": raw.get("adsgram_block_id", ""),
        "ad_reward_usdt": _f("ad_reward_usdt", settings.AD_REWARD_USDT),
        "ad_daily_limit": _i("ad_daily_limit", settings.AD_DAILY_LIMIT),
        "ad_cooldown_seconds": _i("ad_cooldown_seconds", settings.AD_COOLDOWN_SECONDS),
        "referral_commission_percent": _f("referral_commission_percent", settings.REFERRAL_COMMISSION_PERCENT),
        "referral_signup_bonus": _f("referral_signup_bonus", settings.REFERRAL_SIGNUP_BONUS),
        "min_withdrawal_usdt": _f("min_withdrawal_usdt", settings.MIN_WITHDRAWAL_USDT),
        "withdrawal_tiers": _list_f("withdrawal_tiers", settings.WITHDRAWAL_TIERS),
        "streak_rewards": _list_f("streak_rewards", settings.STREAK_REWARDS),
        "daily_checkin_enabled": _b("daily_checkin_enabled", True),
        "support_username": raw.get("support_username", ""),
        "maintenance_mode": _b("maintenance_mode", False),
        "maintenance_message": raw.get("maintenance_message", ""),
    }


@contextlib.asynccontextmanager
async def get_db():
    """
    Usage:
        async with get_db() as db:
            await db.execute(...)
            await db.commit()
    row_factory is set so results behave like dicts (row["column_name"]).
    """
    db = await aiosqlite.connect(settings.DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
