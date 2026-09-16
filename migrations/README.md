# Migraciones

Los archivos `NNN_descripcion.sql` son el historial inmutable del esquema PostgreSQL. Se aplican en orden con `scripts/migrate.py`, que registra cada versión en `public.schema_migrations`.

Reglas:

- No renombrar, mover, editar ni fusionar migraciones numeradas ya aplicadas.
- Todo cambio de esquema se agrega en un archivo con el siguiente número.
- Las instalaciones existentes pueden depender de cualquier versión previa; agrupar archivos históricos rompería ese upgrade path.
- Ejecutar `./scripts/migrate.sh` antes de iniciar una versión que dependa de cambios de esquema.

Para una instalación nueva, el runner aplica la secuencia completa. Para una instalación existente sin tracking, establece el baseline documentado en `scripts/migrate.py` y luego aplica las versiones posteriores pendientes.

## Consolidación segura

El repositorio conserva las 24 migraciones numeradas como ledger de upgrade.
No se deben fusionar, renombrar, mover ni borrar: una base existente puede
tener cualquier versión registrada en `public.schema_migrations`. La reducción
segura para instalaciones nuevas se hará mediante un baseline generado aparte
y una rama explícita del runner; el ledger histórico seguirá siendo la fuente
de upgrade para bases existentes.
