---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Entregas y evidencia

## Correcciones de la revisión de merge — 22/10

| ID | Fecha UTC | Entrega | Evidencia y límite |
|---|---|---|---|
| `PROD-MERGE-001` | 2026-10-22 | Aislamiento inequívoco de claves de registros y líneas base; fechas según captura; búsqueda por columnas visibles y vínculos sin alterar atributos crudos; atribución de fuentes corregida; retiradas afirmaciones de código abierto del sitio y login mientras no se decida licencia. | Regresión de IDs opacos, revisión humana y retiro aislado; modelos del experimento (18) y web (6). `maintenance/v1` conserva `f6a7acc` en el checkout original; el producto se integra en `main` desde su worktree. No modifica servicios, credenciales, bases ni despliegue público. |

Verificación final: 11 e2e de web (43,9 s) y 16 del experimento (39,7 s),
todos correctos; typecheck/build de ambos paquetes y documentación correctos.
La primera corrida simultánea agotó 30 segundos en los casos largos de axe,
sin reportar violaciones; la corrida final fue en serie con un worker y
60 segundos por caso. Las opciones son de ejecución local, sin cambiar los
límites de la suite. Web usó Chromium 1248 mediante `CUSTODIA_CHROMIUM_PATH`,
con bibliotecas temporales mediante `LD_LIBRARY_PATH` y sin instalar paquetes.
El informe del workspace `reviews/custodia-merge-2026-10-22/report.md`
registra la integración local y sus referencias Git.
Los pendientes de Go, autenticación, distribución y paridad siguen abiertos.

## Aceptación de la base — 22/10

El dueño revisó Faro Digital y acepta avanzar desde esta base. Pide una
nueva vuelta al estilo y autoriza el commit local. El refinamiento queda en
PROD-STYLE-001; PROD-UI-001 continúa abierto por los recorridos restantes.
Esta aceptación no declara diseño final, paridad con Python ni distribución.

Antes del commit se repitieron `npm run verify`, `npm run verify:company`
(8 pruebas Chromium) y `npm run verify:demo` (16 del experimento anterior),
todos verdes. `npm run package:demo` verificó y reutilizó el paquete histórico
con su manifiesto; no empaqueta Faro Digital ni publica archivos. El chequeo
del diff preparado para commit pasó tras normalizar finales de archivo.

## Empresa ficticia sobre UI original — 22/10

[Faro Digital](COMPANY-DEMO.md) es el primer recorrido de PROD-UI-001,
que sigue abierto. `company-demo/` recupera el frontend de `f6a7acc` sin
su configuración de despliegue; añade datos nuevos compartidos por personas,
equipos, Safes y cuentas. Conserva shell, diseño, búsqueda, vista radial,
cadena PAM, inventarios y detalle. Contexto de empresa y enlaces a casos
visibles; modo de lectura, fuentes completa/parcial/vencida y sesión simulada.

Siete pruebas del escenario verifican coherencia, totales y referencias,
ambigüedad, cruces de vistas, filtros/paginación, observaciones anteriores a
la captura y rechazo explícito de escrituras/endpoints inexistentes.
El adaptador no tiene fallback al backend. La v1 no se modificó.

Typecheck y build verdes. Ocho pruebas Chromium contra el build real:
Persona → equipos, cobertura/brecha/ambigüedad, capturas parcial/vencida,
Safe con cuentas/clasificación deshabilitada/historial, cadena PAM, casos y
búsqueda, y axe A/AA de Personas. El recorrido de equipos se prueba con el
reloj del navegador en 2031 para comprobar que la fotografía fechada conserva
su interpretación. Inspección visual de la ficha de Ana y
[captura local](../presentation/company/person-ana.png). Axe manual de esa
vista con evidencia expandida: cero violaciones y cero comprobaciones
incompletas; no acredita todas las pantallas ni ambos temas.

Chromium se ejecutó con bibliotecas locales mediante `LD_LIBRARY_PATH` y
`CUSTODIA_CHROMIUM_PATH`, sin instalación de paquetes del sistema. Es una
particularidad del entorno de pruebas, no una dependencia de la demo servida.

Sin backend Go, base, autenticación real, ingesta o conector CrowdStrike.
Los módulos originales no incluidos todavía requieren adaptación o retiro;
no se declara paridad completa, limpieza terminada ni distribución aprobada.
El experimento reducido y sus paquetes/capturas quedan como material histórico.

## Corrección de dirección — 22/10

El dueño aclaró que prioriza la UI y experiencia originales y que cruces e
inferencias son centrales al inventario multi-herramienta. La demo reducida y el
material registrados abajo son exploratorios; sus pruebas no acreditan
paridad ni aprobación del producto. Ya no se exige aceptar esa demo para Go.

[Revisión dirigida del código Python/React](EXISTING-PRODUCT.md): registro de
herramientas, ingesta y clasificación de Safes, Personas, puentes Identity/PAM,
cobertura Identity/Netskope, cobertura de destinos y postura. Pasaron 24
pruebas Python seleccionadas y cuatro archivos de pruebas TS del frontend
original. Sin gate completo, consulta productiva ni cambios al checkout v1.
Pendientes dueños: PROD-UI-001, PROD-PARITY-001, PROD-CORR-001 y PROD-CS-001.

| ID | Fecha UTC | Entrega | Evidencia y límite |
|---|---|---|---|
| `PROD-PLAN-001` | 2026-10-22 | Base documental nueva: producto, arquitectura Go, conexiones, acceso, diseño y aceptación. | Revisión estática de la v1 `f6a7acc` y del contrato actual de visitante de Switchboard. Separadas decisiones del dueño de recomendaciones. No hay código Go, demo, integración OIDC ni SSO implementados. |
| `PROD-CLEAN-001` | 2026-10-22 | Retiro del árbol heredado y reemplazo por la base del producto en `product/go-reset`. | Worktree separado, sin configurar runtime. `npm run verify` verde: 12 documentos, 33 enlaces locales y 15 IDs únicos. Verificador sin dependencias; sólo documentación. No se cambian servicios/bases de v1, ni se sanea historia Git, ni se publica. |
| `PROD-FIX-001` | 2026-10-22 | Guion del laboratorio como contrato: [fixture](../fixtures/lab/scenario.json) con dos conexiones, cinco corridas y lo esperado en cada paso; modelo puro en TypeScript (`demo/src/model/`) con observaciones, cambios y revisión en capas separadas. | `npm run verify`: los siete pasos contra lo esperado escrito a mano, más invariantes (Sur intacto, decisión conservada, reset exacto, sin mutación, alcance nuevo sin bajas, reaparición, parcial sin línea base, entradas rechazadas). Sin dependencias ni red. El backend Go deberá pasar el mismo fixture; no demuestra UI ni persistencia. |

`PROD-PLAN-001` y `PROD-CLEAN-001` quedaron en el commit `5dec025`. Esta tabla describe
la capacidad del árbol local; no demuestra una instalación pública ni un
producto ejecutable. Los siguientes lotes están en [pendientes](TO_IMPLEMENT.md).

## Revisión técnica y material local — 22/10

Sobre `94b976f`, sin nuevos commits: corregidos aviso parcial obsoleto tras
completa, detalle de otra conexión al filtrar, foco del guion tras apertura
manual y exceso de controles en el primer viewport móvil. El modelo de
inventario y su fixture no cambian.

Verificados los 17 casos del modelo, build y 16 pruebas de navegador
(corrida final completa, incluyendo el aviso de terceros).
Axe recorre los seis estados en ES y EN. Inspección visual con capturas a
320, 375, 768, 1024 y 1440 px; sin overflow a nivel página en las mediciones.
Esto no certifica toda WCAG ni sustituye aceptación del dueño.

Disponibles [textos y capturas](PRESENTATION.md), avisos de dependencias en el
build y `npm run package:demo`: paquete sólo de archivos públicos, con
manifiesto SHA-256 y verificación al reutilizarlo. Probado desde una subruta
real en un servidor estático local. Contenido ES/EN y captura integrados en
el checkout local de Portfolio; sin enlace de demo pública ni publicación.

`PROD-DEMO-001`, `PROD-DIST-001` y `PROD-SHOW-001` siguen en el tracker con
sus aceptaciones pendientes. No hay backend Go ni autenticación nuevos.
