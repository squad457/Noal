"""Pydantic schemas for request bodies and typed responses."""
from pydantic import BaseModel, Field, field_validator


class AdRewardPayload(BaseModel):
    """Sent by the frontend right after Adsgram's SDK fires its onReward callback."""
    reward_event: str = Field(..., description="Unique id Adsgram gives for this ad view, prevents double-crediting")


class TaskCompletePayload(BaseModel):
    task_id: int


class WithdrawalRequest(BaseModel):
    amount: float
    method: str = Field(default="binance_pay", pattern="^(binance_pay|usdt_address)$")
    payout_id: str = Field(..., min_length=3, max_length=128)
    network: str | None = Field(default=None, description="Required when method = usdt_address, e.g. TRC20")

    @field_validator("payout_id")
    @classmethod
    def strip_payout_id(cls, v: str) -> str:
        return v.strip()


class WithdrawalStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    admin_note: str | None = None


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    url: str
    reward: float
    task_type: str = Field(default="link", pattern="^(link|telegram_join)$")


class SettingsUpdate(BaseModel):
    """All fields optional — the admin dashboard only sends the keys it changed."""
    ads_enabled: bool | None = None
    adsgram_block_id: str | None = None
    ad_reward_usdt: float | None = None
    ad_daily_limit: int | None = None
    ad_cooldown_seconds: int | None = None
    referral_commission_percent: float | None = None
    referral_signup_bonus: float | None = None
    min_withdrawal_usdt: float | None = None
    withdrawal_tiers: list[float] | None = None
    streak_rewards: list[float] | None = None
    daily_checkin_enabled: bool | None = None
    support_username: str | None = None
    maintenance_mode: bool | None = None
    maintenance_message: str | None = None


class UserAdjustBalance(BaseModel):
    telegram_id: int
    amount: float = Field(..., description="Positive to credit, negative to debit")
    note: str | None = None


class UserBanToggle(BaseModel):
    telegram_id: int
    is_banned: bool


class BroadcastPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
