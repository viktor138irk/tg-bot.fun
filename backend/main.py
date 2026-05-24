import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc

from config import settings
from database import AsyncSessionLocal, init_db
from models import (
    Tenant, Shop, ShopToken, Product, PaymentCard, Order,
    BalanceTransaction, OrderStatus, PlanEnum, ShopMember,
)
from billing import commission_rate, is_postpaid, tenant_can_sell, current_due_date, postpaid_previous_month_totals

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("botfactory")
APP_VERSION = "2.2.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting BotFactory API...")
    await init_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down BotFactory API")


app = FastAPI(
    title="BotFactory API",
    version=APP_VERSION,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_path = Path(settings.UPLOAD_DIR)
upload_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")


class TenantIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=3, max_length=256)
    telegram_id: Optional[int] = None
    balance: float = 0
    alert_threshold: float = 200
    plan: PlanEnum = PlanEnum.trial_week


class TenantTopupIn(BaseModel):
    amount: float = Field(gt=0)
    note: str = "Пополнение через веб-панель"


class TenantPlanIn(BaseModel):
    plan: PlanEnum
    postpaid_commission_percent: Optional[float] = None
    postpaid_due_day: Optional[int] = None


class ShopIn(BaseModel):
    tenant_id: int
    name: str = Field(min_length=1, max_length=128)
    ctrl_bot_token: str = Field(min_length=10, max_length=128)
    ctrl_bot_username: str = ""
    welcome_msg: str = "Добро пожаловать!"


class ProductIn(BaseModel):
    shop_id: int
    name: str = Field(min_length=1, max_length=256)
    price: float = Field(gt=0)
    category: str = "Общее"
    description: str = ""
    content: str = ""
    photo_url: Optional[str] = None
    stock: int = 1


class CardIn(BaseModel):
    shop_id: int
    bank: str = Field(min_length=1, max_length=64)
    number: str = Field(min_length=4, max_length=32)
    holder: str = Field(min_length=1, max_length=128)
    phone: str = ""


class TokenIn(BaseModel):
    shop_id: int
    token: str = Field(min_length=10, max_length=128)
    username: str = ""
    note: str = "Основной"
    is_active: bool = True


class MemberIn(BaseModel):
    shop_id: int
    telegram_id: int
    username: str = ""
    name: str = Field(min_length=1, max_length=128)
    role: str = "moderator"


def safe_dt(v):
    return v.isoformat() if v else None


def money(v) -> float:
    return float(v or 0)


async def serialize_tenant(db, t: Tenant):
    shops_count = (await db.execute(select(func.count(Shop.id)).where(Shop.tenant_id == t.id))).scalar() or 0
    revenue = (await db.execute(
        select(func.sum(Order.amount)).join(Shop, Order.shop_id == Shop.id)
        .where(Shop.tenant_id == t.id, Order.status == OrderStatus.completed)
    )).scalar() or 0
    commission = (await db.execute(
        select(func.sum(Order.commission)).join(Shop, Order.shop_id == Shop.id)
        .where(Shop.tenant_id == t.id, Order.status == OrderStatus.completed)
    )).scalar() or 0
    due = None
    prev_revenue = prev_due = 0
    if t.plan == PlanEnum.postpaid_custom:
        due = safe_dt(current_due_date(t))
        prev_revenue, prev_due = await postpaid_previous_month_totals(db, t.id)
    return {
        "id": t.id,
        "name": t.name,
        "email": t.email,
        "telegram_id": t.telegram_id,
        "plan": t.plan.value if t.plan else None,
        "trial_ends_at": safe_dt(t.trial_ends_at),
        "postpaid_commission_percent": t.postpaid_commission_percent,
        "postpaid_due_day": t.postpaid_due_day,
        "postpaid_due_date": due,
        "postpaid_previous_month_revenue": money(prev_revenue),
        "postpaid_previous_month_due": money(prev_due),
        "balance": money(t.balance),
        "alert_threshold": money(t.alert_threshold),
        "is_active": bool(t.is_active),
        "is_blocked": bool(t.is_blocked),
        "shops_count": int(shops_count),
        "total_revenue": money(revenue),
        "total_commission": money(commission),
        "created_at": safe_dt(t.created_at),
    }


async def serialize_shop(db, s: Shop):
    products_count = (await db.execute(select(func.count(Product.id)).where(Product.shop_id == s.id))).scalar() or 0
    orders_count = (await db.execute(select(func.count(Order.id)).where(Order.shop_id == s.id))).scalar() or 0
    revenue = (await db.execute(select(func.sum(Order.amount)).where(Order.shop_id == s.id, Order.status == OrderStatus.completed))).scalar() or 0
    active_token = (await db.execute(select(ShopToken).where(ShopToken.shop_id == s.id, ShopToken.is_active == True))).scalar_one_or_none()
    return {
        "id": s.id,
        "tenant_id": s.tenant_id,
        "name": s.name,
        "ctrl_bot_username": s.ctrl_bot_username,
        "ctrl_bot_token_set": bool(s.ctrl_bot_token),
        "welcome_msg": s.welcome_msg,
        "is_active": bool(s.is_active),
        "products_count": int(products_count),
        "orders_count": int(orders_count),
        "revenue": money(revenue),
        "active_shop_bot": active_token.username if active_token else None,
        "created_at": safe_dt(s.created_at),
    }


@app.get("/api/health", tags=["System"])
async def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/version", tags=["System"])
async def version():
    return {"version": APP_VERSION, "debug": settings.DEBUG, "domain": settings.DOMAIN or None}


@app.get("/api/admin/overview", tags=["Admin"])
async def admin_overview():
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(select(Tenant).order_by(desc(Tenant.created_at)))).scalars().all()
        shops = (await db.execute(select(Shop).order_by(desc(Shop.created_at)))).scalars().all()
        products = (await db.execute(select(Product).order_by(desc(Product.created_at)).limit(300))).scalars().all()
        cards = (await db.execute(select(PaymentCard).order_by(PaymentCard.id.desc()).limit(300))).scalars().all()
        tokens = (await db.execute(select(ShopToken).order_by(ShopToken.id.desc()).limit(300))).scalars().all()
        members = (await db.execute(select(ShopMember).order_by(ShopMember.id.desc()).limit(300))).scalars().all()
        orders = (await db.execute(select(Order).order_by(desc(Order.created_at)).limit(300))).scalars().all()
        tx = (await db.execute(select(BalanceTransaction).order_by(desc(BalanceTransaction.created_at)).limit(100))).scalars().all()

        stats = {
            "tenants": len(tenants),
            "shops": len(shops),
            "products": len(products),
            "cards": len(cards),
            "orders": len(orders),
            "pending_orders": int((await db.execute(select(func.count(Order.id)).where(Order.status.in_([OrderStatus.pending, OrderStatus.confirming])))).scalar() or 0),
            "turnover": money((await db.execute(select(func.sum(Order.amount)).where(Order.status == OrderStatus.completed))).scalar()),
            "commission": money((await db.execute(select(func.sum(Order.commission)).where(Order.status == OrderStatus.completed))).scalar()),
        }

        return {
            "stats": stats,
            "tenants": [await serialize_tenant(db, t) for t in tenants],
            "shops": [await serialize_shop(db, s) for s in shops],
            "products": [{
                "id": p.id, "shop_id": p.shop_id, "name": p.name, "category": p.category,
                "description": p.description, "content": p.content, "photo_url": p.photo_url,
                "price": money(p.price), "stock": p.stock, "sold": p.sold,
                "is_active": p.is_active, "created_at": safe_dt(p.created_at),
            } for p in products],
            "cards": [{
                "id": c.id, "shop_id": c.shop_id, "bank": c.bank, "number": c.number,
                "holder": c.holder, "phone": c.phone, "is_active": c.is_active,
                "orders_count": c.orders_count, "received_total": money(c.received_total),
            } for c in cards],
            "tokens": [{
                "id": t.id, "shop_id": t.shop_id, "username": t.username,
                "note": t.note, "is_active": t.is_active, "added_at": safe_dt(t.added_at),
                "token_masked": (t.token[:10] + "…" + t.token[-4:]) if t.token else "",
            } for t in tokens],
            "members": [{
                "id": m.id, "shop_id": m.shop_id, "telegram_id": m.telegram_id,
                "username": m.username, "name": m.name, "role": m.role,
                "added_at": safe_dt(m.added_at),
            } for m in members],
            "orders": [{
                "id": o.id, "shop_id": o.shop_id, "product_id": o.product_id, "card_id": o.card_id,
                "buyer_telegram_id": o.buyer_telegram_id, "buyer_username": o.buyer_username,
                "amount": money(o.amount), "commission": money(o.commission),
                "status": o.status.value if o.status else None, "proof_file_id": bool(o.proof_file_id),
                "confirmed_by": o.confirmed_by, "created_at": safe_dt(o.created_at),
                "updated_at": safe_dt(o.updated_at),
            } for o in orders],
            "transactions": [{
                "id": x.id, "tenant_id": x.tenant_id, "type": x.type,
                "amount": money(x.amount), "balance_after": money(x.balance_after),
                "note": x.note, "order_id": x.order_id, "created_at": safe_dt(x.created_at),
            } for x in tx],
        }


@app.post("/api/admin/tenants", tags=["Admin"])
async def create_tenant(data: TenantIn):
    async with AsyncSessionLocal() as db:
        exists = (await db.execute(select(Tenant).where(Tenant.email == data.email))).scalar_one_or_none()
        if exists:
            raise HTTPException(400, "Пользователь с таким email уже есть")
        tenant = Tenant(
            name=data.name, email=data.email, password_hash="manual-created",
            telegram_id=data.telegram_id, plan=data.plan,
            trial_ends_at=datetime.utcnow() + timedelta(days=7) if data.plan == PlanEnum.trial_week else None,
            balance=data.balance, alert_threshold=data.alert_threshold,
        )
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)
        return {"ok": True, "tenant": await serialize_tenant(db, tenant)}


@app.post("/api/admin/tenants/{tenant_id}/topup", tags=["Admin"])
async def topup_tenant(tenant_id: int, data: TenantTopupIn):
    async with AsyncSessionLocal() as db:
        tenant = await db.get(Tenant, tenant_id)
        if not tenant:
            raise HTTPException(404, "Пользователь не найден")
        tenant.balance += data.amount
        if tenant.balance > 0:
            tenant.is_blocked = False
        db.add(BalanceTransaction(
            tenant_id=tenant.id, type="deposit", amount=data.amount,
            balance_after=tenant.balance, note=data.note,
        ))
        await db.commit()
        return {"ok": True, "tenant": await serialize_tenant(db, tenant)}


@app.post("/api/admin/tenants/{tenant_id}/plan", tags=["Admin"])
async def set_tenant_plan(tenant_id: int, data: TenantPlanIn):
    async with AsyncSessionLocal() as db:
        tenant = await db.get(Tenant, tenant_id)
        if not tenant:
            raise HTTPException(404, "Пользователь не найден")
        tenant.plan = data.plan
        tenant.trial_ends_at = datetime.utcnow() + timedelta(days=7) if data.plan == PlanEnum.trial_week else None
        if data.plan == PlanEnum.postpaid_custom:
            tenant.postpaid_commission_percent = float(data.postpaid_commission_percent or settings.COMMISSION_POSTPAID_DEFAULT)
            tenant.postpaid_due_day = max(1, min(28, int(data.postpaid_due_day or settings.POSTPAID_DEFAULT_DUE_DAY)))
            tenant.postpaid_enabled_at = datetime.utcnow()
            tenant.postpaid_note = "Назначено через веб-панель"
            tenant.is_blocked = False
        else:
            tenant.postpaid_enabled_at = None
            tenant.postpaid_note = ""
        await db.commit()
        return {"ok": True, "tenant": await serialize_tenant(db, tenant)}


@app.post("/api/admin/tenants/{tenant_id}/toggle-block", tags=["Admin"])
async def toggle_tenant_block(tenant_id: int):
    async with AsyncSessionLocal() as db:
        tenant = await db.get(Tenant, tenant_id)
        if not tenant:
            raise HTTPException(404, "Пользователь не найден")
        tenant.is_blocked = not tenant.is_blocked
        await db.commit()
        return {"ok": True, "is_blocked": tenant.is_blocked}


@app.post("/api/admin/shops", tags=["Admin"])
async def create_shop(data: ShopIn):
    async with AsyncSessionLocal() as db:
        tenant = await db.get(Tenant, data.tenant_id)
        if not tenant:
            raise HTTPException(404, "Владелец не найден")
        shop = Shop(
            tenant_id=data.tenant_id, name=data.name,
            ctrl_bot_token=data.ctrl_bot_token, ctrl_bot_username=data.ctrl_bot_username,
            welcome_msg=data.welcome_msg,
        )
        db.add(shop)
        await db.commit()
        await db.refresh(shop)
        return {"ok": True, "shop": await serialize_shop(db, shop)}


@app.post("/api/admin/products", tags=["Admin"])
async def create_product(data: ProductIn):
    async with AsyncSessionLocal() as db:
        shop = await db.get(Shop, data.shop_id)
        if not shop:
            raise HTTPException(404, "Магазин не найден")
        product = Product(
            shop_id=data.shop_id, name=data.name, price=data.price, category=data.category,
            description=data.description, content=data.content, photo_url=data.photo_url,
            stock=max(0, data.stock), is_active=data.stock > 0,
        )
        db.add(product)
        await db.commit()
        await db.refresh(product)
        return {"ok": True, "id": product.id}


@app.post("/api/admin/cards", tags=["Admin"])
async def create_card(data: CardIn):
    async with AsyncSessionLocal() as db:
        shop = await db.get(Shop, data.shop_id)
        if not shop:
            raise HTTPException(404, "Магазин не найден")
        card = PaymentCard(shop_id=data.shop_id, bank=data.bank, number=data.number, holder=data.holder, phone=data.phone)
        db.add(card)
        await db.commit()
        await db.refresh(card)
        return {"ok": True, "id": card.id}


@app.post("/api/admin/tokens", tags=["Admin"])
async def create_token(data: TokenIn):
    async with AsyncSessionLocal() as db:
        shop = await db.get(Shop, data.shop_id)
        if not shop:
            raise HTTPException(404, "Магазин не найден")
        if data.is_active:
            rows = (await db.execute(select(ShopToken).where(ShopToken.shop_id == data.shop_id))).scalars().all()
            for row in rows:
                row.is_active = False
        token = ShopToken(
            shop_id=data.shop_id, token=data.token, username=data.username,
            note=data.note, is_active=data.is_active,
        )
        db.add(token)
        await db.commit()
        await db.refresh(token)
        return {"ok": True, "id": token.id}


@app.post("/api/admin/tokens/{token_id}/activate", tags=["Admin"])
async def activate_token(token_id: int):
    async with AsyncSessionLocal() as db:
        token = await db.get(ShopToken, token_id)
        if not token:
            raise HTTPException(404, "Токен не найден")
        rows = (await db.execute(select(ShopToken).where(ShopToken.shop_id == token.shop_id))).scalars().all()
        for row in rows:
            row.is_active = row.id == token.id
        await db.commit()
        return {"ok": True}


@app.post("/api/admin/members", tags=["Admin"])
async def create_member(data: MemberIn):
    async with AsyncSessionLocal() as db:
        shop = await db.get(Shop, data.shop_id)
        if not shop:
            raise HTTPException(404, "Магазин не найден")
        member = ShopMember(
            shop_id=data.shop_id, telegram_id=data.telegram_id,
            username=data.username, name=data.name, role=data.role,
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)
        return {"ok": True, "id": member.id}


@app.post("/api/admin/orders/{order_id}/reject", tags=["Admin"])
async def reject_order(order_id: int):
    async with AsyncSessionLocal() as db:
        order = await db.get(Order, order_id)
        if not order:
            raise HTTPException(404, "Заказ не найден")
        order.status = OrderStatus.rejected
        await db.commit()
        return {"ok": True}


async def deliver_order(shop_id: int, buyer_tg_id: int, content: str, order_id: int) -> bool:
    try:
        async with AsyncSessionLocal() as db:
            tok = (await db.execute(select(ShopToken).where(ShopToken.shop_id == shop_id, ShopToken.is_active == True))).scalar_one_or_none()
        if not tok:
            return False
        from aiogram import Bot
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


@app.post("/api/admin/orders/{order_id}/confirm", tags=["Admin"])
async def confirm_order_api(order_id: int):
    async with AsyncSessionLocal() as db:
        order = await db.get(Order, order_id)
        if not order or order.status not in [OrderStatus.pending, OrderStatus.confirming]:
            raise HTTPException(400, "Заказ нельзя подтвердить")
        shop = await db.get(Shop, order.shop_id)
        tenant = await db.get(Tenant, shop.tenant_id) if shop else None
        ok, reason = tenant_can_sell(tenant)
        if not ok:
            raise HTTPException(400, reason)
        product = await db.get(Product, order.product_id)
        card = await db.get(PaymentCard, order.card_id) if order.card_id else None
        order.status = OrderStatus.completed
        order.confirmed_by = 0
        if product:
            product.sold += 1
            if product.stock > 0:
                product.stock -= 1
            if product.stock <= 0:
                product.is_active = False
        if card:
            card.received_total += order.amount
        if tenant and not is_postpaid(tenant):
            old = tenant.balance
            tenant.balance -= order.commission
            db.add(BalanceTransaction(
                tenant_id=tenant.id, type="commission", amount=-order.commission,
                balance_after=tenant.balance, note=f"Комиссия заказ #{order_id}", order_id=order_id,
            ))
            if old > 0 and tenant.balance <= 0:
                tenant.is_blocked = True
        elif tenant:
            db.add(BalanceTransaction(
                tenant_id=tenant.id, type="postpaid_accrual", amount=0,
                balance_after=tenant.balance, note=f"Постоплатная комиссия {order.commission:.2f} за заказ #{order_id}",
                order_id=order_id,
            ))
        shop_id = order.shop_id
        buyer_id = order.buyer_telegram_id
        content = order.product_content
        await db.commit()
    delivered = await deliver_order(shop_id, buyer_id, content, order_id)
    return {"ok": True, "delivered": delivered}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.API_HOST, port=settings.API_PORT, reload=settings.DEBUG, loop="uvloop")
