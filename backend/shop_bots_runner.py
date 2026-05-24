"""
BotFactory — Bots Runner
Запускает платформенный бот, боты управления магазинами и клиентские боты.
Следит за сменой токенов и перезапускает конкретный бот без рестарта сервера.
"""
import asyncio
import logging
from sqlalchemy import select
from database import AsyncSessionLocal, init_db
from models import Shop, ShopToken

logger = logging.getLogger("runner")


class BotManager:
    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._sigs: dict[str, str] = {}

    async def _safe_run(self, fn, key: str):
        delay = 5
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                logger.info("[%s] stopped", key)
                return
            except Exception as e:
                logger.error("[%s] crashed: %s — retry in %ss", key, e, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 120)
            else:
                await asyncio.sleep(5)

    async def _replace_task(self, key: str, signature: str, factory):
        old_sig = self._sigs.get(key)
        old_task = self._tasks.get(key)
        if old_task and not old_task.done() and old_sig == signature:
            return

        if old_task and not old_task.done():
            logger.info("[%s] signature changed, restarting", key)
            old_task.cancel()
            try:
                await old_task
            except asyncio.CancelledError:
                pass

        bot_obj = factory()
        self._sigs[key] = signature
        self._tasks[key] = asyncio.create_task(
            self._safe_run(bot_obj.run, key), name=key
        )
        logger.info("[%s] started", key)

    async def start_platform(self):
        key = "platform"
        if key in self._tasks and not self._tasks[key].done():
            return
        from platform_bot import start_platform_bot
        self._sigs[key] = "platform"
        self._tasks[key] = asyncio.create_task(
            self._safe_run(start_platform_bot, key), name=key
        )
        logger.info("[platform] started")

    async def start_shop(self, shop: Shop, active_token: ShopToken | None):
        from ctrl_bot import ShopControlBot
        from shop_bot import ShopCustomerBot

        await self._replace_task(
            key=f"ctrl_{shop.id}",
            signature=f"ctrl:{shop.id}:{shop.ctrl_bot_token}",
            factory=lambda: ShopControlBot(shop.id, shop.ctrl_bot_token, shop.name),
        )

        if active_token:
            await self._replace_task(
                key=f"shop_{shop.id}",
                signature=f"shop:{shop.id}:{active_token.token}",
                factory=lambda: ShopCustomerBot(shop.id, shop.name),
            )
        else:
            key = f"shop_{shop.id}"
            task = self._tasks.get(key)
            if task and not task.done():
                task.cancel()
                logger.info("[%s] stopped: active token missing", key)

    async def sync(self):
        async with AsyncSessionLocal() as db:
            shops = (await db.execute(
                select(Shop).where(Shop.is_active == True)
            )).scalars().all()
            active_tokens = {}
            for shop in shops:
                active_tokens[shop.id] = (await db.execute(
                    select(ShopToken).where(
                        ShopToken.shop_id == shop.id,
                        ShopToken.is_active == True,
                    )
                )).scalar_one_or_none()

        active_keys = {"platform"}
        for shop in shops:
            active_keys.add(f"ctrl_{shop.id}")
            if active_tokens.get(shop.id):
                active_keys.add(f"shop_{shop.id}")
            await self.start_shop(shop, active_tokens.get(shop.id))

        for key, task in list(self._tasks.items()):
            if key not in active_keys and not task.done():
                task.cancel()
                logger.info("[%s] stopped: no longer active", key)

    async def run(self):
        await init_db()
        logger.info("BotManager starting...")
        await self.start_platform()
        await self.sync()
        while True:
            await asyncio.sleep(30)
            await self.sync()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    asyncio.run(BotManager().run())
