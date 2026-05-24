"""BotFactory — Platform Admin Bot (системный бот платформы)"""
import asyncio, logging, inspect
from functools import wraps
from datetime import datetime, timedelta
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import (Message, CallbackQuery,
    InlineKeyboardButton, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder
from sqlalchemy import select, func, desc
from config import settings
from database import AsyncSessionLocal
from models import Tenant, Shop, ShopToken, Product, PaymentCard, Order, BalanceTransaction, OrderStatus, PlanEnum
from billing import (current_due_date, is_postpaid, plan_title,
    postpaid_previous_month_totals, tenant_can_sell)

logger = logging.getLogger("platform_bot")
router = Router()


# ── Guards ────────────────────────────────────────────────────────────────────
def is_admin(uid: int) -> bool:
    return uid in settings.admin_ids

def guard(fn):
    sig = inspect.signature(fn)
    accepted = set(sig.parameters.keys())

    @wraps(fn)
    async def w(event, *a, **kw):
        uid = event.from_user.id
        if not is_admin(uid):
            t = event.answer if isinstance(event, Message) else event.answer
            await t("⛔ Доступ запрещён.", show_alert=True) if isinstance(event, CallbackQuery) else await t("⛔ Доступ запрещён.")
            return
        # aiogram 3 passes service kwargs (bot, dispatcher, event_from_user, ...).
        # Wrapped handlers must receive only arguments they declared.
        clean_kw = {k: v for k, v in kw.items() if k in accepted}
        return await fn(event, *a, **clean_kw)
    return w


# ── States ────────────────────────────────────────────────────────────────────
class S(StatesGroup):
    topup_amount = State()
    topup_note   = State()
    broadcast    = State()
    bcast_ok     = State()
    plan_percent = State()
    plan_due_day = State()


# ── Keyboards ─────────────────────────────────────────────────────────────────
def main_kb():
    b = ReplyKeyboardBuilder()
    b.row(KeyboardButton(text="📊 Статистика"), KeyboardButton(text="👥 Пользователи"))
    b.row(KeyboardButton(text="💰 Балансы"),    KeyboardButton(text="📦 Заказы"))
    b.row(KeyboardButton(text="📢 Рассылка"),   KeyboardButton(text="⚙️ Настройки"))
    b.row(KeyboardButton(text="🧾 Постоплата"))
    return b.as_markup(resize_keyboard=True)

def ib(*rows):
    bld = InlineKeyboardBuilder()
    for row in rows:
        if isinstance(row, list):
            bld.row(*[InlineKeyboardButton(text=t, callback_data=d) for t, d in row])
        else:
            bld.add(InlineKeyboardButton(text=row[0], callback_data=row[1]))
    return bld.as_markup()

def fmt(v: float) -> str:
    return f"{v:,.0f}".replace(",", " ") + " ₽"

def bal_em(b: float, t: float) -> str:
    return "🔴" if b <= 0 else ("🟡" if b <= t else "🟢")


# ── /start ────────────────────────────────────────────────────────────────────
@router.message(Command("start"))
@guard
async def start(msg: Message, state: FSMContext):
    await state.clear()
    await msg.answer(
        f"👋 <b>BotFactory Admin</b>\n{msg.from_user.full_name}\n"
        f"ID: <code>{msg.from_user.id}</code>",
        reply_markup=main_kb(), parse_mode="HTML")


# ── Статистика ────────────────────────────────────────────────────────────────
@router.message(F.text == "📊 Статистика")
@guard
async def stats(msg: Message):
    async with AsyncSessionLocal() as db:
        n_all   = (await db.execute(select(func.count(Tenant.id)))).scalar()
        n_act   = (await db.execute(select(func.count(Tenant.id)).where(Tenant.is_active==True))).scalar()
        n_blk   = (await db.execute(select(func.count(Tenant.id)).where(Tenant.is_blocked==True))).scalar()
        n_low   = (await db.execute(select(func.count(Tenant.id)).where(Tenant.balance>0, Tenant.balance<=Tenant.alert_threshold))).scalar()
        n_zero  = (await db.execute(select(func.count(Tenant.id)).where(Tenant.balance<=0, Tenant.is_active==True))).scalar()
        turn    = (await db.execute(select(func.sum(Order.amount)).where(Order.status==OrderStatus.completed))).scalar() or 0
        comm    = (await db.execute(select(func.sum(Order.commission)).where(Order.status==OrderStatus.completed))).scalar() or 0
        pending = (await db.execute(select(func.count(Order.id)).where(Order.status.in_([OrderStatus.pending,OrderStatus.confirming])))).scalar()
        today   = datetime.utcnow().replace(hour=0,minute=0,second=0,microsecond=0)
        orders_td = (await db.execute(select(func.count(Order.id)).where(Order.status==OrderStatus.completed, Order.created_at>=today))).scalar()

    txt = (
        f"📊 <b>Статистика платформы</b>\n<i>{datetime.now():%d.%m.%Y %H:%M}</i>\n{'─'*28}\n\n"
        f"👥 Пользователей: <b>{n_all}</b> (активных {n_act})\n"
        f"🔴 Заблокировано: <b>{n_blk}</b>\n🟡 Низкий баланс: <b>{n_low}</b>\n"
        f"🔴 Баланс=0: <b>{n_zero}</b>\n\n"
        f"💰 Оборот: <b>{fmt(turn)}</b>\n📊 Комиссия: <b>{fmt(comm)}</b>\n\n"
        f"📦 Заказов сегодня: <b>{orders_td}</b>\n⏳ На подтверждении: <b>{pending}</b>"
    )
    await msg.answer(txt, parse_mode="HTML", reply_markup=ib(("🔄 Обновить","stats_ref")))

@router.callback_query(F.data=="stats_ref")
@guard
async def stats_ref(cb: CallbackQuery):
    await stats(cb.message); await cb.answer("Обновлено")


# ── Пользователи ──────────────────────────────────────────────────────────────
@router.message(F.text == "👥 Пользователи")
@guard
async def users(msg: Message):
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).order_by(desc(Tenant.created_at)).limit(20)
        )).scalars().all()
    if not tenants:
        await msg.answer("Нет пользователей."); return
    bld = InlineKeyboardBuilder()
    txt = "👥 <b>Пользователи</b>\n\n"
    for t in tenants:
        em = "🔒" if t.is_blocked else ("🔴" if t.balance<=0 else "✅")
        txt += f"{em} <b>{t.name}</b> · {t.email}\n   📦 {plan_title(t.plan)} · {bal_em(t.balance,t.alert_threshold)} {fmt(t.balance)}\n\n"
        bld.add(InlineKeyboardButton(text=f"{em} {t.name[:22]}", callback_data=f"t_{t.id}"))
    bld.adjust(2)
    await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

@router.callback_query(F.data.startswith("t_"))
@guard
async def tenant_detail(cb: CallbackQuery, state: FSMContext):
    data = cb.data or ""
    if data.startswith("t_"):
        tid = int(data[2:])
    elif data.startswith("blk_"):
        tid = int(data[4:])
    elif data.startswith("setplan_"):
        tid = int(data[len("setplan_"):].split("_", 1)[0])
    else:
        await cb.answer("Не удалось определить пользователя", show_alert=True)
        return
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
        if not t:
            await cb.answer("Не найден", show_alert=True)
            return
        shops_n = (await db.execute(select(func.count(Shop.id)).where(Shop.tenant_id == tid))).scalar()
        trial_txt = f"\n🧪 Тест до: <b>{t.trial_ends_at:%d.%m.%Y}</b>" if t.trial_ends_at else ""
        postpaid_txt = ""
        if is_postpaid(t):
            revenue, due = await postpaid_previous_month_totals(db, tid)
            due_date = current_due_date(t)
            postpaid_txt = (
                f"\n🧾 Постоплата: <b>{t.postpaid_commission_percent:g}%</b> от выручки прошлого месяца"
                f"\n📅 Оплата до: <b>{due_date:%d.%m.%Y}</b>"
                f"\n📈 Прошлый месяц: {fmt(revenue)} · к оплате {fmt(due)}"
            )
    txt = (
        f"👤 <b>{t.name}</b>\n{'─'*24}\n"
        f"📧 {t.email}\n🆔 TG: <code>{t.telegram_id or '—'}</code>\n"
        f"📦 Тариф: <b>{plan_title(t.plan)}</b>{trial_txt}{postpaid_txt}\n🏪 Магазинов: {shops_n}\n\n"
        f"{bal_em(t.balance,t.alert_threshold)} Баланс: <b>{fmt(t.balance)}</b>\n"
        f"⚠️ Порог: {fmt(t.alert_threshold)}\n"
        f"Статус: {'🔒 Заблокирован' if t.is_blocked else '✅ Активен'}"
    )
    bld = InlineKeyboardBuilder()
    bld.row(
        InlineKeyboardButton(text="💳 Пополнить", callback_data=f"topup_{tid}"),
        InlineKeyboardButton(text="🧾 Тариф", callback_data=f"plan_{tid}"),
    )
    bld.row(InlineKeyboardButton(
        text="🔒 Блок" if not t.is_blocked else "🔓 Разблок",
        callback_data=f"blk_{tid}",
    ))
    bld.row(InlineKeyboardButton(text="← Назад", callback_data="users_back"))
    await cb.message.edit_text(txt, parse_mode="HTML", reply_markup=bld.as_markup())
    await cb.answer()

@router.callback_query(F.data=="users_back")
@guard
async def users_back(cb: CallbackQuery):
    await users(cb.message); await cb.answer()

@router.callback_query(F.data.startswith("blk_"))
@guard
async def toggle_block(cb: CallbackQuery):
    tid = int(cb.data[4:])
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
        if not t: await cb.answer("Не найден"); return
        t.is_blocked = not t.is_blocked
        await db.commit()
    await cb.answer("🔒 Заблокирован" if t.is_blocked else "🔓 Разблокирован", show_alert=True)
    await tenant_detail(cb, None)




# ── Тарифы пользователей ─────────────────────────────────────────────────────
def plan_keyboard(tid: int):
    bld = InlineKeyboardBuilder()
    bld.row(InlineKeyboardButton(text="🧪 Тест 7 дней", callback_data=f"setplan_{tid}_trial_week"))
    bld.row(InlineKeyboardButton(text="Trial", callback_data=f"setplan_{tid}_trial"),
            InlineKeyboardButton(text="Basic", callback_data=f"setplan_{tid}_basic"))
    bld.row(InlineKeyboardButton(text="Pro", callback_data=f"setplan_{tid}_pro"),
            InlineKeyboardButton(text="Enterprise", callback_data=f"setplan_{tid}_enterprise"))
    bld.row(InlineKeyboardButton(text="🧾 Индивидуальный постоплатный", callback_data=f"postpaid_{tid}"))
    bld.row(InlineKeyboardButton(text="← Назад", callback_data=f"t_{tid}"))
    return bld.as_markup()


@router.callback_query(F.data.startswith("plan_"))
@guard
async def plan_menu(cb: CallbackQuery):
    tid = int(cb.data[5:])
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
        if not t:
            await cb.answer("Не найден", show_alert=True)
            return
    await cb.message.edit_text(
        f"🧾 <b>Тариф пользователя</b>\n\n👤 {t.name}\nТекущий: <b>{plan_title(t.plan)}</b>\n\n"
        "Постоплатный тариф применяется только вручную администратором.",
        parse_mode="HTML",
        reply_markup=plan_keyboard(tid),
    )
    await cb.answer()


@router.callback_query(F.data.startswith("setplan_"))
@guard
async def set_regular_plan(cb: CallbackQuery):
    raw = cb.data[len("setplan_"):]
    tid_raw, plan_raw = raw.split("_", 1)
    tid = int(tid_raw)
    if plan_raw not in {p.value for p in PlanEnum} or plan_raw == PlanEnum.postpaid_custom.value:
        await cb.answer("Некорректный тариф", show_alert=True)
        return
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
        if not t:
            await cb.answer("Не найден", show_alert=True)
            return
        t.plan = PlanEnum(plan_raw)
        t.trial_ends_at = datetime.utcnow() + timedelta(days=7) if plan_raw == PlanEnum.trial_week.value else None
        t.postpaid_enabled_at = None
        t.postpaid_note = ""
        if t.is_blocked and t.balance > 0:
            t.is_blocked = False
        await db.commit()
    await cb.answer("Тариф применён", show_alert=True)
    await tenant_detail(cb, None)


@router.callback_query(F.data.startswith("postpaid_"))
@guard
async def postpaid_start(cb: CallbackQuery, state: FSMContext):
    tid = int(cb.data[len("postpaid_"):])
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
        if not t:
            await cb.answer("Не найден", show_alert=True)
            return
    await state.update_data(tid=tid, tname=t.name)
    await state.set_state(S.plan_percent)
    await cb.message.answer(
        f"🧾 Индивидуальная постоплата для <b>{t.name}</b>\n\n"
        "Введите процент комиссии от выручки предыдущего месяца, например: 5",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardRemove(),
    )
    await cb.answer()


@router.message(S.plan_percent)
@guard
async def postpaid_percent(msg: Message, state: FSMContext):
    try:
        percent = float(msg.text.replace(",", ".").replace(" ", ""))
        assert 0 < percent <= 100
    except Exception:
        await msg.answer("❌ Введите процент числом от 0.1 до 100, например: 5")
        return
    await state.update_data(percent=percent)
    await state.set_state(S.plan_due_day)
    await msg.answer("📅 Введите день месяца для оплаты комиссии: 1–28")


@router.message(S.plan_due_day)
@guard
async def postpaid_due_day(msg: Message, state: FSMContext):
    try:
        day = int(msg.text.strip())
        assert 1 <= day <= 28
    except Exception:
        await msg.answer("❌ Введите день месяца числом от 1 до 28")
        return
    data = await state.get_data()
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, data["tid"])
        if not t:
            await state.clear()
            await msg.answer("Пользователь не найден.", reply_markup=main_kb())
            return
        t.plan = PlanEnum.postpaid_custom
        t.trial_ends_at = None
        t.postpaid_commission_percent = float(data["percent"])
        t.postpaid_due_day = day
        t.postpaid_enabled_at = datetime.utcnow()
        t.postpaid_note = f"Назначено администратором {msg.from_user.id}"
        t.is_blocked = False
        await db.commit()
    await state.clear()
    await msg.answer(
        f"✅ Постоплатный тариф применён\n\n👤 {data['tname']}\n"
        f"Комиссия: <b>{data['percent']:g}%</b> от выручки прошлого месяца\n"
        f"Оплата: до <b>{day}</b> числа каждого месяца",
        parse_mode="HTML",
        reply_markup=main_kb(),
    )


@router.message(F.text == "🧾 Постоплата")
@guard
async def postpaid_report(msg: Message):
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.plan == PlanEnum.postpaid_custom).order_by(Tenant.name.asc())
        )).scalars().all()
        if not tenants:
            await msg.answer("🧾 Постоплатных пользователей пока нет.")
            return
        lines = ["🧾 <b>Индивидуальная постоплата</b>\n"]
        for t in tenants:
            revenue, due = await postpaid_previous_month_totals(db, t.id)
            due_date = current_due_date(t)
            lines.append(
                f"👤 <b>{t.name}</b> · {t.postpaid_commission_percent:g}%\n"
                f"   Выручка прошлого месяца: {fmt(revenue)}\n"
                f"   К оплате: <b>{fmt(due)}</b> до {due_date:%d.%m.%Y}\n"
            )
    await msg.answer("\n".join(lines), parse_mode="HTML")


# ── Балансы ───────────────────────────────────────────────────────────────────
@router.message(F.text == "💰 Балансы")
@guard
async def balances(msg: Message):
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.is_active==True).order_by(Tenant.balance.asc())
        )).scalars().all()
    crit, low, ok_list = [], [], []
    for t in tenants:
        line = f"{bal_em(t.balance,t.alert_threshold)} <b>{t.name[:20]}</b>: {fmt(t.balance)}"
        if t.balance <= 0:   crit.append(line + " 🔴 СТОП")
        elif t.balance <= t.alert_threshold: low.append(line)
        else: ok_list.append(line)
    txt = "💰 <b>Балансы</b>\n\n"
    if crit: txt += "🔴 <b>Критично:</b>\n" + "\n".join(crit) + "\n\n"
    if low:  txt += "🟡 <b>Низкий:</b>\n"   + "\n".join(low)  + "\n\n"
    txt += f"🟢 В норме: {len(ok_list)}"
    await msg.answer(txt, parse_mode="HTML",
                     reply_markup=ib(("🔄 Обновить","bal_ref")))

@router.callback_query(F.data=="bal_ref")
@guard
async def bal_ref(cb: CallbackQuery):
    await balances(cb.message); await cb.answer("Обновлено")


# ── Пополнение баланса ────────────────────────────────────────────────────────
@router.callback_query(F.data.startswith("topup_"))
@guard
async def topup_start(cb: CallbackQuery, state: FSMContext):
    tid = int(cb.data[6:])
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, tid)
    await state.update_data(tid=tid, tname=t.name, tbal=t.balance)
    await state.set_state(S.topup_amount)
    await cb.message.answer(
        f"💳 Пополнение: <b>{t.name}</b>\nБаланс: {fmt(t.balance)}\n\nВведите сумму (₽):",
        parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
    await cb.answer()

@router.message(S.topup_amount)
@guard
async def topup_amount(msg: Message, state: FSMContext):
    try:
        amt = float(msg.text.replace(",",".").replace(" ",""))
        assert amt > 0
    except:
        await msg.answer("❌ Введите сумму, например: 1000"); return
    await state.update_data(amt=amt)
    await state.set_state(S.topup_note)
    await msg.answer(f"Сумма: <b>{fmt(amt)}</b>\nКомментарий (или '-'):", parse_mode="HTML")

@router.message(S.topup_note)
@guard
async def topup_note(msg: Message, state: FSMContext):
    data = await state.get_data()
    note = msg.text if msg.text != "-" else "Пополнение администратором"
    amt  = data["amt"]
    async with AsyncSessionLocal() as db:
        t = await db.get(Tenant, data["tid"])
        old = t.balance
        t.balance += amt
        if old <= 0 and t.balance > 0:
            t.is_blocked = False
        db.add(BalanceTransaction(
            tenant_id=t.id, type="deposit", amount=amt,
            balance_after=t.balance, note=f"[Admin] {note}"))
        await db.commit()
    await state.clear()
    await msg.answer(
        f"✅ <b>Пополнено</b>\n{data['tname']}\n+{fmt(amt)}\nБаланс: {fmt(t.balance)}\n{note}",
        parse_mode="HTML", reply_markup=main_kb())
    # Уведомить владельца
    if t.telegram_id:
        try:
            bot = Bot(token=settings.PLATFORM_BOT_TOKEN)
            await bot.send_message(t.telegram_id,
                f"💰 <b>Баланс пополнен!</b>\n+{fmt(amt)}\nВаш баланс: {fmt(t.balance)}\n{note}",
                parse_mode="HTML")
            await bot.session.close()
        except Exception: pass




async def deliver_order(shop_id: int, buyer_tg_id: int, content: str, order_id: int) -> bool:
    try:
        async with AsyncSessionLocal() as db:
            tok = (await db.execute(select(ShopToken).where(
                ShopToken.shop_id == shop_id,
                ShopToken.is_active == True,
            ))).scalar_one_or_none()
        if not tok:
            logger.warning("order %s: active shop token not found", order_id)
            return False
        bot = Bot(token=tok.token)
        try:
            await bot.send_message(
                buyer_tg_id,
                f"✅ <b>Оплата подтверждена!</b>\n\nЗаказ #{order_id}\n\n<code>{content}</code>",
                parse_mode="HTML",
            )
            return True
        finally:
            await bot.session.close()
    except Exception as e:
        logger.error("deliver_order #%s failed: %s", order_id, e)
        return False


# ── Заказы ────────────────────────────────────────────────────────────────────
@router.message(F.text == "📦 Заказы")
@guard
async def orders_menu(msg: Message):
    async with AsyncSessionLocal() as db:
        pending = (await db.execute(
            select(Order)
            .where(Order.status.in_([OrderStatus.pending, OrderStatus.confirming]))
            .order_by(Order.created_at.asc()).limit(10)
        )).scalars().all()
    if not pending:
        await msg.answer("✅ Ожидающих заказов нет."); return
    txt = f"📦 <b>На подтверждении: {len(pending)}</b>\n\n"
    bld = InlineKeyboardBuilder()
    for o in pending:
        em = "🟡" if o.status==OrderStatus.pending else "🟠"
        txt += f"{em} #{o.id} · {fmt(o.amount)} · {o.created_at:%d.%m %H:%M}\n"
        bld.add(InlineKeyboardButton(text=f"{em}#{o.id}·{o.amount:.0f}₽", callback_data=f"ord_{o.id}"))
    bld.adjust(3)
    await msg.answer(txt, parse_mode="HTML", reply_markup=bld.as_markup())

@router.callback_query(F.data.startswith("ord_"))
@guard
async def order_detail(cb: CallbackQuery):
    oid = int(cb.data[4:])
    async with AsyncSessionLocal() as db:
        o = await db.get(Order, oid)
        if not o: await cb.answer("Не найден", show_alert=True); return
        shop = await db.get(Shop, o.shop_id)
    txt = (
        f"📦 <b>Заказ #{o.id}</b>\n{'─'*24}\n"
        f"🏪 {shop.name if shop else '—'}\n"
        f"👤 {o.buyer_username or o.buyer_telegram_id}\n"
        f"💰 {fmt(o.amount)} | Комиссия: {fmt(o.commission)}\n"
        f"📅 {o.created_at:%d.%m.%Y %H:%M}"
    )
    bld = InlineKeyboardBuilder()
    if o.status in [OrderStatus.pending, OrderStatus.confirming]:
        bld.row(InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"oc_{oid}"),
                InlineKeyboardButton(text="❌ Отклонить",   callback_data=f"or_{oid}"))
    bld.row(InlineKeyboardButton(text="← Назад", callback_data="orders_back"))
    if o.proof_file_id:
        await cb.message.answer_photo(photo=o.proof_file_id, caption=txt,
                                       parse_mode="HTML", reply_markup=bld.as_markup())
    else:
        await cb.message.edit_text(txt, parse_mode="HTML", reply_markup=bld.as_markup())
    await cb.answer()

@router.callback_query(F.data.startswith("oc_"))
@guard
async def order_confirm(cb: CallbackQuery):
    oid = int(cb.data[3:])
    charged_now = False
    async with AsyncSessionLocal() as db:
        o = await db.get(Order, oid)
        if not o or o.status not in [OrderStatus.pending, OrderStatus.confirming]:
            await cb.answer("Нельзя подтвердить", show_alert=True)
            return
        shop = await db.get(Shop, o.shop_id)
        tenant = await db.get(Tenant, shop.tenant_id) if shop else None
        ok, reason = tenant_can_sell(tenant)
        if not ok:
            await cb.answer(f"❌ {reason}", show_alert=True)
            return

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

        if tenant and not is_postpaid(tenant):
            old_balance = tenant.balance
            tenant.balance -= o.commission
            charged_now = True
            db.add(BalanceTransaction(
                tenant_id=tenant.id,
                type="commission",
                amount=-o.commission,
                balance_after=tenant.balance,
                note=f"Комиссия заказ #{oid}",
                order_id=oid,
            ))
            if old_balance > 0 and tenant.balance <= 0:
                tenant.is_blocked = True
        elif tenant:
            db.add(BalanceTransaction(
                tenant_id=tenant.id,
                type="postpaid_accrual",
                amount=0,
                balance_after=tenant.balance,
                note=f"Начислена постоплатная комиссия {fmt(o.commission)} за заказ #{oid}",
                order_id=oid,
            ))

        shop_id = o.shop_id
        buyer_id = o.buyer_telegram_id
        content = o.product_content
        await db.commit()

    delivered = await deliver_order(shop_id, buyer_id, content, oid)
    suffix = "комиссия списана" if charged_now else "комиссия начислена в постоплату"
    delivery = "товар выдан" if delivered else "товар НЕ отправлен — нет активного токена магазина"
    text = f"✅ Заказ #{oid} подтверждён: {delivery}, {suffix}."
    if getattr(cb.message, "photo", None):
        await cb.message.edit_caption(caption=text, parse_mode="HTML")
    else:
        await cb.message.edit_text(text, parse_mode="HTML")
    await cb.answer("✅ Подтверждено!")

@router.callback_query(F.data.startswith("or_"))
@guard
async def order_reject(cb: CallbackQuery):
    oid = int(cb.data[3:])
    async with AsyncSessionLocal() as db:
        o = await db.get(Order, oid)
        if o: o.status = OrderStatus.rejected; await db.commit()
    await cb.message.edit_text(f"❌ Заказ #{oid} отклонён.")
    await cb.answer("Отклонено")

@router.callback_query(F.data=="orders_back")
@guard
async def orders_back(cb: CallbackQuery):
    await orders_menu(cb.message); await cb.answer()


# ── Рассылка ──────────────────────────────────────────────────────────────────
@router.message(F.text == "📢 Рассылка")
@guard
async def broadcast_start(msg: Message, state: FSMContext):
    await state.set_state(S.broadcast)
    b = ReplyKeyboardBuilder(); b.add(KeyboardButton(text="❌ Отмена"))
    await msg.answer("📢 Введите текст рассылки (HTML):", reply_markup=b.as_markup(resize_keyboard=True))

@router.message(S.broadcast)
@guard
async def broadcast_text(msg: Message, state: FSMContext):
    if msg.text == "❌ Отмена":
        await state.clear(); await msg.answer("Отменено.", reply_markup=main_kb()); return
    await state.update_data(text=msg.text)
    await state.set_state(S.bcast_ok)
    async with AsyncSessionLocal() as db:
        n = (await db.execute(select(func.count(Tenant.id))
             .where(Tenant.telegram_id != None, Tenant.is_active==True))).scalar()
    bld = InlineKeyboardBuilder()
    bld.row(InlineKeyboardButton(text=f"✅ Отправить {n} польз.", callback_data="bcast_go"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="bcast_no"))
    await msg.answer(f"Предпросмотр:\n\n{msg.text}\n\n👥 Получателей: {n}",
                     parse_mode="HTML", reply_markup=bld.as_markup())

@router.callback_query(F.data=="bcast_go", S.bcast_ok)
@guard
async def broadcast_go(cb: CallbackQuery, state: FSMContext):
    data = await state.get_data(); await state.clear()
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.telegram_id!=None, Tenant.is_active==True)
        )).scalars().all()
    bot = Bot(token=settings.PLATFORM_BOT_TOKEN)
    sent = fail = 0
    for t in tenants:
        try:
            await bot.send_message(t.telegram_id, data["text"], parse_mode="HTML")
            sent += 1; await asyncio.sleep(0.05)
        except: fail += 1
    await bot.session.close()
    await cb.message.edit_text(f"📢 Рассылка завершена\n✅ {sent} · ❌ {fail}")
    await cb.answer()

@router.callback_query(F.data=="bcast_no")
@guard
async def broadcast_no(cb: CallbackQuery, state: FSMContext):
    await state.clear(); await cb.message.edit_text("Отменено."); await cb.answer()


# ── Настройки ─────────────────────────────────────────────────────────────────
@router.message(F.text == "⚙️ Настройки")
@guard
async def platform_settings(msg: Message):
    c = settings.commission
    txt = (
        f"⚙️ <b>Настройки платформы</b>\n\n"
        f"Комиссии:\n  Тест 7 дней: {c['trial_week']}% | Trial: {c['trial']}% | Basic: {c['basic']}%\n"
        f"  Pro: {c['pro']}% | Enterprise: {c['enterprise']}% | Постоплата default: {c['postpaid_custom']}%\n\n"
        f"API: {settings.API_HOST}:{settings.API_PORT}\n"
        f"Domain: {settings.DOMAIN or '—'}"
    )
    await msg.answer(txt, parse_mode="HTML")


# ── Уведомления (вызываются из кода) ─────────────────────────────────────────
async def notify_admins(bot: Bot, text: str):
    for aid in settings.admin_ids:
        try: await bot.send_message(aid, text, parse_mode="HTML")
        except Exception as e: logger.warning(f"notify {aid}: {e}")

async def notify_zero_balance(bot: Bot, tenant: Tenant):
    await notify_admins(bot,
        f"🔴 <b>Баланс исчерпан — боты остановлены!</b>\n\n"
        f"👤 {tenant.name} ({tenant.email})\n"
        f"💰 Баланс: {fmt(tenant.balance)}\n\n/topup_{tenant.id}")

async def notify_low_balance(bot: Bot, tenant: Tenant):
    await notify_admins(bot,
        f"🟡 <b>Низкий баланс</b>\n\n"
        f"👤 {tenant.name}\n"
        f"💰 Баланс: {fmt(tenant.balance)} (порог {fmt(tenant.alert_threshold)})")


# ── Запуск ────────────────────────────────────────────────────────────────────
async def start_platform_bot():
    if not settings.PLATFORM_BOT_TOKEN:
        logger.warning("PLATFORM_BOT_TOKEN не задан — платформенный бот отключён")
        return
    storage = RedisStorage.from_url(settings.REDIS_URL)
    bot = Bot(token=settings.PLATFORM_BOT_TOKEN)
    dp  = Dispatcher(storage=storage)
    # If the previous polling attempt crashed inside the same process, aiogram
    # may keep the global router marked as attached. Detach it before reusing.
    try:
        if getattr(router, "parent_router", None) is not None:
            try:
                router.parent_router = None
            except Exception:
                setattr(router, "_parent_router", None)
    except Exception:
        pass
    dp.include_router(router)
    logger.info("Platform admin bot started")
    try:
        await dp.start_polling(bot, allowed_updates=["message","callback_query"])
    finally:
        await bot.session.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(start_platform_bot())
