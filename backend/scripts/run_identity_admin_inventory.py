"""Run the independent Identity Administration inventory synchronization."""

import asyncio
import os
from uuid import uuid4

from dotenv import load_dotenv

from app.db import create_pool
from app.identity_admin_sync import sync_identity_admin_inventory


async def main() -> None:
    load_dotenv(".env.local")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL es obligatorio")
    pool = create_pool(database_url)
    await pool.open()
    try:
        print(await sync_identity_admin_inventory(pool, uuid4()))
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
