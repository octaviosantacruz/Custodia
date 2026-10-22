"""NSK-GOLDEN-001: golden release pair from the public Netskope documentation page.

This is the only non-tenant HTTP source of the tool. It is opt-in, anonymous and read-only: one exact HTTPS URL on
docs.netskope.com, no redirects, a short timeout and a bounded body. The result is a suggestion; it never feeds a KPI by
itself. Any shape change fails clearly instead of guessing a version."""

from __future__ import annotations

import os
import re

import httpx

from app.netskope.sse.integrations.netskope import NetskopeError, NetskopeNotConfigured

GOLDEN_RELEASE_URL = "https://docs.netskope.com/en/netskope-client-golden-release-updates"
MAX_BODY_BYTES = 2_000_000
TIMEOUT_SECONDS = 20.0
MIN_MAJOR, MAX_MAJOR = 50, 999

_ESCAPED_ANGLE = re.compile(r"\\u003([ce])", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_CURRENT = re.compile(r"Current\s+Golden\s+Release:\s*(\d{2,3})(?![\d.])")
_BETWEEN = re.compile(r"Golden\s+Release\s+Updates\s+Between\s+(\d{2,3})\.(\d+)\.(\d+)\s+and\s+(\d{2,3})\.(\d+)\.(\d+)")


def netskope_golden_release_configured() -> bool:
    return os.getenv("NETSKOPE_GOLDEN_RELEASE_URL", "").strip() == GOLDEN_RELEASE_URL


def parse_golden_releases(page: str) -> list[str]:
    """Newest-first ``["141.0.0", "138.0.0"]`` from the page text, or a NetskopeError when it cannot be trusted."""
    text = _TAG.sub(" ", _ESCAPED_ANGLE.sub(lambda m: "<" if m.group(1).lower() == "c" else ">", page))
    current = _CURRENT.search(text)
    if not current:
        raise NetskopeError("La página de golden releases no indica la release golden vigente")
    major = int(current.group(1))
    if not MIN_MAJOR <= major <= MAX_MAJOR:
        raise NetskopeError("La release golden vigente leída está fuera de rango")
    for match in _BETWEEN.finditer(text):
        low, high = tuple(int(match.group(i)) for i in (1, 2, 3)), tuple(int(match.group(i)) for i in (4, 5, 6))
        if high[0] == major and low < high and MIN_MAJOR <= low[0] <= MAX_MAJOR:
            return [f"{high[0]}.{high[1]}.{high[2]}", f"{low[0]}.{low[1]}.{low[2]}"]
    raise NetskopeError("La página de golden releases no indica la release golden anterior")


async def fetch_golden_releases(transport: httpx.AsyncBaseTransport | None = None) -> list[str]:
    if not netskope_golden_release_configured():
        raise NetskopeNotConfigured("NETSKOPE_GOLDEN_RELEASE_URL debe usar la URL aprobada")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=transport,
                                     headers={"User-Agent": "Custodia/1.0 (golden-release-check)"}) as client:
            async with client.stream("GET", GOLDEN_RELEASE_URL) as response:
                if response.status_code != 200:
                    raise NetskopeError(f"La página de golden releases respondió {response.status_code}")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BODY_BYTES:
                        raise NetskopeError("La página de golden releases supera el tamaño permitido")
    except httpx.HTTPError as error:
        raise NetskopeError("No se pudo leer la página de golden releases") from error
    return parse_golden_releases(body.decode("utf-8", errors="replace"))
