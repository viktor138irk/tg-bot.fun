from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DEBUG: bool = False
    SECRET_KEY: str = "change-me"
    DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 20
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    PLATFORM_BOT_TOKEN: str = ""
    PLATFORM_ADMIN_IDS: str = ""
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000
    DOMAIN: str = ""
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    UPLOAD_DIR: str = "/opt/botfactory/uploads"
    MAX_UPLOAD_MB: int = 10
    COMMISSION_TRIAL_WEEK: int = 10
    COMMISSION_TRIAL: int = 10
    COMMISSION_BASIC: int = 7
    COMMISSION_PRO: int = 5
    COMMISSION_ENTERPRISE: int = 3
    COMMISSION_POSTPAID_DEFAULT: int = 5
    POSTPAID_DEFAULT_DUE_DAY: int = 5

    @property
    def admin_ids(self) -> List[int]:
        return [int(i.strip()) for i in self.PLATFORM_ADMIN_IDS.split(",")
                if i.strip().isdigit()]

    @property
    def commission(self) -> dict:
        return {
            "trial_week": self.COMMISSION_TRIAL_WEEK,
            "trial": self.COMMISSION_TRIAL,
            "basic": self.COMMISSION_BASIC,
            "pro": self.COMMISSION_PRO,
            "enterprise": self.COMMISSION_ENTERPRISE,
            "postpaid_custom": self.COMMISSION_POSTPAID_DEFAULT,
        }

    class Config:
        env_file = "/opt/botfactory/.env"
        extra = "ignore"


settings = Settings()
