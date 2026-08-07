"""
Central configuration, loaded from environment variables.
On Railway, set these under the service's Variables tab.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # --- Telegram ---
    BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")  # from @BotFather
    BOT_USERNAME: str = os.getenv("BOT_USERNAME", "your_bot")  # without @, used to build referral links

    # --- Database ---
    DB_PATH: str = os.getenv("DB_PATH", "app_data.db")

    # --- CORS ---
    # Comma-separated list of allowed frontend origins, e.g. your Vercel domain
    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.getenv(
            "ALLOWED_ORIGINS",
            "https://your-frontend.vercel.app,http://localhost:5173"
        ).split(",") if o.strip()
    ]

    # The short name you gave your Mini App in BotFather's /newapp flow.
    # Used to build both the bot's "Open App" button and every referral link,
    # so they can never drift out of sync with each other.
    MINI_APP_SHORT_NAME: str = os.getenv("MINI_APP_SHORT_NAME", "app")

    # --- Admin ---
    ADMIN_IDS: list[int] = [
        int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip().isdigit()
    ]
    ADMIN_API_KEY: str = os.getenv("ADMIN_API_KEY", "change-me-in-production")

    # --- Adsgram ---
    ADSGRAM_BLOCK_ID: str = os.getenv("ADSGRAM_BLOCK_ID", "")
    # Adsgram signs server-to-server postback calls with this secret (set the same value
    # in your Adsgram dashboard's "Reward callback" settings)
    ADSGRAM_CALLBACK_SECRET: str = os.getenv("ADSGRAM_CALLBACK_SECRET", "change-me")

    # --- Economy ---
    AD_REWARD_USDT: float = float(os.getenv("AD_REWARD_USDT", "0.003"))
    AD_DAILY_LIMIT: int = int(os.getenv("AD_DAILY_LIMIT", "50"))
    AD_COOLDOWN_SECONDS: int = int(os.getenv("AD_COOLDOWN_SECONDS", "15"))

    REFERRAL_COMMISSION_PERCENT: float = float(os.getenv("REFERRAL_COMMISSION_PERCENT", "10"))
    REFERRAL_SIGNUP_BONUS: float = float(os.getenv("REFERRAL_SIGNUP_BONUS", "0.01"))

    MIN_WITHDRAWAL_USDT: float = float(os.getenv("MIN_WITHDRAWAL_USDT", "10"))
    WITHDRAWAL_TIERS: list[float] = [10, 50, 100]

    # Daily check-in streak rewards, index 0 = day 1 ... index 6 = day 7 (then it loops)
    STREAK_REWARDS: list[float] = [0.002, 0.003, 0.004, 0.005, 0.006, 0.008, 0.02]

    # --- Security ---
    # Reject Telegram initData older than this (seconds) to prevent replay attacks
    INIT_DATA_MAX_AGE_SECONDS: int = int(os.getenv("INIT_DATA_MAX_AGE_SECONDS", "86400"))
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me-too")


settings = Settings()
