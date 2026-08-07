"""
Telegram bot logic (aiogram). This module is now imported and run as a
background task INSIDE the FastAPI process (see main.py's lifespan) instead
of needing its own separate Railway service — this keeps you on a single
service, which is cheaper than running two.

If you ever outgrow this (very high traffic, want the bot to restart
independently of the API) you can still run this file standalone with:
    python -m app.bot
That fallback is kept at the bottom of this file.
"""
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.config import settings

logging.basicConfig(level=logging.INFO)

bot = Bot(token=settings.BOT_TOKEN)
dp = Dispatcher()

MINI_APP_URL = f"https://t.me/{settings.BOT_USERNAME}/app"  # replace 'app' with your Mini App's short name


def _webapp_keyboard(start_param: str | None = None) -> InlineKeyboardMarkup:
    url = MINI_APP_URL
    if start_param:
        url += f"?startapp={start_param}"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Open App & Start Earning", url=url)]
    ])


@dp.message(CommandStart())
async def start_handler(message: Message):
    # Deep link referrals arrive as /start <referrer_telegram_id>
    referrer_id = None
    parts = message.text.split(maxsplit=1)
    if len(parts) > 1 and parts[1].strip().isdigit():
        referrer_id = parts[1].strip()

    text = (
        f"👋 Welcome{', ' + message.from_user.first_name if message.from_user.first_name else ''}!\n\n"
        "💰 Earn real USDT by watching ads, completing tasks, and inviting friends.\n"
        "Tap the button below to open the app."
    )
    await message.answer(text, reply_markup=_webapp_keyboard(referrer_id))


async def run_bot():
    """
    Starts polling and runs forever. Call this as an asyncio background task
    from FastAPI's lifespan (see main.py) — do NOT call this and also run
    `python -m app.bot` separately, or Telegram will reject the second
    getUpdates connection (409 Conflict).
    """
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


async def stop_bot():
    """Called on FastAPI shutdown to close the bot's HTTP session cleanly."""
    await bot.session.close()


# ── Standalone fallback ──────────────────────────────────────────────
# Only used if you deliberately choose to run the bot as its own process
# again later (e.g. `python -m app.bot`). Not used when run.py imports
# run_bot() into the API process, which is the default setup now.
if __name__ == "__main__":
    async def _main():
        try:
            await run_bot()
        finally:
            await stop_bot()

    asyncio.run(_main())
