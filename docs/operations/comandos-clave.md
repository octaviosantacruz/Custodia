---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# Comandos clave de Custodia

**Última revisión:** 2026-10-03. Chuleta de operación para el host de este
repositorio (`/home/ubuntu/Custodia`). No reemplaza a
[`deployment.md`](deployment.md): ahí está el porqué de cada decisión; aquí sólo
el comando. Todo se ejecuta desde la raíz del repo salvo que se indique otra cosa.

> Regla de oro: nunca imprimir ni pegar `DATABASE_URL`, `.env.local`,
> `.ca_secret`, tokens ni claves. Los comandos de abajo comprueban si algo
> *existe*, no muestran su valor.

## 1. Servicio (systemd)

```bash
sudo systemctl status custodia        # estado y últimos procesos
sudo systemctl restart custodia       # tras git pull, cambios de .env o de código
sudo systemctl stop custodia          # bajar todo (backend + vite preview)
sudo systemctl start custodia

tail -f /var/log/custodia/backend.log      # backend (uvicorn)
tail -f /var/log/custodia/frontend.log     # frontend (vite preview)
journalctl -u custodia -f                  # migraciones, build y supervisor
curl --fail --silent http://127.0.0.1:8000/api/health/ready   # backend listo
```

Cada reinicio corre `npm run deploy`: migraciones pendientes → build del
frontend → backend en `:8000` y `vite preview` en `:5173` (~10-15 s extra).
Un cambio en `.env.local` (por ejemplo `SYNC_SOURCE_INTERVALS`) exige reiniciar.

## 2. Migraciones y base de datos

```bash
scripts/migrate.sh                 # aplica las migraciones pendientes (idempotente)
npm run schema:baseline            # regenera migrations/baseline.sql tras una migración nueva
```

- Nunca se edita una migración ya aplicada: se agrega la siguiente
  (`migrations/NNN_descripcion.sql`).
- Consulta de sólo lectura con las credenciales ya configuradas, sin imprimirlas:

```bash
cat > /tmp/consulta.py <<'PY'
import os, psycopg
c = psycopg.connect(os.environ["DATABASE_URL"])
print(c.execute("select max(version) from public.schema_migrations").fetchall())
PY
backend/.venv/bin/python scripts/run_with_database_secret.py -- backend/.venv/bin/python /tmp/consulta.py
```

`run_with_database_secret.py` recupera la credencial vigente (AWS Secrets
Manager) sólo si la actual falla; el valor queda en memoria, nunca en disco.

## 3. Desarrollo local

```bash
npm run web                          # backend :8000 (con --reload) + frontend :5173
npm run web:backend                  # sólo backend
npm --prefix frontend run dev        # sólo frontend
npm run web:build                    # build del frontend
```

## 4. Verificación y pruebas

```bash
npm run verify                       # puerta completa antes de commitear (usa un Postgres efímero)
npm run verify:full                  # verify + E2E + auditoría de supply chain

# Backend
cd backend && .venv/bin/python -m unittest discover -s tests
cd backend && .venv/bin/python -m unittest tests.cross.test_sync_stages
cd backend && .venv/bin/python -m unittest tests.cross.test_sync_stages.StageRecorderTests.test_success_counts_items_and_skip_is_not_degraded

# Frontend
npm --prefix frontend run build              # typecheck + vite build
npm --prefix frontend run test:unit
npm --prefix frontend run lint            # oxlint: reglas de hooks (parte de verify)
npm --prefix frontend run verify:styles

# E2E por plataforma (mocks de API; no tocan el backend real)
npm --prefix frontend run test:e2e:netskope
npm --prefix frontend run test:e2e:cyberark      # PAM, Safes, SIA, Identity, postura
npm --prefix frontend run test:e2e:cross         # shell, dashboard, Personas

# Un spec o una prueba, en un puerto propio para no chocar con otra corrida
cd frontend && E2E_PORT=4391 npx playwright test tests/e2e/cross/sync-runs.spec.ts
cd frontend && E2E_PORT=4392 npx playwright test tests/e2e/netskope/sse/netskope.spec.ts -g "NSK-POSTURE-UX-001"
```

Si `verify` dice que Postgres no es alcanzable, las pruebas de integración se
omiten (aparecen como `skipped`): no equivale a haberlas pasado.

## 5. Procesos y puertos

Puertos del proyecto: **8000** backend · **5173** frontend (dev o preview) ·
**4173** `vite preview` de las pruebas E2E.

```bash
ss -ltnp | grep -E ':(8000|5173|4173)\b'          # quién escucha en cada puerto
ps -o pid,ppid,lstart,args -p <PID>               # qué es y desde cuándo corre
readlink /proc/<PID>/cwd                          # de qué directorio salió
kill <PID>                                        # cierre normal (SIGTERM)
kill -9 <PID>                                     # sólo si no responde
```

Antes de cerrar un proceso, mirar de dónde viene. Un `vite preview` huérfano
en `:4173` (resto de una corrida E2E interrumpida) se puede cerrar sin riesgo:

```bash
kill $(ss -ltnp | grep ':4173\b' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
```

Restos de Playwright:

```bash
pgrep -af "chrome-headless-shell|playwright"      # ver
pkill -f "chrome-headless-shell"                  # cerrar navegadores huérfanos
```

**Trampa de `pkill -f`:** coincide con la línea de comando completa, también
con la del propio shell que lo ejecuta si el comando menciona el patrón. Usar
el truco de los corchetes para que no se autocoincida:

```bash
pkill -f "[o]pencode serve"                       # en vez de pkill -f "opencode serve"
```

## 6. Git

```bash
git status --short
git log --oneline -10
git diff                                          # cambios sin stage
git diff --cached                                 # cambios en el índice
git remote -v                                     # itti, gvz, origin, Cybersecurity-Org
git push itti <rama>                              # push explícito al remoto elegido
```

No hay sincronización automática entre remotos y no se hace push sin decisión
explícita. El remoto activo es `itti` (requiere SSO/SSH).

## 7. Sincronización con las fuentes

La sincronización la ejecuta el coordinador dentro del backend; las corridas
manuales se disparan desde la pantalla **Actividad → Sincronizaciones** o por
API (`POST /api/ingestion/<fuente>/runs`, con sesión autorizada).

Variables (en `.env.local`, reiniciar `custodia` tras cambiarlas):

```bash
INGESTION_INTERVAL_MINUTES=60                     # intervalo por defecto; 0 = apagado
SYNC_SOURCE_INTERVALS={"netskope": 30}            # cadencia propia por fuente (0 o >= 5)
SYNC_MAX_CONCURRENT_SOURCES=3                     # fuentes simultáneas (1-5)
```

Lectura de sólo lectura / diagnóstico (no escriben en la base):

```bash
backend/.venv/bin/python scripts/review_identity_role_memberships.py     # coincidencias de membresía entre roles
scripts/probe_netskope_api.sh                                            # probe del catálogo Netskope (sólo status y forma)
scripts/probe_netskope_dlp_incidents_contract.sh
scripts/probe_cyberark_endpoint.sh      # y probe_sia_endpoint.sh: leer el encabezado de cada script antes
```

Los probes sólo registran status, forma y conteos; no ejecutarlos contra un
tenant sin autorización del dueño.

## 8. Dependencias Python

Parar el servicio **antes** de instalar paquetes en `backend/.venv` (Python
conserva módulos en memoria y una mezcla de versiones rompe las sincronizaciones):

```bash
sudo systemctl stop custodia
backend/.venv/bin/python -m pip install --require-hashes -r backend/requirements.lock.txt
backend/.venv/bin/python -m pip check
sudo systemctl start custodia
curl --fail --silent http://127.0.0.1:8000/api/health/ready
```

## 9. Archivos de entorno

Comparar `.env.example` con `.env.local` **sin mostrar valores** (sólo qué
claves faltan de cada lado):

```bash
python3 - <<'PY'
import re
def keys(p):
    return {m.group(1) for l in open(p, encoding="utf-8")
            if (m := re.match(r"#?\s*([A-Z][A-Z0-9_]*)=", l.strip()))}
a, b = keys(".env.example"), keys(".env.local")
print("sólo en example:", sorted(a - b))
print("sólo en local:  ", sorted(b - a))
PY
```

Comprobar que una variable está presente en un proceso en marcha (sin
imprimirla):

```bash
tr '\0' '\n' < /proc/<PID>/environ | grep -c '^NOMBRE_DE_LA_VARIABLE=.\+'     # 1 = presente
```

## 10. Trackers y agentes (OpenCode)

```bash
npm run harness:check                # IDs únicos entre TO_IMPLEMENT.md e IMPLEMENTED.md (índice y done/)
npm run docs:check                   # frontmatter, enlaces, rutas e IDs citados en la documentación
backend/.venv/bin/python scripts/generate_api_reference.py   # regenera docs/architecture/api-reference.md (el test lo exige al día)
backend/.venv/bin/python scripts/generate_access_catalog.py   # regenera docs/architecture/access-catalog.md (PostgreSQL efímero + migraciones)
npm run harness:test                 # pruebas del propio checker
opencode debug config                # configuración efectiva
```

Reglas efectivas de un agente (orchestrator, worker, reviewer), sin invocar
modelos:

```bash
opencode api GET '/api/agent?location%5Bdirectory%5D=%2Fhome%2Fubuntu%2FCustodia'
```

**Orden para trabajar con el CLI** (la clave de Command Code vive en
`~/.profile`, no en `~/.bashrc`):

```bash
source ~/.profile                    # si la terminal no es de login
[ -n "$COMMANDCODE_API_KEY" ] && echo "clave presente" || echo "FALTA"
cd ~/Custodia && opencode
```

Verificar que cada servidor de OpenCode tiene la clave en su entorno
(debe dar `1` por línea):

```bash
for p in /proc/[0-9]*; do
  case "$(readlink $p/exe 2>/dev/null)" in *opencode*)
    echo "$(basename $p): $(tr '\0' '\n' < $p/environ | grep -c '^COMMANDCODE_API_KEY=.\+')";;
  esac
done
```

Probar la clave con el modelo del worker (`/models` **no** sirve: responde 200
sin credenciales):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $COMMANDCODE_API_KEY" \
  -H "User-Agent: curl/8.5.0" -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-luna","max_tokens":5,"messages":[{"role":"user","content":"ok"}]}' \
  https://api.commandcode.ai/provider/v1/chat/completions       # 200 = válida; 401 = renovar
```

Reglas de shell para los agentes: un comando por llamada, literal, sin `cd`,
`&&`, `;`, `|` ni redirecciones; si algo se deniega, reportar acción y
recurso exactos (detalle en `.opencode/README.md`).

## 11. Diagnóstico rápido

| Síntoma | Comprobar |
|---|---|
| El sitio no responde | `systemctl status custodia`, `journalctl -u custodia -n 100`, `curl .../api/health/ready` |
| Una sincronización falla con `ImportError` | Se actualizaron paquetes con el backend activo: reiniciar (sección 8) |
| `Error: http://127.0.0.1:4173 is already used` | Preview E2E huérfano: sección 5 |
| E2E de postura Netskope agota el tiempo en la corrida completa | Intermitente conocido (`NSK-E2E-TIME-001`): repetirlo solo con `-g` |
| Worker de OpenCode: `Invalid 'Authorization' header` | Servidor sin `COMMANDCODE_API_KEY`: sección 10 |
| `verify` omite pruebas de Postgres | No hay Postgres alcanzable; no cuenta como pasadas |

## 12. Worktrees por tarea

No se crean a mano: `/custodia-task <ID>` (orchestrator) y `/custodia-goal <ID>` (modo
noche) corren `scripts/wt.sh new <ID>` y trabajan en `../Custodia-wt/<ID>`, rama
`task/<ID>` (detalle en `.opencode/README.md`). Los enlaces a `node_modules`,
`backend/.venv` y `.env.local` se crean solos. Lo que sí usas tú:

```bash
scripts/wt.sh status                 # árboles, commits por integrar, cambios sueltos
scripts/wt.sh merge <ID>             # rebase sobre la base + fast-forward (sin push)
scripts/wt.sh clean <ID>             # borra árbol y rama ya integrados
scripts/wt.sh new <ID>               # sólo si quieres trabajar tú ahí (idempotente)
```

- Para revisar a mano un árbol: `cd ../Custodia-wt/<ID>`; los E2E usan solos un
  puerto propio (4200-4899, derivado del ID).
- `merge` se niega si el árbol tiene cambios sin commitear o si el rebase
  conflictúa (se resuelve dentro del árbol); `clean` se niega si hay commits sin
  integrar. El árbol principal debe estar en la rama base.
- El servicio `custodia` y los puertos 8000/5173 pertenecen al árbol principal:
  reiniciar tras integrar, no desde un worktree.
