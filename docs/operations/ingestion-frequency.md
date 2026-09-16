# Frecuencia de ingesta: de "sync manual" a "casi en tiempo real"

## Contexto

Hasta ahora, `INGESTION_INTERVAL_MINUTES` sólo aceptaba `0` (apagado, sync
100% manual desde la UI) o `>= 1440` (una corrida automática por día como
mínimo). Cualquier valor intermedio quedaba rechazado al arrancar el
backend. En la práctica, esto significaba que un Safe/cuenta/PSM nuevo en
CyberArk podía tardar hasta 24hs en aparecer en DS Hub, salvo que alguien
apretara "Sincronizar" manualmente.

Se bajó ese piso a **5 minutos** (`backend/app/config.py`,
`AppSettings.from_environment`). El objetivo no es "tiempo real" en el
sentido estricto (eso requeriría que CyberArk/Identity Administration/SIA
empujen eventos hacia DS Hub, algo que hoy no existe ni está confirmado
como posible — ver la nota al final), sino reducir drásticamente la
ventana entre "algo cambió en CyberArk" y "aparece en el inventario sin
que nadie toque un botón".

## Qué NO cambió

- El modelo sigue siendo **pull/batch**: DS Hub sigue siendo quien va a
  buscar los datos, en la frecuencia que se configure.
- La regla de negocio de **"sólo una corrida completa y exitosa puede
  retirar ausentes"** (`CLAUDE.md`) sigue intacta. Correr más seguido no
  cambia esa semántica: cada corrida programada sigue siendo una corrida
  completa normal, sólo que más frecuente.
- El mecanismo de cola durable, leases y reconciliación
  (`app/repositories/sync_queue.py`) no se tocó.

## El límite real no es el código, es la API de origen

Bajar el intervalo de 24hs a, por ejemplo, 15 minutos multiplica por ~96
la cantidad de veces por día que DS Hub le pega a la API de CyberArk
(PVWA), Identity Administration y SIA. Esto no se validó contra un
tenant real y no debe asumirse seguro sin probarlo, porque puede:

- Disparar rate-limiting del lado de CyberArk/Identity/SIA (devolviendo
  errores 429/503 que la ingesta ya maneja como fallo de corrida, pero
  que en volumen alto degradan la experiencia igual).
- Aumentar la carga sobre PostgreSQL (más UPSERTs/reconciliaciones por
  día) y sobre la red hacia el tenant.
- Interactuar con cualquier límite de cuota/licenciamiento que el tenant
  tenga configurado del lado de CyberArk (desconocido desde este repo).

**Antes de tocar un ambiente productivo:** probar el intervalo elegido en
un ambiente de staging/desarrollo que hable contra un tenant de prueba (o
contra el mismo tenant en un horario de bajo uso), monitoreando:

1. Tasa de error de las corridas (`cyberark_ingestion_runs.status`) durante
   al menos 24-48hs continuas al nuevo intervalo.
2. Latencia y códigos de respuesta HTTP de las llamadas a CyberArk/
   Identity/SIA (si hay logs/métricas del lado del proxy o de la propia
   plataforma de origen).
3. Cualquier alerta de rate-limit que el equipo de CyberArk pueda ver del
   lado de ellos (esto puede no ser visible desde DS Hub).

Si el intervalo elegido genera errores sostenidos, subirlo hasta
encontrar un punto estable, no asumir que "más rápido siempre es mejor".

## Cómo configurarlo

```bash
# .env.local o variable de entorno del backend
INGESTION_INTERVAL_MINUTES=15   # o el valor que se confirme como seguro
```

Reiniciar el backend para que tome el nuevo valor (se lee una sola vez al
arrancar, en `AppSettings.from_environment()`).

## Camino hacia tiempo real de verdad (fuera de alcance de este cambio)

Un modelo genuinamente en tiempo real requeriría que CyberArk/Identity
Administration/SIA **empujen** eventos (webhook, pub/sub, CDC) en vez de
que DS Hub los vaya a buscar. Esto:

- Depende de si esas plataformas lo soportan — no confirmado, contract
  pendiente (no inventar endpoints/capacidades no confirmadas, ver
  `AGENTS.md`).
- No reemplazaría la reconciliación completa periódica: un evento puede
  perderse (caída de red, servicio caído un rato), así que la corrida
  completa seguiría siendo necesaria como red de seguridad para detectar
  bajas reales.
- Implicaría un modelo **híbrido** (eventos para altas/cambios casi
  inmediatos + reconciliación completa espaciada para confirmarlas y para
  bajas), no un reemplazo de la cola actual.

Este documento cubre sólo el paso incremental (acortar el polling); el
modelo por eventos queda como evolución futura a evaluar si el contrato
del tenant lo permite.
