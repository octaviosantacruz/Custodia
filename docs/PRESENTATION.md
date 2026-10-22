---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Preparación de Portfolio

La base vigente es [Faro Digital](COMPANY-DEMO.md), con UI original y empresa
ficticia. Capturas locales de revisión:
[Persona y evidencia](../presentation/company/person-ana.png) y
[sus equipos Netskope](../presentation/company/ana-devices.png).
El caso de Portfolio y su material anterior requieren adaptación a esa base;
su enlace fue retirado de la tarjeta. No se publicó la nueva demo.

**Retenido tras aclaración del dueño del 22/10.** El material siguiente
corresponde al experimento reducido, no a la experiencia objetivo. No usarlo
para sustituir la presentación de la UI original ni publicarlo como diseño
aprobado. Primero recuperar esa experiencia con datos sintéticos según
[la revisión existente](EXISTING-PRODUCT.md). Los archivos se conservan para
no perder el trabajo exploratorio.

Trabajo local de `PROD-SHOW-001`; la aceptación de la demo, distribución y
publicación siguen pendientes. No hay demo pública, backend Go ni integraciones
reales por preparar este material.

## Paquete estático con manifiesto

```bash
npm ci --prefix demo
npm run package:demo
```

El comando compila y crea `artifacts/custodia-demo-HASH/`. Contiene sólo el
build, fuentes incluidas, avisos de terceros y `manifest.json` con tamaño y
SHA-256 de cada archivo. El nombre deriva del manifiesto; repetir el mismo
build reutiliza el paquete después de verificar su contenido. No contiene
Git, código fuente, configuración privada ni un export de la v1. La limpieza
de la historia y la licencia del producto siguen en `PROD-DIST-001`.

El paquete se puede servir en una subruta conservando su estructura y el
slash final del directorio. No instalarlo en el host público ni agregar un
enlace público hasta autorizar distribución y comprobar el destino real.

## Texto español

**Custodia — inventario de seguridad con cambios explicables.**

Las herramientas tienen partes del inventario y observaciones incompletas.
Custodia conserva el origen de cada registro, explica qué cambió y mantiene
la revisión humana separada de la sincronización. Una corrida parcial no
convierte una ausencia en una baja.

Hoy: demo interactiva con datos ficticios, dos conexiones y un recorrido de
cambios y decisiones. Verificada localmente; todavía sin publicación.
Backend Go/PostgreSQL e integraciones reales en preparación.

## English copy

**Custodia — security inventory with explainable changes.**

Tools hold different pieces of the inventory and incomplete observations.
Custodia preserves each record's source, explains what changed and keeps
human review separate from synchronization. A partial run does not turn a
missing record into a retirement.

Today: an interactive demo with sample data, two connections, changes and
human decisions. Verified locally; not published yet. The Go/PostgreSQL
backend and live integrations are in preparation.

## Capturas y aceptación

Las capturas de `presentation/screenshots/` corresponden al build real y al
fixture sintético. Inventario muestra evidencia y decisión humana; Cambios
muestra el retiro respaldado por una corrida completa. No usar pantallas ni
datos laborales. Su lectura en tamaños estrechos se revisa en Portfolio;
el panel operativo de tablas sigue orientado a escritorio.

El contenido local de Portfolio puede mostrar estas capturas y el estado
anterior sin ofrecer un enlace a una demo todavía inexistente en público.
Cerrar `PROD-SHOW-001` sólo con aceptación de demo/distribución, build ES/EN,
assets comprobados y evidencia de destino si se decide enlazar la demo.


Último paquete verificado localmente (22/10):
`artifacts/custodia-demo-2f9a576c1db4/`. SHA-256 de su manifiesto:
`2f9a576c1db48d0bb1195637e8b371620ee81e9a2a1b81bfe115ab388a15d194`.
La ruta se regenera y puede cambiar con un build nuevo. Se comprobó el mismo
contenido al repetir el empaquetado y su carga desde una subruta estática.
