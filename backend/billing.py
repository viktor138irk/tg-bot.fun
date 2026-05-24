from __future__ import annotations

from datetime import datetime, timedelta
from calendar import monthrange
from sqlalchemy import func, select

from config import settings
from models import Tenant, PlanEnum, Order, OrderStatus, Shop


PLAN_TITLES = {
    "trial_week": "Тест 7 дней",
    "trial": "Trial",
    "basic": "Basic",
    "pro": "Pro",
    "enterprise": "Enterprise",
    "postpaid_custom": "Индивидуальный постоплатный",
}


def plan_value(plan: PlanEnum | str | None) -> str:
    if plan is None:
        return "basic"
    return getattr(plan, "value", str(plan))


def plan_title(plan: PlanEnum | str | None) -> str:
    return PLAN_TITLES.get(plan_value(plan), plan_value(plan))


def is_postpaid(tenant: Tenant | None) -> bool:
    return bool(tenant and plan_value(tenant.plan) == PlanEnum.postpaid_custom.value)


def is_trial_week_expired(tenant: Tenant | None) -> bool:
    return bool(
        tenant
        and plan_value(tenant.plan) == PlanEnum.trial_week.value
        and tenant.trial_ends_at
        and tenant.trial_ends_at < datetime.utcnow()
    )


def tenant_can_sell(tenant: Tenant | None) -> tuple[bool, str]:
    if not tenant:
        return False, "Владелец магазина не найден."
    if not tenant.is_active or tenant.is_blocked:
        return False, "Магазин временно приостановлен."
    if is_trial_week_expired(tenant):
        return False, "Тестовый период закончился. Обратитесь к администрации."
    if not is_postpaid(tenant) and tenant.balance <= 0:
        return False, "Баланс BotFactory исчерпан. Магазин временно приостановлен."
    return True, ""


def commission_rate(tenant: Tenant | None) -> float:
    if not tenant:
        return float(settings.COMMISSION_BASIC)
    if is_postpaid(tenant):
        return float(tenant.postpaid_commission_percent or settings.COMMISSION_POSTPAID_DEFAULT)
    return float(settings.commission.get(plan_value(tenant.plan), settings.COMMISSION_BASIC))


def previous_month_range(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    first_this_month = datetime(now.year, now.month, 1)
    last_prev_day = first_this_month - timedelta(days=1)
    start = datetime(last_prev_day.year, last_prev_day.month, 1)
    end = first_this_month
    return start, end


def current_due_date(tenant: Tenant, now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    day = int(tenant.postpaid_due_day or settings.POSTPAID_DEFAULT_DUE_DAY or 5)
    day = max(1, min(28, day))
    last_day = monthrange(now.year, now.month)[1]
    return datetime(now.year, now.month, min(day, last_day), 23, 59, 59)


async def postpaid_previous_month_totals(db, tenant_id: int) -> tuple[float, float]:
    start, end = previous_month_range()
    revenue = (await db.execute(
        select(func.sum(Order.amount))
        .join(Shop, Order.shop_id == Shop.id)
        .where(
            Shop.tenant_id == tenant_id,
            Order.status == OrderStatus.completed,
            Order.created_at >= start,
            Order.created_at < end,
        )
    )).scalar() or 0
    commission = (await db.execute(
        select(func.sum(Order.commission))
        .join(Shop, Order.shop_id == Shop.id)
        .where(
            Shop.tenant_id == tenant_id,
            Order.status == OrderStatus.completed,
            Order.created_at >= start,
            Order.created_at < end,
        )
    )).scalar() or 0
    return float(revenue), float(commission)
