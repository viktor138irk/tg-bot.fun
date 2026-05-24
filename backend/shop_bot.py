"""BotFactory — Shop Customer Bot (бот магазина для покупателей)"""
import asyncio, logging, random
from datetime import datetime
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import (Message, CallbackQuery, InlineKeyboardButton,
    KeyboardButton, ReplyKeyboardRemove)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from sqlalchemy import select, desc
from config import settings
from database import AsyncSessionLocal
from models import Shop, ShopToken, Product, PaymentCard, Order, OrderStatus, Tenant
from billing import commission_rate, tenant_can_sell

logger = logging.getLogger("shop_bot")


def fmt(v: float) -> str:
    return f"{v:,.0f}".replace(",", " ") + " ₽"


class SS(StatesGroup):
    waiting_proof = State()


class ShopCustomerBot:
    def __init__(self, shop_id: int, shop_name: str):
        self.shop_id = shop_id
        self.name    = shop_name
        self.router  = Router()
        self._reg()

    def _reg(self):
        r=self.router; sid=self.shop_id

        def main_kb():
            b=ReplyKeyboardBuilder()
            b.row(KeyboardButton(text="🛍 Каталог"))
            b.row(KeyboardButton(text="📦 Мои заказы"), KeyboardButton(text="💬 Поддержка"))
            return b.as_markup(resize_keyboard=True)

        @r.message(Command("start"))
        async def start(msg: Message, state: FSMContext):
            await state.clear()
            async with AsyncSessionLocal() as db:
                shop=await db.get(Shop,sid); tenant=await db.get(Tenant,shop.tenant_id) if shop else None
                ok, reason = tenant_can_sell(tenant)
            if not shop or not ok:
                await msg.answer(f"⚠️ {reason or 'Магазин временно приостановлен.'}"); return
            await msg.answer(f"{shop.welcome_msg}\n\n<b>{shop.name}</b>",
                parse_mode="HTML", reply_markup=main_kb())

        @r.message(F.text=="🛍 Каталог")
        async def catalog(msg: Message):
            async with AsyncSessionLocal() as db:
                prods=(await db.execute(
                    select(Product).where(Product.shop_id==sid, Product.is_active==True, Product.stock>0)
                    .order_by(Product.category, Product.name)
                )).scalars().all()
            if not prods:
                await msg.answer("🛍 Каталог пуст."); return
            cats: dict = {}
            for p in prods: cats.setdefault(p.category,[]).append(p)
            bld=InlineKeyboardBuilder(); txt="🛍 <b>Каталог</b>\n\n"
            for cat,ps in cats.items():
                txt+=f"📂 <b>{cat}</b>\n"
                for p in ps:
                    txt+=f"  • {p.name} — <b>{fmt(p.price)}</b>\n"
                    bld.add(InlineKeyboardButton(text=f"🛒 {p.name[:28]}", callback_data=f"buy_{p.id}"))
                txt+="\n"
            bld.adjust(1)
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data.startswith("buy_"))
        async def product_card(cb: CallbackQuery):
            pid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                p=await db.get(Product,pid)
                if not p or not p.is_active or p.shop_id!=sid or p.stock <= 0:
                    await cb.answer("Товар недоступен",show_alert=True); return
            bld=InlineKeyboardBuilder()
            bld.row(InlineKeyboardButton(text=f"✅ Купить за {fmt(p.price)}", callback_data=f"order_{p.id}"),
                    InlineKeyboardButton(text="← Назад", callback_data="back_cat"))
            txt=f"🛍 <b>{p.name}</b>\n{'─'*22}\n💰 <b>{fmt(p.price)}</b>\n📂 {p.category}\n\n{p.description}"
            if p.photo_url:
                await cb.message.answer_photo(photo=p.photo_url, caption=txt,
                    parse_mode="HTML", reply_markup=bld.as_markup())
            else:
                await cb.message.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())
            await cb.answer()

        @r.callback_query(F.data=="back_cat")
        async def back_cat(cb: CallbackQuery):
            await catalog(cb.message); await cb.answer()

        @r.callback_query(F.data.startswith("order_"))
        async def create_order(cb: CallbackQuery, state: FSMContext):
            pid=int(cb.data[6:])
            async with AsyncSessionLocal() as db:
                p=await db.get(Product,pid)
                if not p or not p.is_active or p.shop_id!=sid or p.stock <= 0:
                    await cb.answer("Недоступен",show_alert=True); return
                cards=(await db.execute(
                    select(PaymentCard).where(PaymentCard.shop_id==sid, PaymentCard.is_active==True)
                )).scalars().all()
                if not cards:
                    await cb.answer("Оплата временно недоступна.",show_alert=True); return
                card=random.choice(cards)
                shop=await db.get(Shop,sid); tenant=await db.get(Tenant,shop.tenant_id)
                ok, reason = tenant_can_sell(tenant)
                if not ok:
                    await cb.answer(reason, show_alert=True); return
                rate=commission_rate(tenant)
                commission=round(p.price*rate/100, 2)
                order=Order(shop_id=sid, product_id=p.id, card_id=card.id,
                    buyer_telegram_id=cb.from_user.id,
                    buyer_username=cb.from_user.username or "",
                    amount=p.price, commission=commission,
                    status=OrderStatus.pending, product_content=p.content)
                db.add(order); card.orders_count+=1; await db.flush()
                oid=order.id; await db.commit()
            await state.update_data(order_id=oid); await state.set_state(SS.waiting_proof)
            pay_txt=(
                f"💳 <b>Заказ #{oid}</b>\n{'─'*24}\n"
                f"🛍 {p.name}\n💰 <b>{fmt(p.price)}</b>\n\n"
                f"<b>Переводите на карту:</b>\n"
                f"🏦 {card.bank}\n"
                f"💳 <code>{card.number}</code>\n"
                f"👤 {card.holder}\n"
                +(f"📱 СБП: <code>{card.phone}</code>\n" if card.phone else "")
                +f"\n📝 Назначение: <code>Заказ #{oid}</code>\n\n"
                f"📸 После оплаты пришлите <b>скриншот перевода</b>.\n"
                f"⏱ Товар выдаётся после проверки кассиром."
            )
            bld=InlineKeyboardBuilder()
            bld.add(InlineKeyboardButton(text="❌ Отменить заказ", callback_data=f"cancel_{oid}"))
            await cb.message.answer(pay_txt, parse_mode="HTML", reply_markup=bld.as_markup())
            await cb.answer()

        @r.message(SS.waiting_proof, F.photo)
        async def receive_proof(msg: Message, state: FSMContext):
            data=await state.get_data(); oid=data.get("order_id")
            if not oid: await state.clear(); return
            file_id=msg.photo[-1].file_id
            async with AsyncSessionLocal() as db:
                o=await db.get(Order,oid)
                if not o or o.buyer_telegram_id!=msg.from_user.id:
                    await msg.answer("❌ Заказ не найден."); await state.clear(); return
                o.status=OrderStatus.confirming; o.proof_file_id=file_id
                shop=await db.get(Shop,sid); await db.commit()
            await state.clear()
            await msg.answer(
                f"✅ Скриншот получен!\nЗаказ #{oid} на проверке.\n⏱ До 15 минут.",
                reply_markup=ReplyKeyboardRemove())
            # Уведомить кассиров
            await self._notify(shop, oid, o.amount, msg.from_user.username or str(msg.from_user.id), file_id)

        @r.message(SS.waiting_proof)
        async def proof_not_photo(msg: Message):
            await msg.answer("📸 Пришлите скриншот перевода (фото).")

        @r.callback_query(F.data.startswith("cancel_"))
        async def cancel(cb: CallbackQuery, state: FSMContext):
            oid=int(cb.data[7:])
            async with AsyncSessionLocal() as db:
                o=await db.get(Order,oid)
                if o and o.buyer_telegram_id==cb.from_user.id and o.status==OrderStatus.pending:
                    o.status=OrderStatus.cancelled; await db.commit()
            await state.clear(); await cb.message.edit_text("❌ Заказ отменён."); await cb.answer()

        @r.message(F.text=="📦 Мои заказы")
        async def my_orders(msg: Message):
            async with AsyncSessionLocal() as db:
                ords=(await db.execute(
                    select(Order).where(Order.shop_id==sid, Order.buyer_telegram_id==msg.from_user.id)
                    .order_by(desc(Order.created_at)).limit(10)
                )).scalars().all()
            if not ords: await msg.answer("📦 Заказов нет."); return
            em_map={OrderStatus.pending:"🟡",OrderStatus.confirming:"🟠",
                    OrderStatus.completed:"✅",OrderStatus.rejected:"❌",OrderStatus.cancelled:"🚫"}
            txt="📦 <b>Ваши заказы:</b>\n\n"
            for o in ords:
                txt+=f"{em_map.get(o.status,'❓')} #{o.id} · {fmt(o.amount)} · {o.created_at:%d.%m %H:%M}\n"
            await msg.answer(txt, parse_mode="HTML")

        @r.message(F.text=="💬 Поддержка")
        async def support(msg: Message):
            await msg.answer(f"💬 По вопросам — обращайтесь к администрации {self.name}.")

    async def _notify(self, shop, oid: int, amount: float, buyer: str, file_id: str):
        if not shop or not shop.ctrl_bot_token: return
        try:
            from ctrl_bot import ShopControlBot
            ctrl=ShopControlBot(self.shop_id, shop.ctrl_bot_token, self.name)
            await ctrl.notify_cashiers(oid, amount, buyer, file_id)
        except Exception as e:
            logger.error(f"_notify: {e}")

    async def run(self):
        async with AsyncSessionLocal() as db:
            tok=(await db.execute(
                select(ShopToken).where(ShopToken.shop_id==self.shop_id, ShopToken.is_active==True)
            )).scalar_one_or_none()
        if not tok:
            logger.warning(f"shop_id={self.shop_id}: нет активного токена"); await asyncio.sleep(30); return
        storage=RedisStorage.from_url(settings.REDIS_URL+f"?db={10+self.shop_id%4}")
        bot=Bot(token=tok.token); dp=Dispatcher(storage=storage)
        dp.include_router(self.router)
        logger.info(f"Shop bot: {self.name} ({tok.username})")
        try:
            await dp.start_polling(bot, allowed_updates=["message","callback_query"])
        finally:
            await bot.session.close()
