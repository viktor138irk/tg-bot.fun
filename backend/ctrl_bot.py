"""BotFactory — Shop Control Bot (бот управления магазином)"""
import asyncio, logging, random
from datetime import datetime
from typing import Optional
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import (Message, CallbackQuery, InlineKeyboardButton,
    KeyboardButton, ReplyKeyboardMarkup, ReplyKeyboardRemove)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from sqlalchemy import select, func, desc
from config import settings
from database import AsyncSessionLocal
from models import Shop, ShopMember, ShopToken, Product, PaymentCard, Order, OrderStatus, BalanceTransaction, Tenant
from billing import is_postpaid, tenant_can_sell

logger = logging.getLogger("ctrl_bot")


def fmt(v: float) -> str:
    return f"{v:,.0f}".replace(",", " ") + " ₽"

def dt(d: datetime) -> str:
    return d.strftime("%d.%m.%Y %H:%M")


class CS(StatesGroup):
    prod_name = State(); prod_price = State(); prod_cat = State()
    prod_desc = State(); prod_content = State()
    card_bank = State(); card_num = State(); card_holder = State(); card_phone = State()
    mbr_id    = State(); mbr_name  = State()
    tok_val   = State(); tok_user  = State(); tok_note   = State()


async def get_role(shop_id: int, tg_id: int) -> Optional[str]:
    async with AsyncSessionLocal() as db:
        shop = await db.get(Shop, shop_id)
        if not shop: return None
        tenant = await db.get(Tenant, shop.tenant_id)
        if tenant and tenant.telegram_id == tg_id:
            return "admin"
        m = (await db.execute(
            select(ShopMember).where(ShopMember.shop_id==shop_id, ShopMember.telegram_id==tg_id)
        )).scalar_one_or_none()
        return m.role if m else None


def admin_kb():
    b = ReplyKeyboardBuilder()
    b.row(KeyboardButton(text="📊 Статистика"), KeyboardButton(text="📦 Заказы"))
    b.row(KeyboardButton(text="🛍 Товары"),    KeyboardButton(text="💳 Карты"))
    b.row(KeyboardButton(text="👥 Команда"),   KeyboardButton(text="⚙️ Токены"))
    b.row(KeyboardButton(text="💰 Баланс"))
    return b.as_markup(resize_keyboard=True)

def cashier_kb():
    b = ReplyKeyboardBuilder()
    b.row(KeyboardButton(text="📦 Заказы на проверке"))
    b.row(KeyboardButton(text="📋 История платежей"))
    return b.as_markup(resize_keyboard=True)

def ib(*rows):
    bld = InlineKeyboardBuilder()
    for row in rows:
        if isinstance(row, list):
            bld.row(*[InlineKeyboardButton(text=t, callback_data=d) for t, d in row])
        else:
            bld.add(InlineKeyboardButton(text=row[0], callback_data=row[1]))
    return bld.as_markup()


class ShopControlBot:
    def __init__(self, shop_id: int, token: str, shop_name: str):
        self.shop_id = shop_id
        self.token   = token
        self.name    = shop_name
        self.router  = Router()
        self._reg()

    def _reg(self):
        r = self.router; sid = self.shop_id

        async def role(event) -> Optional[str]:
            uid = event.from_user.id
            r = await get_role(sid, uid)
            if not r:
                deny = "⛔ Вы не в команде магазина. Обратитесь к владельцу."
                if isinstance(event, Message): await event.answer(deny)
                else: await event.answer(deny, show_alert=True)
            return r

        # /start
        @r.message(Command("start"))
        async def start(msg: Message, state: FSMContext):
            await state.clear()
            rl = await role(msg)
            if not rl: return
            await msg.answer(
                f"🏪 <b>{self.name}</b>\n{'Администратор' if rl=='admin' else 'Кассир'}",
                parse_mode="HTML",
                reply_markup=admin_kb() if rl=="admin" else cashier_kb())

        # ── СТАТИСТИКА ────────────────────────────────────────────────────────
        @r.message(F.text=="📊 Статистика")
        async def stats(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                rev  = (await db.execute(select(func.sum(Order.amount)).where(Order.shop_id==sid, Order.status==OrderStatus.completed))).scalar() or 0
                comm = (await db.execute(select(func.sum(Order.commission)).where(Order.shop_id==sid, Order.status==OrderStatus.completed))).scalar() or 0
                ordn = (await db.execute(select(func.count(Order.id)).where(Order.shop_id==sid, Order.status==OrderStatus.completed))).scalar()
                pend = (await db.execute(select(func.count(Order.id)).where(Order.shop_id==sid, Order.status.in_([OrderStatus.pending,OrderStatus.confirming])))).scalar()
                prods= (await db.execute(select(func.count(Product.id)).where(Product.shop_id==sid, Product.is_active==True))).scalar()
                cards= (await db.execute(select(func.count(PaymentCard.id)).where(PaymentCard.shop_id==sid, PaymentCard.is_active==True))).scalar()
                shop = await db.get(Shop, sid)
                tenant = await db.get(Tenant, shop.tenant_id)
            be = "🔴" if tenant.balance<=0 else ("🟡" if tenant.balance<=tenant.alert_threshold else "🟢")
            await msg.answer(
                f"📊 <b>{self.name}</b> · {datetime.now():%d.%m.%Y %H:%M}\n{'─'*26}\n\n"
                f"📦 Заказов: <b>{ordn}</b> | ⏳ Ждут: <b>{pend}</b>\n"
                f"💰 Оборот: <b>{fmt(rev)}</b>\n"
                f"📊 Комиссия: <b>{fmt(comm)}</b>\n"
                f"💵 Мой доход: <b>{fmt(rev-comm)}</b>\n\n"
                f"🛍 Товаров: {prods} | 💳 Карт: {cards}\n\n"
                f"{be} Баланс BotFactory: <b>{fmt(tenant.balance)}</b>",
                parse_mode="HTML")

        # ── ЗАКАЗЫ ────────────────────────────────────────────────────────────
        @r.message(F.text.in_(["📦 Заказы","📦 Заказы на проверке"]))
        async def orders(msg: Message):
            if not await role(msg): return
            async with AsyncSessionLocal() as db:
                ords = (await db.execute(
                    select(Order).where(Order.shop_id==sid,
                    Order.status.in_([OrderStatus.pending,OrderStatus.confirming]))
                    .order_by(Order.created_at.asc()).limit(20)
                )).scalars().all()
            if not ords:
                await msg.answer("✅ Ожидающих заказов нет."); return
            txt = f"📦 <b>Заказы на проверке ({len(ords)}):</b>\n\n"
            bld = InlineKeyboardBuilder()
            for o in ords:
                em = "🟡" if o.status==OrderStatus.pending else "🟠"
                txt += f"{em} #{o.id} · {fmt(o.amount)} · {o.buyer_username or o.buyer_telegram_id}\n"
                bld.add(InlineKeyboardButton(text=f"{em}#{o.id}·{o.amount:.0f}₽", callback_data=f"co_{o.id}"))
            bld.adjust(2)
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data.startswith("co_"))
        async def order_detail(cb: CallbackQuery):
            if not await role(cb): return
            oid = int(cb.data[3:])
            async with AsyncSessionLocal() as db:
                o = await db.get(Order, oid)
                if not o or o.shop_id!=sid: await cb.answer("Не найден",show_alert=True); return
                card = await db.get(PaymentCard, o.card_id) if o.card_id else None
            txt = (f"📦 <b>Заказ #{o.id}</b>\n{'─'*22}\n"
                   f"👤 {o.buyer_username or o.buyer_telegram_id}\n"
                   f"💰 {fmt(o.amount)} | Комиссия: {fmt(o.commission)}\n"
                   + (f"💳 {card.bank} · {card.number}\n" if card else "")
                   + f"📅 {dt(o.created_at)}")
            bld = InlineKeyboardBuilder()
            if o.status in [OrderStatus.pending, OrderStatus.confirming]:
                bld.row(InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"cc_{oid}"),
                        InlineKeyboardButton(text="❌ Отклонить",   callback_data=f"cr_{oid}"))
            bld.row(InlineKeyboardButton(text="← Назад", callback_data="cord_back"))
            if o.proof_file_id:
                await cb.message.answer_photo(photo=o.proof_file_id, caption=txt,
                                               parse_mode="HTML", reply_markup=bld.as_markup())
            else:
                await cb.message.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())
            await cb.answer()

        @r.callback_query(F.data.startswith("cc_"))
        async def confirm_order(cb: CallbackQuery):
            if not await role(cb): return
            oid = int(cb.data[3:])
            async with AsyncSessionLocal() as db:
                o = await db.get(Order, oid)
                if not o or o.shop_id!=sid or o.status not in [OrderStatus.pending,OrderStatus.confirming]:
                    await cb.answer("Нельзя подтвердить", show_alert=True); return
                shop = await db.get(Shop, sid)
                tenant = await db.get(Tenant, shop.tenant_id) if shop else None
                ok, reason = tenant_can_sell(tenant)
                if not ok:
                    await cb.answer(f"❌ {reason}", show_alert=True); return

                product = await db.get(Product, o.product_id)
                card = await db.get(PaymentCard, o.card_id) if o.card_id else None

                o.status = OrderStatus.completed
                o.confirmed_by = cb.from_user.id

                if product:
                    product.sold += 1
                    if product.stock > 0:
                        product.stock -= 1
                    if product.stock <= 0:
                        product.is_active = False

                if card:
                    card.received_total += o.amount

                charged_now = False
                if tenant and not is_postpaid(tenant):
                    old = tenant.balance
                    tenant.balance -= o.commission
                    charged_now = True
                    db.add(BalanceTransaction(tenant_id=tenant.id, type="commission",
                        amount=-o.commission, balance_after=tenant.balance,
                        note=f"Заказ #{oid}", order_id=oid))
                    if old > 0 and tenant.balance <= 0:
                        tenant.is_blocked = True
                elif tenant:
                    db.add(BalanceTransaction(tenant_id=tenant.id, type="postpaid_accrual",
                        amount=0, balance_after=tenant.balance,
                        note=f"Начислена постоплатная комиссия {fmt(o.commission)} за заказ #{oid}", order_id=oid))

                content = o.product_content; buyer_id = o.buyer_telegram_id
                await db.commit()
            await self._deliver(buyer_id, content, oid)
            suffix = "комиссия списана" if charged_now else "комиссия начислена в постоплату"
            txt = f"✅ <b>Заказ #{oid} подтверждён.</b> Товар выдан, {suffix}."
            if cb.message.photo:
                await cb.message.edit_caption(caption=txt, parse_mode="HTML")
            else:
                await cb.message.edit_text(txt, parse_mode="HTML")
            await cb.answer("✅")

        @r.callback_query(F.data.startswith("cr_"))
        async def reject_order(cb: CallbackQuery):
            if not await role(cb): return
            oid = int(cb.data[3:])
            async with AsyncSessionLocal() as db:
                o = await db.get(Order, oid); o.status = OrderStatus.rejected; await db.commit()
            await cb.message.edit_text(f"❌ Заказ #{oid} отклонён."); await cb.answer()

        @r.callback_query(F.data=="cord_back")
        async def cord_back(cb: CallbackQuery):
            await orders(cb.message); await cb.answer()

        @r.message(F.text=="📋 История платежей")
        async def history(msg: Message):
            if not await role(msg): return
            async with AsyncSessionLocal() as db:
                ords = (await db.execute(
                    select(Order).where(Order.shop_id==sid, Order.status==OrderStatus.completed)
                    .order_by(desc(Order.created_at)).limit(15)
                )).scalars().all()
            if not ords: await msg.answer("Нет выполненных заказов."); return
            txt = "📋 <b>Последние выполненные:</b>\n\n"
            for o in ords:
                txt += f"✅ #{o.id} · {fmt(o.amount)} · {dt(o.created_at)}\n"
            await msg.answer(txt, parse_mode="HTML")

        # ── ТОВАРЫ (admin) ────────────────────────────────────────────────────
        @r.message(F.text=="🛍 Товары")
        async def products_menu(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                prods = (await db.execute(
                    select(Product).where(Product.shop_id==sid).order_by(desc(Product.created_at)).limit(20)
                )).scalars().all()
            if not prods:
                await msg.answer("Товаров нет.", reply_markup=ib(("➕ Добавить","cp_add"))); return
            bld = InlineKeyboardBuilder(); txt = f"🛍 <b>Товары ({len(prods)}):</b>\n\n"
            for p in prods:
                em = "✅" if p.is_active else "🔴"
                txt += f"{em} {p.name} · {fmt(p.price)}\n"
                bld.add(InlineKeyboardButton(text=f"{em}{p.name[:22]}", callback_data=f"cp_{p.id}"))
            bld.adjust(1); bld.row(InlineKeyboardButton(text="➕ Добавить", callback_data="cp_add"))
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data=="cp_add")
        async def add_prod(cb: CallbackQuery, state: FSMContext):
            if await role(cb) != "admin": return
            await state.set_state(CS.prod_name)
            await cb.message.answer("🛍 <b>Название товара:</b>", parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
            await cb.answer()

        @r.message(CS.prod_name)
        async def p_name(msg: Message, state: FSMContext):
            await state.update_data(name=msg.text); await state.set_state(CS.prod_price)
            await msg.answer("Цена (₽):")

        @r.message(CS.prod_price)
        async def p_price(msg: Message, state: FSMContext):
            try: price=float(msg.text.replace(",",".")); assert price>0
            except: await msg.answer("❌ Введите цену, например 599"); return
            await state.update_data(price=price); await state.set_state(CS.prod_cat)
            await msg.answer("Категория (или '-'):")

        @r.message(CS.prod_cat)
        async def p_cat(msg: Message, state: FSMContext):
            await state.update_data(category=msg.text if msg.text!="-" else "Общее")
            await state.set_state(CS.prod_desc)
            await msg.answer("Описание для покупателя:")

        @r.message(CS.prod_desc)
        async def p_desc(msg: Message, state: FSMContext):
            await state.update_data(description=msg.text); await state.set_state(CS.prod_content)
            await msg.answer("Содержимое товара (выдаётся после оплаты):")

        @r.message(CS.prod_content)
        async def p_content(msg: Message, state: FSMContext):
            data = await state.get_data(); await state.clear()
            async with AsyncSessionLocal() as db:
                db.add(Product(shop_id=sid, name=data["name"], price=data["price"],
                    category=data.get("category","Общее"), description=data.get("description",""),
                    content=msg.text))
                await db.commit()
            await msg.answer(f"✅ Товар <b>{data['name']}</b> добавлен!", parse_mode="HTML", reply_markup=admin_kb())

        @r.callback_query(F.data.startswith("cp_") & ~F.data.in_({"cp_add"}))
        async def prod_detail(cb: CallbackQuery):
            if await role(cb) != "admin": return
            pid = int(cb.data[3:])
            async with AsyncSessionLocal() as db:
                p = await db.get(Product, pid)
                if not p or p.shop_id!=sid: await cb.answer("Не найден"); return
            bld = InlineKeyboardBuilder()
            bld.row(InlineKeyboardButton(text="🔄 Скрыть/Показать", callback_data=f"cpt_{pid}"),
                    InlineKeyboardButton(text="🗑 Удалить",          callback_data=f"cpd_{pid}"))
            bld.row(InlineKeyboardButton(text="← Назад", callback_data="cpback"))
            await cb.message.edit_text(
                f"🛍 <b>{p.name}</b>\n💰 {fmt(p.price)}\n📂 {p.category}\n"
                f"Продано: {p.sold}\n{'✅' if p.is_active else '🔴'} {'Активен' if p.is_active else 'Скрыт'}",
                parse_mode="HTML", reply_markup=bld.as_markup()); await cb.answer()

        @r.callback_query(F.data.startswith("cpt_"))
        async def prod_toggle(cb: CallbackQuery):
            pid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                p=await db.get(Product,pid)
                if p and p.shop_id==sid: p.is_active=not p.is_active; await db.commit()
            await prod_detail(cb)

        @r.callback_query(F.data.startswith("cpd_"))
        async def prod_del(cb: CallbackQuery):
            pid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                p=await db.get(Product,pid)
                if p and p.shop_id==sid: await db.delete(p); await db.commit()
            await cb.message.edit_text("🗑 Товар удалён."); await cb.answer()

        @r.callback_query(F.data=="cpback")
        async def cpback(cb: CallbackQuery):
            await products_menu(cb.message); await cb.answer()

        # ── КАРТЫ (admin) ─────────────────────────────────────────────────────
        @r.message(F.text=="💳 Карты")
        async def cards_menu(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                cards = (await db.execute(select(PaymentCard).where(PaymentCard.shop_id==sid))).scalars().all()
            if not cards:
                await msg.answer("Карт нет.", reply_markup=ib(("➕ Добавить карту","ccard_add"))); return
            bld=InlineKeyboardBuilder(); txt="💳 <b>Пул карт:</b>\n\n"
            for c in cards:
                em="🟢" if c.is_active else "🔴"
                txt+=f"{em} {c.bank} · {c.number}\n   Получено: {fmt(c.received_total)}\n\n"
                bld.add(InlineKeyboardButton(text=f"{em}{c.bank}···{c.number[-4:]}", callback_data=f"ccd_{c.id}"))
            bld.adjust(2); bld.row(InlineKeyboardButton(text="➕ Добавить карту", callback_data="ccard_add"))
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data=="ccard_add")
        async def add_card(cb: CallbackQuery, state: FSMContext):
            if await role(cb) != "admin": return
            await state.set_state(CS.card_bank)
            await cb.message.answer("🏦 Введите название банка:", reply_markup=ReplyKeyboardRemove())
            await cb.answer()

        @r.message(CS.card_bank)
        async def cb_bank(msg: Message, state: FSMContext):
            await state.update_data(bank=msg.text); await state.set_state(CS.card_num)
            await msg.answer("Номер карты или номер для СБП:")

        @r.message(CS.card_num)
        async def cb_num(msg: Message, state: FSMContext):
            await state.update_data(number=msg.text); await state.set_state(CS.card_holder)
            await msg.answer("Имя владельца (ЛАТИНИЦА, CAPS):")

        @r.message(CS.card_holder)
        async def cb_holder(msg: Message, state: FSMContext):
            await state.update_data(holder=msg.text.upper()); await state.set_state(CS.card_phone)
            await msg.answer("Телефон для СБП (или '-'):")

        @r.message(CS.card_phone)
        async def cb_phone(msg: Message, state: FSMContext):
            data=await state.get_data(); await state.clear()
            async with AsyncSessionLocal() as db:
                db.add(PaymentCard(shop_id=sid, bank=data["bank"], number=data["number"],
                    holder=data["holder"], phone=msg.text if msg.text!="-" else "", is_active=True))
                await db.commit()
            await msg.answer(f"✅ Карта {data['bank']} добавлена в пул!", reply_markup=admin_kb())

        @r.callback_query(F.data.startswith("ccd_"))
        async def card_detail(cb: CallbackQuery):
            if await role(cb) != "admin": return
            cid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                c=await db.get(PaymentCard,cid)
                if not c or c.shop_id!=sid: await cb.answer("Не найдена"); return
            bld=InlineKeyboardBuilder()
            bld.row(InlineKeyboardButton(text="🔄 Вкл/Откл", callback_data=f"cct_{cid}"),
                    InlineKeyboardButton(text="🗑 Удалить",  callback_data=f"ccr_{cid}"))
            bld.row(InlineKeyboardButton(text="← Назад", callback_data="ccback"))
            await cb.message.edit_text(
                f"💳 <b>{c.bank}</b>\nНомер: <code>{c.number}</code>\n{c.holder}\n"
                f"{'СБП: '+c.phone+chr(10) if c.phone else ''}"
                f"Заказов: {c.orders_count} | Получено: {fmt(c.received_total)}\n"
                f"{'🟢 В пуле' if c.is_active else '🔴 Отключена'}",
                parse_mode="HTML", reply_markup=bld.as_markup()); await cb.answer()

        @r.callback_query(F.data.startswith("cct_"))
        async def card_toggle(cb: CallbackQuery):
            cid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                c=await db.get(PaymentCard,cid)
                if c and c.shop_id==sid: c.is_active=not c.is_active; await db.commit()
            await card_detail(cb)

        @r.callback_query(F.data.startswith("ccr_"))
        async def card_del(cb: CallbackQuery):
            cid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                c=await db.get(PaymentCard,cid)
                if c and c.shop_id==sid: await db.delete(c); await db.commit()
            await cb.message.edit_text("🗑 Карта удалена."); await cb.answer()

        @r.callback_query(F.data=="ccback")
        async def ccback(cb: CallbackQuery):
            await cards_menu(cb.message); await cb.answer()

        # ── КОМАНДА (admin) ───────────────────────────────────────────────────
        @r.message(F.text=="👥 Команда")
        async def team_menu(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                members=(await db.execute(select(ShopMember).where(ShopMember.shop_id==sid))).scalars().all()
            txt="👥 <b>Кассиры:</b>\n\n"
            bld=InlineKeyboardBuilder()
            for m in members:
                txt+=f"💼 {m.name} · {m.username}\nTG: <code>{m.telegram_id}</code>\n\n"
                bld.add(InlineKeyboardButton(text=f"🗑{m.name[:20]}", callback_data=f"cdm_{m.id}"))
            bld.adjust(2); bld.row(InlineKeyboardButton(text="➕ Добавить кассира", callback_data="cadd_mbr"))
            if not members: txt+="Кассиров нет."
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data=="cadd_mbr")
        async def add_mbr(cb: CallbackQuery, state: FSMContext):
            if await role(cb) != "admin": return
            await state.set_state(CS.mbr_id)
            await cb.message.answer("Введите Telegram ID кассира\n(узнать у @userinfobot):", reply_markup=ReplyKeyboardRemove())
            await cb.answer()

        @r.message(CS.mbr_id)
        async def mbr_id(msg: Message, state: FSMContext):
            try: tid=int(msg.text.strip())
            except: await msg.answer("❌ Только число"); return
            await state.update_data(tid=tid); await state.set_state(CS.mbr_name)
            await msg.answer("Имя кассира:")

        @r.message(CS.mbr_name)
        async def mbr_name(msg: Message, state: FSMContext):
            data=await state.get_data(); await state.clear()
            async with AsyncSessionLocal() as db:
                db.add(ShopMember(shop_id=sid, telegram_id=data["tid"], name=msg.text, role="moderator"))
                await db.commit()
            await msg.answer(f"✅ Кассир {msg.text} добавлен!\nПусть напишет /start боту управления.", reply_markup=admin_kb())

        @r.callback_query(F.data.startswith("cdm_"))
        async def del_mbr(cb: CallbackQuery):
            mid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                m=await db.get(ShopMember,mid)
                if m and m.shop_id==sid: await db.delete(m); await db.commit()
            await cb.message.edit_text("🗑 Кассир удалён."); await cb.answer()

        # ── ТОКЕНЫ (admin) ────────────────────────────────────────────────────
        @r.message(F.text=="⚙️ Токены")
        async def tokens_menu(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                toks=(await db.execute(select(ShopToken).where(ShopToken.shop_id==sid))).scalars().all()
            txt="⚙️ <b>Токены бота магазина:</b>\n\n"
            bld=InlineKeyboardBuilder()
            for t in toks:
                em="🟢" if t.is_active else "⬛"
                txt+=f"{em} <b>{t.username}</b> [{t.note}]\n{t.token[:20]}…\n\n"
                if not t.is_active:
                    bld.add(InlineKeyboardButton(text=f"🔀 Переключить на {t.username[:16]}", callback_data=f"tsw_{t.id}"))
            bld.adjust(1); bld.row(InlineKeyboardButton(text="➕ Добавить токен", callback_data="tadd"))
            txt+="⚠️ При блокировке бота — добавьте новый токен и переключитесь."
            await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

        @r.callback_query(F.data.startswith("tsw_"))
        async def token_switch(cb: CallbackQuery):
            if await role(cb) != "admin": return
            tid=int(cb.data[4:])
            async with AsyncSessionLocal() as db:
                toks=(await db.execute(select(ShopToken).where(ShopToken.shop_id==sid))).scalars().all()
                for t in toks: t.is_active=(t.id==tid)
                await db.commit()
            await cb.answer("✅ Токен переключён! Бот магазина перезапустится.", show_alert=True)
            await tokens_menu(cb.message)

        @r.callback_query(F.data=="tadd")
        async def token_add(cb: CallbackQuery, state: FSMContext):
            if await role(cb) != "admin": return
            await state.set_state(CS.tok_val)
            await cb.message.answer("Вставьте токен нового бота (@BotFather):", reply_markup=ReplyKeyboardRemove())
            await cb.answer()

        @r.message(CS.tok_val)
        async def tok_val(msg: Message, state: FSMContext):
            await state.update_data(token=msg.text.strip()); await state.set_state(CS.tok_user)
            await msg.answer("Username бота (например @myshop2_bot):")

        @r.message(CS.tok_user)
        async def tok_user(msg: Message, state: FSMContext):
            await state.update_data(username=msg.text.strip()); await state.set_state(CS.tok_note)
            await msg.answer("Метка токена (например 'Резервный #2'):")

        @r.message(CS.tok_note)
        async def tok_note(msg: Message, state: FSMContext):
            data=await state.get_data(); await state.clear()
            async with AsyncSessionLocal() as db:
                db.add(ShopToken(shop_id=sid, token=data["token"], username=data["username"], note=msg.text, is_active=False))
                await db.commit()
            await msg.answer(f"✅ Токен {data['username']} добавлен!\nДля переключения — раздел «⚙️ Токены»", reply_markup=admin_kb())

        # ── БАЛАНС (admin) ────────────────────────────────────────────────────
        @r.message(F.text=="💰 Баланс")
        async def balance(msg: Message):
            if await role(msg) != "admin": return
            async with AsyncSessionLocal() as db:
                shop=await db.get(Shop,sid); tenant=await db.get(Tenant,shop.tenant_id)
                txs=(await db.execute(select(BalanceTransaction)
                    .where(BalanceTransaction.tenant_id==tenant.id)
                    .order_by(desc(BalanceTransaction.created_at)).limit(5))).scalars().all()
            be="🔴" if tenant.balance<=0 else ("🟡" if tenant.balance<=tenant.alert_threshold else "🟢")
            txt=(f"💰 <b>Баланс BotFactory</b>\n{be} <b>{fmt(tenant.balance)}</b>\n"
                 f"⚠️ Порог: {fmt(tenant.alert_threshold)}\n\n")
            if tenant.balance<=0: txt+="🔴 Боты приостановлены!\n\n"
            if txs:
                txt+="<b>Последние транзакции:</b>\n"
                for tx in txs:
                    s="+" if tx.amount>0 else ""; em="💚" if tx.amount>0 else "📊"
                    txt+=f"{em} {s}{fmt(tx.amount)} — {tx.note[:40]}\n"
            await msg.answer(txt, parse_mode="HTML",
                reply_markup=ib(("💳 Реквизиты для пополнения","topup_req")))

        @r.callback_query(F.data=="topup_req")
        async def topup_req(cb: CallbackQuery):
            await cb.message.answer(
                "💳 <b>Реквизиты для пополнения BotFactory</b>\n\n"
                "🏦 Тинькофф: <code>5536 **** **** 0001</code>\n"
                "👤 ООО БОТФАКТОРИ\n\n"
                "📝 Назначение: <code>Пополнение BotFactory</code>\n"
                "⚠️ Обязательно укажите назначение!", parse_mode="HTML")
            await cb.answer()

    # ── Deliver product ────────────────────────────────────────────────────────
    async def _deliver(self, buyer_tg_id: int, content: str, order_id: int):
        try:
            async with AsyncSessionLocal() as db:
                tok=(await db.execute(select(ShopToken).where(
                    ShopToken.shop_id==self.shop_id, ShopToken.is_active==True)
                )).scalar_one_or_none()
            if not tok: return
            bot=Bot(token=tok.token)
            await bot.send_message(buyer_tg_id,
                f"✅ <b>Оплата подтверждена!</b>\n\nЗаказ #{order_id}\n\n"
                f"<code>{content}</code>", parse_mode="HTML")
            await bot.session.close()
        except Exception as e:
            logger.error(f"_deliver: {e}")

    # ── Notify cashiers (вызывается из shop_bot) ───────────────────────────────
    async def notify_cashiers(self, order_id: int, amount: float, buyer: str, file_id: str):
        try:
            async with AsyncSessionLocal() as db:
                members=(await db.execute(select(ShopMember).where(ShopMember.shop_id==self.shop_id))).scalars().all()
                shop=await db.get(Shop,self.shop_id); tenant=await db.get(Tenant,shop.tenant_id)
            recipients=[m.telegram_id for m in members]
            if tenant and tenant.telegram_id: recipients.append(tenant.telegram_id)
            if not recipients: return
            bot=Bot(token=self.token)
            bld=InlineKeyboardBuilder()
            bld.row(InlineKeyboardButton(text=f"✅ Подтвердить #{order_id}", callback_data=f"cc_{order_id}"),
                    InlineKeyboardButton(text="❌ Отклонить",                callback_data=f"cr_{order_id}"))
            caption=(f"🔔 <b>Новый платёж!</b>\n#{order_id} · {fmt(amount)}\n👤 @{buyer}")
            for uid in set(recipients):
                try:
                    await bot.send_photo(uid, photo=file_id, caption=caption,
                                          parse_mode="HTML", reply_markup=bld.as_markup())
                except Exception as e:
                    logger.warning(f"notify uid={uid}: {e}")
            await bot.session.close()
        except Exception as e:
            logger.error(f"notify_cashiers: {e}")

    async def run(self):
        storage=RedisStorage.from_url(settings.REDIS_URL+f"?db={self.shop_id%13+1}")
        bot=Bot(token=self.token); dp=Dispatcher(storage=storage)
        dp.include_router(self.router)
        logger.info(f"Ctrl bot: {self.name} (shop={self.shop_id})")
        try:
            await dp.start_polling(bot, allowed_updates=["message","callback_query"])
        finally:
            await bot.session.close()
