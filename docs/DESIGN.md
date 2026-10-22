---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Diseño y primera demostración para Portfolio

**Entrega inicial:** una demo interactiva estática con datos completamente
ficticios. No conecta al trabajo, no pide tokens ni ofrece login productivo.
La decisión del dueño prioriza esta presentación antes del autohospedado.
Su lógica ilustra el contrato; no demuestra que el backend Go ya exista.

## Qué retocar de la interfaz

La v1 revisada tiene tokens, Geist/Geist Mono, verde operativo, tema oscuro y
controles propios; no están copiados a este árbol. Tomar esa dirección como
referencia al implementar, revisando procedencia antes de reutilizar assets.
El rediseño principal es de jerarquía y vocabulario:

| Hoy, según inspección del código | Dirección propuesta |
|---|---|
| Selección por herramienta, workspace y dominio. | Navegación por tarea y selector persistente de conexión. |
| Catálogo grande de capacidades y métricas específicas. | Mostrar sólo lo disponible para las conexiones del ejemplo. |
| Inventario/Personas/Cadenas/Cobertura con reglas distintas. | Inventario con procedencia; cambios con evidencia; revisión humana ligada al registro. Las extensiones especializadas quedan dentro de su adaptador. |
| Estado de sincronización repartido entre refresh, avisos e historial. | Fecha de última observación completa y estado de la corrida actual visibles juntos. |

Propuesta de navegación: **Conexiones · Inventario · Cambios**, más un panel
de detalle que contiene evidencia, responsable, estado, nota e historial.
La administración de acceso aparece después en el producto, no como un menú
de métricas vacío en la demo.

Conservar densidad de tabla y separación de fuentes; encabezados claros,
números tabulares, filtros visibles y una sola tabla principal por vista.
Usar un color de marca y colores semánticos con texto/icono, sin depender del
color. Evitar tarjetas repetidas, métricas decorativas y navegación anidada.

El producto operativo sigue orientado a escritorio y teclado. Portfolio y
la presentación pública sí deben poder leerse en un teléfono: una historia
compacta o capturas legibles acompañan a la demo completa de escritorio.
Eso no convierte la v1 laboral en producto móvil.

## Guion determinista del laboratorio

Nombres, valores y cantidades siguientes son un fixture propuesto. Deben
mostrarse como **datos de ejemplo**, nunca como métricas de clientes.

Dos conexiones del mismo conector ficticio `lab.inventory`, «Laboratorio
Norte» y «Laboratorio Sur», contienen ambas un recurso externo `r-17`.
Norte tiene también `r-18`. Los IDs iguales entre conexiones siguen siendo
registros distintos. Tiempos base fijos y reset reproducible.

| Paso | Interacción | Resultado esperado |
|---|---|---|
| 1 | Abrir Conexiones. | Dos conexiones, capacidades y fecha observada; nada afirma soporte real de un fabricante. |
| 2 | Abrir Norte y el registro `r-17`. | Evidencia del run inicial, responsable vacío y fuente visible. |
| 3 | Asignar un responsable ficticio y una nota. | Decisión local en memoria; historial del ejemplo identifica esa acción. |
| 4 | Simular una sincronización completa de Norte: cambia un atributo de `r-17` y aparece `r-19`; `r-18` sigue. | Un cambio y un alta. Responsable y nota de `r-17` se conservan. Sur no cambia. |
| 5 | Simular una corrida parcial que sólo devuelve `r-17`. | `r-18` y `r-19` no desaparecen. Se explica por qué el inventario completo anterior sigue vigente. |
| 6 | Simular una corrida completa comparable sin `r-18`. | Un retiro con enlace al run completo que lo respalda; la historia sigue accesible. |
| 7 | Reiniciar ejemplo. | Recupera exactamente el fixture inicial; sin tráfico hacia APIs reales. |

Cada cambio explica antes/después, conexión, corrida y estado de completitud.
La revisión humana se distingue de un hallazgo calculado; el ejemplo no
calcula un score de riesgo universal ni combina hallazgos incompatibles.

## Estados y accesibilidad

Diseñar estados inicial, cargando, sin resultados por filtro, sin conexión,
permiso insuficiente, corrida parcial y error recuperable. En la demo se
pueden reproducir con controles explícitos; en el producto provendrán del API.
La primera pantalla vacía guía a configurar una conexión, no muestra ceros.

Tablas con encabezados y orden anunciado, foco visible, panel de detalle con
retorno de foco, controles con nombres accesibles y selección de fila sin
gestos obligatorios. Sin reproducción automática del guion; botones avanzar,
retroceder y reiniciar. Respetar movimiento reducido. Medir contraste al
implementar, no darlo por aprobado desde esta revisión estática.

## Qué mostrar en Portfolio

Una captura de inventario y otra de un cambio con evidencia, texto ES/EN
de problema/decisión/resultado, enlace a la demo y estado explícito:
«Demo con datos de ejemplo. Producto Go autohospedado en preparación».
El copy se ajustará a lo realmente construido al cerrar la entrega.

La demo debe poder compilarse sin `.env`, base de datos ni acceso corporativo.
Reutilizar componentes seleccionados de React cuando sus dependencias lo
permitan, sin arrastrar toda la shell de v1. Elegir el lugar de su paquete al
abrir implementación y mantener el comando de build independiente del runtime
laboral. Servirla bajo un origen o ruta pública separada, con aceptación
explícita antes de publicar; no convertir el panel privado en una demo.

La aceptación funcional usa el guion completo y comprueba el aislamiento de
conexiones, la conservación de decisiones y la ausencia de bajas falsas.
También se revisan ES/EN, assets, teclado y lectura pública en tamaños
estrechos. Capturas y ejemplos originales se versionan; no se generan
imitaciones de pantallas de producción con datos del trabajo.
