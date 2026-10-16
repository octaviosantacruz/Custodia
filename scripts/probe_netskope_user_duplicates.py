#!/usr/bin/env python3
"""Read-only probe: why DS Hub's Netskope user total differs from Netskope's own.

Reads users and the reported counts once, writes nothing, prints no secrets.
Run: scripts/run_with_database_secret.py -- env PYTHONPATH=backend backend/.venv/bin/python scripts/probe_netskope_user_duplicates.py
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeSettings
from app.netskope.sse.services.netskope_mapping import netskope_account_summary


async def main() -> None:
    async with NetskopeClient(NetskopeSettings.from_environment()) as client:
        users = await client.get_users()
        reported = (await client.get_user_counts()).get("totalUsers")
    ids = [str(user.get("id") or "") for user in users]
    deleted_rows = {n for n, user in enumerate(users) if (netskope_account_summary(user) or {}).get("deleted_only")}
    alive_rows = len(users) - len(deleted_rows)
    alive_distinct = len({ids[n] for n in range(len(users)) if n not in deleted_rows})
    positions: dict[str, list[int]] = defaultdict(list)
    for n, user_id in enumerate(ids):
        positions[user_id].append(n)
    repeated = {user_id: rows for user_id, rows in positions.items() if len(rows) > 1}

    print(f"Filas devueltas por la API de usuarios:      {len(users)}")
    print(f"Filas con todas sus cuentas borradas:        {len(deleted_rows)}")
    print(f"Filas vivas (lo que cuenta Netskope):        {alive_rows}   (totalUsers informado: {reported})")
    print(f"Usuarios vivos únicos (inventario DS Hub):   {alive_distinct}")
    print(f"Diferencia por repetidos:                    {alive_rows - alive_distinct}")
    print()
    for user_id, rows in sorted(repeated.items(), key=lambda item: item[1][0]):
        same = all(users[rows[0]] == users[row] for row in rows)
        print(f"  {user_id}  filas={rows}  contenido idéntico={same}")


if __name__ == "__main__":
    asyncio.run(main())
