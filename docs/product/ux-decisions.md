# Decisiones UX

## Métricas: lectura priorizada

- La portada se presenta como **Métricas** y abre con cuatro señales de control: Safes activos, cobertura de clasificación, alcance pendiente y obsoletos.
- Las métricas de contexto permanecen colapsadas para no competir con la siguiente decisión operativa.
- El bloque “Siguiente paso” es la acción primaria de la portada; los gráficos explican el contexto y no duplican botones.
- Los gráficos declaran qué responde cada panel. Cuando no hay datos, muestran una explicación operativa en lugar de un “Sin datos” ambiguo.
- En pantallas pequeñas los KPIs pasan a una columna y la acción ocupa el ancho disponible para evitar pérdida de jerarquía o targets estrechos.

## Cadenas PAM

- La cadena se mantiene PAM-only y conserva el recorrido verificable `usuarios → roles → safes → plataformas → PSM`.
- Se muestran primero ocho recorridos y el resto queda bajo una acción explícita; cada nodo abre su contexto sin llenar la vista de detalles simultáneos.

## SIA: detalle respaldado por evidencia

- La expansión de una política muestra el identificador, tipo, targets/plataformas declarados, nombres de reglas y grantees.
- “Targets declarados” se usa deliberadamente: el modelo actual conserva nombres de plataformas, no conexiones de base de datos.
- Access windows, `connectionInformation` y targets con sus atributos requieren confirmar el payload real y ampliar el allowlist de persistencia mediante una nueva migración; no se simulan en la UI.
