from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=10,
    echo=settings.DEBUG,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def _run_lightweight_migrations(conn):
    """Small safe migrations for the installer/update path.

    The project still uses SQLAlchemy create_all for first deployment. These
    ALTER statements keep existing installs alive when new billing fields are
    added before a full Alembic workflow appears.
    """
    dialect = conn.dialect.name
    if dialect != "postgresql":
        return

    # PostgreSQL enum values must be added before columns can use them.
    await conn.execute(text("ALTER TYPE planenum ADD VALUE IF NOT EXISTS 'trial_week'"))
    await conn.execute(text("ALTER TYPE planenum ADD VALUE IF NOT EXISTS 'postpaid_custom'"))

    await conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP NULL"))
    await conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postpaid_commission_percent DOUBLE PRECISION DEFAULT 5"))
    await conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postpaid_due_day INTEGER DEFAULT 5"))
    await conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postpaid_note VARCHAR(512) DEFAULT ''"))
    await conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postpaid_enabled_at TIMESTAMP NULL"))


async def init_db():
    # Import models here so Base.metadata is populated even when init_db is
    # called from worker entrypoints that did not import models yet.
    import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_lightweight_migrations(conn)
