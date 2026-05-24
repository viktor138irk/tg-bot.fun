from datetime import datetime
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime,
    ForeignKey, Text, BigInteger, Enum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
import enum


class PlanEnum(str, enum.Enum):
    trial_week = "trial_week"
    trial = "trial"
    basic = "basic"
    pro = "pro"
    enterprise = "enterprise"
    postpaid_custom = "postpaid_custom"


class OrderStatus(str, enum.Enum):
    pending    = "pending"
    confirming = "confirming"
    completed  = "completed"
    rejected   = "rejected"
    cancelled  = "cancelled"


class Tenant(Base):
    __tablename__ = "tenants"
    id:              Mapped[int]       = mapped_column(Integer, primary_key=True)
    name:            Mapped[str]       = mapped_column(String(128))
    email:           Mapped[str]       = mapped_column(String(256), unique=True)
    password_hash:   Mapped[str]       = mapped_column(String(256))
    telegram_id:     Mapped[int|None]  = mapped_column(BigInteger, nullable=True, index=True)
    plan:            Mapped[PlanEnum]  = mapped_column(Enum(PlanEnum), default=PlanEnum.trial_week)
    trial_ends_at:   Mapped[datetime|None] = mapped_column(DateTime, nullable=True)
    postpaid_commission_percent: Mapped[float] = mapped_column(Float, default=5.0)
    postpaid_due_day: Mapped[int] = mapped_column(Integer, default=5)
    postpaid_note:   Mapped[str] = mapped_column(String(512), default="")
    postpaid_enabled_at: Mapped[datetime|None] = mapped_column(DateTime, nullable=True)
    balance:         Mapped[float]     = mapped_column(Float, default=0.0)
    alert_threshold: Mapped[float]     = mapped_column(Float, default=200.0)
    is_active:       Mapped[bool]      = mapped_column(Boolean, default=True)
    is_blocked:      Mapped[bool]      = mapped_column(Boolean, default=False)
    created_at:      Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)

    shops:        Mapped[list["Shop"]]               = relationship(back_populates="tenant")
    transactions: Mapped[list["BalanceTransaction"]]  = relationship(back_populates="tenant")


class Shop(Base):
    __tablename__ = "shops"
    id:               Mapped[int]       = mapped_column(Integer, primary_key=True)
    tenant_id:        Mapped[int]       = mapped_column(ForeignKey("tenants.id"), index=True)
    name:             Mapped[str]       = mapped_column(String(128))
    ctrl_bot_token:   Mapped[str]       = mapped_column(String(128))
    ctrl_bot_username:Mapped[str]       = mapped_column(String(64), default="")
    welcome_msg:      Mapped[str]       = mapped_column(Text, default="Добро пожаловать!")
    is_active:        Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:       Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)

    tenant:    Mapped["Tenant"]             = relationship(back_populates="shops")
    tokens:    Mapped[list["ShopToken"]]    = relationship(back_populates="shop")
    products:  Mapped[list["Product"]]      = relationship(back_populates="shop")
    cards:     Mapped[list["PaymentCard"]]  = relationship(back_populates="shop")
    orders:    Mapped[list["Order"]]        = relationship(back_populates="shop")
    team:      Mapped[list["ShopMember"]]   = relationship(back_populates="shop")


class ShopToken(Base):
    __tablename__ = "shop_tokens"
    id:        Mapped[int]      = mapped_column(Integer, primary_key=True)
    shop_id:   Mapped[int]      = mapped_column(ForeignKey("shops.id"), index=True)
    token:     Mapped[str]      = mapped_column(String(128))
    username:  Mapped[str]      = mapped_column(String(64), default="")
    note:      Mapped[str]      = mapped_column(String(64), default="Основной")
    is_active: Mapped[bool]     = mapped_column(Boolean, default=False)
    added_at:  Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    shop: Mapped["Shop"] = relationship(back_populates="tokens")


class ShopMember(Base):
    __tablename__ = "shop_members"
    id:          Mapped[int]      = mapped_column(Integer, primary_key=True)
    shop_id:     Mapped[int]      = mapped_column(ForeignKey("shops.id"), index=True)
    telegram_id: Mapped[int]      = mapped_column(BigInteger, index=True)
    username:    Mapped[str]      = mapped_column(String(64), default="")
    name:        Mapped[str]      = mapped_column(String(128))
    role:        Mapped[str]      = mapped_column(String(32), default="moderator")
    added_at:    Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    shop: Mapped["Shop"] = relationship(back_populates="team")


class Product(Base):
    __tablename__ = "products"
    id:          Mapped[int]       = mapped_column(Integer, primary_key=True)
    shop_id:     Mapped[int]       = mapped_column(ForeignKey("shops.id"), index=True)
    name:        Mapped[str]       = mapped_column(String(256))
    category:    Mapped[str]       = mapped_column(String(64), default="Общее")
    description: Mapped[str]       = mapped_column(Text, default="")
    content:     Mapped[str]       = mapped_column(Text, default="")
    photo_url:   Mapped[str|None]  = mapped_column(String(512), nullable=True)
    price:       Mapped[float]     = mapped_column(Float)
    stock:       Mapped[int]       = mapped_column(Integer, default=999)
    sold:        Mapped[int]       = mapped_column(Integer, default=0)
    is_active:   Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:  Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)

    shop: Mapped["Shop"] = relationship(back_populates="products")


class PaymentCard(Base):
    __tablename__ = "payment_cards"
    id:             Mapped[int]   = mapped_column(Integer, primary_key=True)
    shop_id:        Mapped[int]   = mapped_column(ForeignKey("shops.id"), index=True)
    bank:           Mapped[str]   = mapped_column(String(64))
    number:         Mapped[str]   = mapped_column(String(32))
    holder:         Mapped[str]   = mapped_column(String(128))
    phone:          Mapped[str]   = mapped_column(String(32), default="")
    is_active:      Mapped[bool]  = mapped_column(Boolean, default=True)
    orders_count:   Mapped[int]   = mapped_column(Integer, default=0)
    received_total: Mapped[float] = mapped_column(Float, default=0.0)

    shop: Mapped["Shop"] = relationship(back_populates="cards")


class Order(Base):
    __tablename__ = "orders"
    id:                 Mapped[int]          = mapped_column(Integer, primary_key=True)
    shop_id:            Mapped[int]          = mapped_column(ForeignKey("shops.id"), index=True)
    product_id:         Mapped[int]          = mapped_column(ForeignKey("products.id"))
    card_id:            Mapped[int|None]     = mapped_column(ForeignKey("payment_cards.id"), nullable=True)
    buyer_telegram_id:  Mapped[int]          = mapped_column(BigInteger, index=True)
    buyer_username:     Mapped[str]          = mapped_column(String(64), default="")
    amount:             Mapped[float]        = mapped_column(Float)
    commission:         Mapped[float]        = mapped_column(Float, default=0.0)
    status:             Mapped[OrderStatus]  = mapped_column(Enum(OrderStatus), default=OrderStatus.pending, index=True)
    proof_file_id:      Mapped[str|None]     = mapped_column(String(256), nullable=True)
    confirmed_by:       Mapped[int|None]     = mapped_column(BigInteger, nullable=True)
    product_content:    Mapped[str]          = mapped_column(Text, default="")
    created_at:         Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at:         Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    shop: Mapped["Shop"] = relationship(back_populates="orders")


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"
    id:            Mapped[int]      = mapped_column(Integer, primary_key=True)
    tenant_id:     Mapped[int]      = mapped_column(ForeignKey("tenants.id"), index=True)
    type:          Mapped[str]      = mapped_column(String(32))  # deposit / commission / refund
    amount:        Mapped[float]    = mapped_column(Float)
    balance_after: Mapped[float]    = mapped_column(Float)
    note:          Mapped[str]      = mapped_column(String(512), default="")
    order_id:      Mapped[int|None] = mapped_column(Integer, nullable=True)
    created_at:    Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="transactions")
