---
estado: histórico
dueño: Octavio Santacruz
revisado: 2026-10-09
---

# Checkpoint de la auditoría UX/UI 001–026

Auditoría inicial: 2026-10-07; última actualización: 2026-10-08. Alcance: cambios locales del worktree compartido antes de
avanzar a nuevas features. Los criterios canónicos siguen en `TO_IMPLEMENT.md`.
No es una auditoría de seguridad integral ni una aprobación de despliegue.

En esta foto, «Parcial» corresponde a **En curso** en el tracker activo y
«Pendiente» a **Listo** (disponible para implementar). Los puntos cerrados se
registran únicamente en `IMPLEMENTED.md`; «Listo» no significa terminado.

Resultado: **26 cerrados, 0 parciales y 0 pendientes**. La auditoría
001–026 está cerrada; FE-CSS-001 se ejecutó y cerró el 2026-10-09 (ver
`IMPLEMENTED.md`). No hay migraciones nuevas.

## Estado y trabajo que falta

| Punto | Estado | Evidencia o falta para cerrar |
| --- | --- | --- |
| 001 | Cerrado | Resumen PAM filtrado por `source_system = 'cyberark'`; prueba PostgreSQL con una corrida Netskope más reciente. |
| 002 | Cerrado | Fecha de Actividad excluida del elipsis del contenedor. E2E comprueba que el texto completo queda dentro de sus ancestros con recorte; falla con la regla CSS anterior. |
| 003 | Cerrado | Primero elige dos corridas Netskope completas con snapshots de equipos, ordenadas por inicio; después lee sus inventarios. Conserva la fecha real de captura. PostgreSQL verifica categorías, filtros, corridas incompletas y flujos sin equipos. `EXPLAIN ANALYZE` en la base configurada: 751,844 ms y 532,971 ms, frente al timeout anterior de 15 s. No necesita migración. |
| 004 | Cerrado | Métricas comparten cruce y distribuciones (doce → seis consultas); EXPLAIN de distribuciones 163,848 → 121,829 ms. El dueño midió HTTP completo con 3920897b/e739c951 y backend caliente: treinta rondas por variante, todas 200; p95 0,59 s Cobertura, 0,76 s overview, 0,40 s métricas y ≤ 0,33 s con filtros. Las seis variantes cumplen p95 ≤ 1 s. Corrida fría y mediciones anteriores se conservan como contexto, sin usarlas para cerrar. |
| 005 | Cerrado | Corridas compartidas e invalidadas al terminar una sync; caché de sesión limpiada antes de suscripciones. Cinco E2E cuentan un solo GET de preferencias y de equipos/facetas, Steering, políticas y preferencias/plantillas del tablero. El build temporal con el efecto de sesión anterior duplica los seis recursos Netskope y falla en cuatro rutas. |
| 006 | Cerrado | Un deep link Netskope sin el permiso específico vuelve a una vista autorizada de esa herramienta y muestra un aviso; E2E con permisos restringidos. |
| 007 | Cerrado | Cada `source.ts` declara su rótulo de herramienta; breadcrumb y selector distinguen PAM, Identity Administration, SIA, Access space y Netskope. Cinco E2E verifican destinos y etiquetas; el build anterior falló en Identity, SIA y Access. |
| 008 | Cerrado | Header, Métricas e Inventario comparten el contrato del inventario de clientes Netskope, su petición y su texto. Disponible para lectores, sin confundir capturas de otras funciones ni fechas de observación. Regresión red/green en dark/light, permisos HTTP y refresco manual verificados. |
| 009 | Cerrado | Fechas absolutas con formato común y tooltip relativo (o «en…» si es futura) en las 17 superficies del barrido; epoch en segundos convertido explícitamente, ISO original conservado en `datetime`, vacíos como «Sin fecha». Ver el cierre al final del checkpoint. |
| 010 | Cerrado | Porciones no nulas menores al uno por ciento dicen `<1%`, con E2E. El eje conserva todas las muestras: fecha y hora cuando se repiten días, segundos cuando se repiten minutos. El test propietario falla antes con dos etiquetas para seis muestras y pasa con seis etiquetas distintas. |
| 011 | Cerrado | Tabla y drawer usan una etiqueta fabricante/modelo que evita repetir HP, incluidas las variantes Hewlett-Packard; prueba del helper. |
| 012 | Cerrado | Falta de correo ya no se presenta como una federación llamada «Sin email»; muestra «—» y conserva los estados de resolución. |
| 013 | Cerrado | Usuarios y Actividad comparten ancho y bordes con sus pestañas; grupos Okta conservan padding. El pie de fuente Netskope alinea su texto con la cabecera del inventario. Tres E2E comprueban geometría y padding en ambos temas; Actividad falla antes por 36 px y Netskope por 24 px en el viewport de prueba. |
| 014 | Cerrado | Command-K conserva un botón de cierre en la barra, omite subtítulos idénticos al título en comandos y resultados remotos, y evita insignias que repiten el grupo. Los detalles distintos y las etiquetas de plataforma para comandos mezclados se conservan. E2E dark/light verifica el resultado remoto y su filtro al abrir Safes; suite de búsqueda con teclado, permisos y Axe. |
| 015 | Cerrado | Lista previa de catorce filas verificada: quince rutas más alias, Vigentes/Retiradas, PSM/SIA y CPM. Un H1, descripción de una línea sin elipsis, método en ayuda junto al título; controles, conteos y secciones distintas conservados. Regresión anterior falla, dark/light reales y ciclo de vida de la ayuda con teclado/historia en verde. |
| 016 | Cerrado | Inicio muestra un solo control selector y el logo sólo en el header; Conexiones sustituye CROSS. E2E en ambos temas comprueba ausencia del selector redundante. Un build temporal que lo repone falla ambos casos. |
| 017 | Cerrado | Conectores y la guía hablan de vistas; el filtro Standard describe evidencia y su tooltip preserva el criterio PAM sin afirmar facturación. Access traduce Target a Destino y VMs conservan Máquina virtual. Seis rutas verifican copy sin snake_case, separándolo de datos reales y código técnico; Limpieza tiene la comprobación en su prueba propietaria. Ambos temas en verde. |
| 018 | Cerrado | Limpieza conserva cálculo/evidencia en el detalle; Relaciones y límites iguales de Steering muestran una aclaración. Netskope reúne método y límites del vínculo en la ayuda del inventario y omite filtros activos vacíos, conservando fuente/vigencia visibles. Hallazgos conserva «Filtros Custodia» y cobertura por fuente sin repetir el alcance; Salud PAM tiene su explicación en ayuda junto al título. Pruebas propietarias verifican ayuda, Escape, filtros y datos operativos en ambos temas. |
| 019 | Cerrado | Esquema fijo: columnas consolidadas en contexto, sin inferir homogeneidad de una página. Se conservan tipos, procedencia, estados, decisiones y observaciones distintas en páginas posteriores. Regresión propietaria anterior falla; seis vistas verificadas en dark/light reales. |
| 020 | Cerrado | Los ajustes de Identity, Actividad, PSM y unidades de Plataformas siguen presentes. VMs, cuentas BD, target sets y Access omiten el ID repetido cuando coincide exactamente con el nombre; conservan copiar el ID original y mostrar IDs distintos. Tipos de almacén y target set aparecen en su columna una sola vez. Ocho E2E verifican estas cuatro vistas en ambos temas. |
| 021 | Cerrado | Nueve filas de barrido verificadas en lectura, edición, vacío y alertas: un título por sección, sin contadores redundantes; seis KPI sin recorte y detalle en ayuda. Grilla SSE ocupa la fila, conserva tamaños relativos/orden y no escribe preferencias. Diferencia conserva ambos conteos y signo. Ocho propietarios verifican dark/light reales; grupos y verify aprobados. |
| 022 | Cerrado | Drawer único SIA con tabla a todo el ancho, foco y scroll interno; Personas y vacíos compactos, método junto al título. Implementado en 8fdccb6a. Verificación complementaria y expectativas de Personas actualizadas en 2be738eb. |
| 023 | Cerrado | Siete filas del barrido verificadas: anchos de PSM, versiones y fechas atómicas, nombres completos en tooltip/drawer y navegación conservada. Diez propietarios en dark/light reales a 1280/1440; Hallazgos reparte el ancho para su fecha completa. Código 7e6c8869. |
| 024 | Cerrado | Trece filas verificadas: buscadores del sistema, tipografía, placeholders según auth, singular/plural, estado de sync en oración y Unidad neutra en tabla/drawer. Flujos conservados en dark/light reales; código a45917b9, grupos focales y verify aprobados. |
| 025 | Cerrado | SIA usa una fila de pestañas bajo el switcher, con permisos y APIs propietarios. Identity raíz redirige a Usuarios; alias de roles/grupos conserva destino y reemplaza historia. Ayuda pertenece a Conexiones, Administración mantiene dos vistas restringidas. Ayuda y Plataformas conservan los ajustes anteriores contra controles redundantes. E2E verifica navegación, teclado, selección, recarga y ancho desktop. |
| 026 | Cerrado | Salud PAM indica «N de D conectados», traduce tres nombres conocidos y Steering convierte millas a kilómetros; prueba de conversión. |

## Verificación del checkpoint inicial

La primera corrida E2E completa permitió reproducir expectativas antiguas de
navegación y selectores ambiguos del drawer frente al historial de capturas.
Se actualizaron los contratos visibles sin quitar las comprobaciones de
permisos, navegación, filtros ni accesibilidad.

Pruebas de control antes de la corrección:

- La regla CSS anterior vuelve a recortar la fecha y falla la comprobación de
  geometría de Actividad.
- Sin invalidación al terminar la sync, el header mantiene «Sincronización
  pendiente» pese a que la corrida termina correctamente.
- Limpiar la caché de sesión después de iniciar las consultas provoca dos
  lecturas iniciales de corridas; la prueba cuenta los requests reales.

La prueba de búsqueda ahora verifica ruta, filtro y requests PAM, sin consultas de
roles Identity al elegir un resultado PAM. El renderer usa el componente
propietario de PAM en lugar de pasar por la redirección del hub Identity.

Dos E2E de toast completaban sus corridas durante el análisis Axe del estado
running; ahora la respuesta permanece running hasta terminar ese análisis. El
caso de navegación con tres análisis Axe se dividió por superficie, conservando
las aserciones y el timeout original.

Validación realizada:

- `npm run verify`: 1.487 tests backend con PostgreSQL efímero, 433 tests
  frontend, TypeScript/build, probes y controles del repositorio en verde.
- Suite Playwright completa: 450 casos ejecutados, 439 pasaron en el barrido
  de 25,3 minutos. Los otros once se actualizaron y repitieron sobre el mismo
  build de producción: Inicio, navegación de roles, copy de PAM/SIA, controles
  de ayuda Risk Management y selector del aviso de autorización Netskope.
  **Repetición final: 11 de 11 en verde (21,3 segundos)**.
- Python y los paquetes npm de raíz/frontend: ninguna vulnerabilidad conocida.
- La corrida E2E usó un directorio de build privado en `/tmp` y un preview
  propio para evitar que las otras suites del checkout sobrescriban `dist`.
  Conserva proyectos, timeouts, aserciones y análisis Axe del repositorio.
- La base configurada se consultó en modo de solo lectura para el plan y la
  medición inicial de 003; se canceló a los 15 segundos. En ese checkpoint el
  criterio seguía abierto; el avance posterior se registra más abajo.

El ajuste de Inicio conserva la topología del logo en el header, comprueba que
no vuelve al hero y verifica su animación en login. Risk Management abre los
botones por nombre accesible y cierra cada ayuda con Escape antes de la siguiente;
no se fuerzan clics ni se amplían los timeouts. El aviso Netskope se distingue
del estado de carga por su mensaje.

No hay migraciones nuevas ni cambios de contrato con los proveedores externos.

## Separación de commits

| Feature | Commit |
| --- | --- |
| Aislamiento del resumen PAM | `6d88e5ff` |
| Consulta única del diff Netskope (rendimiento aún abierto) | `024285ed` |
| Fechas y tiempos relativos | `f6aaddf1` |
| Caché de corridas y refresco del header | `ca0989a5` |
| Navegación SSE y aviso de acceso restringido | `e2f8a22f` |
| Catálogo y búsqueda de roles PAM | `91859dbb` |
| Porcentajes pequeños y diferencia de usuarios | `14278e70` |
| Marca/modelo y controles Steering | `fdd02f18` |
| Salud, Limpieza y catálogos PAM | `fa6f2d7a` |
| Pruebas de ayudas del catálogo Risk Management | `21badd69` |
| Federación y filas Identity | `31c4085e` |
| Detalle de políticas y recursos SIA | `bf9e3723` |
| Títulos, Inicio y Command Center | `fa0d4ab4` |
| Fechas y actores de Actividad | `077bb202` |
| Controles de acceso e insignias | `ad844cd3` |

Este reporte, el traslado de los seis cierres a `IMPLEMENTED.md` y el estado
activo se agrupan en el commit de documentación que contiene esta tabla.
No se hizo push ni despliegue.

## Avance posterior al checkpoint: 003 y 005

Se comparó la consulta 003 contra la base configurada en modo de solo lectura:
la versión anterior volvió a cancelar a los 15.090 ms; la nueva ejecutó en
751,844 ms y 532,971 ms (769 ms y 540 ms de tiempo observado con EXPLAIN).
El índice existente por `source_system/started_at` encuentra las corridas;
el índice existente por `source_run_id/device_id` accede a sus snapshots.
No se ordena ni agrupa todo el historial de snapshots para elegir dos corridas.
El orden es la cronología de ingesta (`started_at`, desempate por UUID), mientras
`captured_at` sigue informando la escritura real del snapshot. Los flujos sin
snapshots y las corridas fallidas o en curso nunca participan.

Una regresión PostgreSQL con escritura fuera de orden falló en la versión
anterior por elegir la corrida incorrecta; las cuatro pruebas del diff pasan
con la selección corregida. El filtro de equipos reutiliza la misma selección.

Para 005 se completó la cobertura que faltaba; no se cambió el runtime frontend.
Los cinco E2E pasan sobre el build actual. Un plugin Vite temporal, fuera del
repositorio, reprodujo el efecto de sesión anterior: equipos, facetas, Steering,
políticas y preferencias/plantillas Netskope se piden dos veces. Las preferencias
de workspace siguen pidiéndose una vez. La prueba mantiene el conteo de GETs
separado de los PUTs legítimos que registran recientes.

Commits de este avance: `8c2102a8` (selección y rendimiento),
`f33a443a` (conteo de requests) y el commit de documentación que contiene
esta sección. Los 18 criterios restantes conservan su estado real.

Validación del avance: `npm run verify` completo en verde, con **1.488 tests
backend**, **433 tests frontend** y build/typecheck. Los **cinco E2E de conteo**
pasaron. El registro de grupos E2E incluye la nueva prueba en `cross`.


## Avance posterior: rendimiento 004 (parcial)

Cobertura evaluaba la agrupación de dispositivos una vez por cada persona.
El plan real mostró 62 ejecuciones del agregado y 2.006 recorridos de la
población Netskope. Materializar `device_counts` elimina esa reevaluación;
reutilizar `active_users` evita una segunda lectura de los usuarios Netskope.
Se conserva la transacción repeatable-read de sólo lectura, la normalización
exacta de correo, los conteos de duplicados y los permisos conjuntos de Identity
y Netskope.

Mediciones con `EXPLAIN (ANALYZE, BUFFERS)` sobre la base configurada, sin
escrituras: **11.452,569 ms y 10.229,208 ms antes**, **1.712,615 ms** tras
materializar el agregado y **1.312,417 ms** con la población reutilizada.
Son tiempos de la consulta de Cobertura, no del HTTP completo. La prueba de
regresión usa 64 personas elegibles y 8.000 usuarios/equipos sintéticos:
excedía 4 segundos antes y pasa después. Los cuatro tests PostgreSQL incluyen
coincidencias únicas, ambigüedad, exclusiones, fechas y vigencia de corridas.
No hay migración ni se alteró la base configurada.

Risk Management obtiene los cuatro recursos en paralelo, pero antes cada uno
pedía un token OAuth mientras los otros tokens estaban en vuelo. El transporte
compartido ahora serializa la obtención y vuelve a comprobar la caché dentro
del bloqueo. Un test de lecturas concurrentes falla antes con cuatro POST OAuth
y pasa después con uno; los GET conservan sus respuestas y autorización.
Una lectura real del overview midió **1.919 ms / cuatro tokens** antes y
**958 ms / un token** después. La variación incluye latencia del proveedor:
remediaciones tomó 1.504 ms antes y 641 ms después; por eso no se atribuye toda
la mejora al bloqueo ni se garantiza un límite remoto a partir de dos lecturas.
La medición sólo registra tiempos y estados, sin payloads ni tokens.

Las métricas Netskope no se modificaron en ese primer avance de 004. Las lecturas del servicio
completo oscilaron entre **1.608 y 4.091 ms**. El perfil identifica **14 consultas**;
las tres más costosas pertenecen a `netskope_cross_metrics`, con EXPLAIN de
**945,397 ms**, **580,562 ms** y **493,498 ms**. Falta reducir las evaluaciones
repetidas de la relación usuario/equipo y medir el resultado; no corresponde
presentar las variaciones entre corridas como una optimización.

En ese avance, 004 permanecía **En curso**, sin traslado a `IMPLEMENTED.md`. Quedan 18 criterios
abiertos: 16 parciales y dos pendientes (008 y 019). Este avance se separa en
commits de Cobertura, transporte OAuth y documentación.

Validación de este avance: `npm run verify` completo en verde, con **1.490 tests
backend**, **433 tests frontend**, build/typecheck y controles del repositorio.
No se repitió Playwright: este avance modifica sólo backend y documentación;
los E2E del checkpoint anterior conservan su evidencia histórica.

Commits: `3f263c9b` (Cobertura), `eba09115` (transporte OAuth) y el
commit de documentación que contiene esta sección. Sin push ni despliegue.


## Avance posterior: métricas Netskope de 004

`netskope_cross_metrics` reconstruía tres veces la correspondencia exacta entre
usuarios y equipos para cobertura reciente, actividad y riesgo. Ahora los
indicadores solicitados comparten una sola consulta y un solo snapshot de
PostgreSQL. Las métricas de cobertura siguen limitadas a siete días; actividad,
edad y riesgo conservan el inventario activo completo. Un widget de riesgo
mantiene su filtro dentro del conjunto materializado y su denominador se cuenta
sobre todos los dispositivos activos; el widget de total no convierte fechas
ni resuelve usuarios. Los filtros de SO, empresa y clasificación siguen
parametrizados y cada selección omite los resultados que no solicitó.

La nueva regresión reproduce una sync confirmada después de la primera lectura:
antes la cobertura contaba el inventario inicial mientras el total incluía un
equipo posterior (**9 en vez de 8**); ahora ambos indicadores corresponden a la
misma observación. La coherencia protegida es la de estos indicadores derivados
usuario/equipo; no se afirma que todas las consultas del endpoint completo
compartan una transacción.

Sobre la base configurada en modo de sólo lectura, el servicio completo pasó
de **2.409 ms / 14 consultas** a **1.075 ms / 12 consultas**. Los tres EXPLAIN
anteriores del cruce ejecutaron en **907,303 ms**, **462,020 ms** y
**284,714 ms**; la consulta compartida ejecutó en **1.021,535 ms**.
Estos valores incluyen variación de carga/caché; no son una garantía de latencia.
El servicio aún supera un segundo en esa muestra y las distribuciones siguen
siendo consultas separadas.

Una comparación anterior/nueva dentro de la misma transacción repeatable-read
confirmó **respuestas idénticas en siete casos** (completo, filtros SO/empresa,
selección combinada, riesgo con total, sólo total y sólo cobertura). En el caso
completo, el cruce pasó de **495 ms a 211 ms**. El total aislado se mantuvo en
**12 ms / 13 ms**; riesgo con total, **120 ms / 121 ms**. No se imprimieron ni
persistieron filas del inventario.

Los tests propietarios pasan: **29 de métricas/consultas con PostgreSQL efímero**
y **24 de HTTP/consultas** (hay casos de consultas comunes a ambos grupos; no
sumarlos como si fueran tests distintos). Se conservan la prueba de inventario
a escala, los casos de ambigüedad, el usuario cuyo ID coincide con su correo,
los scopes de fechas, los filtros y la selección de widgets.

En ese avance, 004 permanecía **En curso**. Falta confirmar el presupuesto sostenido del HTTP
completo de Cobertura, riesgo y métricas, y revisar el costo restante de las
distribuciones. No se cambia el estado de los otros 25 criterios: ocho cerrados,
16 parciales y dos pendientes en total. Sin migraciones ni cambios de frontend.

Validación final: `npm run verify` completo en verde, con **1.491 tests backend**,
**433 tests frontend**, build/typecheck, probes y controles del repositorio.
Playwright no se repitió en este avance de backend.

Commit `b5512bfd`: consulta compartida y regresiones; el commit de
documentación que contiene esta sección registra la evidencia y los pendientes.
Sin push ni despliegue.


## Avance posterior: navegación, Inicio y ejes de inventario

Se cierran 007, 010, 016 y 025. El rótulo visible proviene del `source.ts`
propietario, mientras la agrupación CyberArk permanece compartida. SIA mantiene
sus APIs y permisos al mostrar políticas y recursos en una sola fila; Access
sigue exigiendo su permiso específico. Identity raíz es un alias de Usuarios,
con compatibilidad de `section=roles|groups`, recarga y Back sin una entrada
intermedia. Ayuda pasa al dominio neutral `cross` también en las preferencias
backend; no se abren Personas ni superficies administrativas sin sus permisos.
Inicio conserva el selector de herramienta y omite el selector redundante de
workspace.

El formatter del eje agrega hora en ventanas con varias muestras por día y
fecha cuando abarcan varios días; agrega segundos si se repite el minuto.
No elimina muestras ni inventa horas para etiquetas que sólo contienen fecha.
La prueba reproduce las seis muestras de dos días y una ventana de segundos;
el código anterior falla, el corregido pasa.

Evidencia de navegación: cinco regresiones fallaron contra el build anterior
(tres rótulos, raíz Identity y segunda fila SIA). El barrido de 178 casos pasó
174; cuatro expectativas antiguas se corrigieron. Una repetición de 13 casos
identificó una comprobación de Ayuda después de cerrar su menú; se movió antes
de Escape, conservando la aserción. La repetición final de esos 13 casos pasó.
Los 38 casos de SIA y tableros pasan con el build final, incluidos teclado,
permisos, deep links y Axe. Inicio tiene además un control negativo en ambos
temas: reponer el selector con un plugin temporal hace fallar ambos casos.
No se afirma una corrida única de los 178 casos completamente verde.

`npm run verify` completo: **1.491 tests backend**, **433 tests frontend**,
build/typecheck, probes y controles del repositorio en verde. Builds y previews
E2E privados en `/tmp`; sin cambios de contrato externo ni migraciones.

Commits: `76aa5974` (navegación y herramientas), `6cbe66ea`
(eje temporal), más el commit de documentación que registra este avance.
Quedan **14 criterios abiertos**: 12 parciales y dos pendientes (008 y 019).
El siguiente trabajo sigue siendo completar la auditoría antes de nuevas features.
Sin push ni despliegue.


## Avance posterior: alineación 013 y tipografía de 024

Actividad conservaba `max-width: 1180px` mientras su navegación ocupaba el
contenedor completo. Ahora sigue el mismo ancho que Usuarios. El pie de fuente
Netskope recibe el padding lateral de su contexto, en su componente propietario;
conserva el texto, fecha y criterio de vigencia. No cambian consultas ni filtros.
Las etiquetas de pestañas de Actividad usan el elemento `strong` del patrón
compacto existente, sin una excepción global nueva de tamaño.

Pruebas antes de reparar: la comparación de bordes de Actividad detectó 36 px
de diferencia; el texto del pie Netskope quedó 24 px fuera de la alineación; la
tipografía de las cinco pestañas excedía 12 px. Usuarios y el bloque de grupos
Okta ya cumplían su geometría. El fixture del inventario incluye explícitamente
la evidencia de fuente que dispara el pie; no confunde su ausencia con un fallo
de padding. Las comprobaciones esperan la carga del panel antes de medir.

Los cuatro casos pasan en dark y light: **8 E2E desktop en verde**. Las pruebas
existentes de búsqueda, expansión, histogramas y ayudas administrativas pasan
ambos temas: **4 E2E en verde**. `npm run verify` completo conserva **1.491 tests
backend**, **433 frontend**, build/typecheck y controles del repositorio.
El harness valida el traslado del ID sin duplicados ni cruces.

Se cierra 013; 024 conserva su estado parcial hasta completar el barrido visual.
Quedan **13 criterios abiertos**: 11 parciales y dos pendientes (008 y 019).
Commit `58d9a339` para presentación y pruebas, más el commit de
este registro. Sin migraciones, push ni despliegue.


## Avance posterior: filas 020 y fechas SIA de 009

Los catálogos de VMs, cuentas BD, target sets y activos Access repetían el ID
bajo el nombre cuando ambos eran iguales. La igualdad sigue siendo exacta:
no se normaliza un ID opaco ni se ocultan IDs distintos. El botón de copiar
conserva siempre el valor original. Los tipos de almacén y target set se
muestran sólo en la columna que ya los identifica. La categoría de Access
sigue visible y el separador aparece sólo cuando hay un ID distinto.

Se revisaron también las correcciones anteriores: Identity no repite email
bajo el nombre, Actividad no repite el actor cuando nombre e ID coinciden,
PSM no repite el identificador igual al nombre y Plataformas no reitera las
unidades bajo cada número. Se cierra 020.

La fecha de modificación de cuentas BD SIA aún era ISO crudo. Ahora utiliza
`formatDate`, `time.dateTime` original y `relativeTime` en el tooltip, igual que
el escaneo de VMs. El tooltip de escaneo deja de repetir el ISO técnico. Los
timestamps con microsegundos permanecen intactos en el atributo; no cambia
su precisión en el almacenamiento. 009 sigue parcial por las otras vistas.

Los **12 casos E2E** (cuatro catálogos y dos fechas en ambos temas) fallaron
contra el build anterior por las repeticiones, ausencia de `time` en BD y
tooltip crudo de VMs; pasan después. La prueba comprueba el portapapeles real
para IDs iguales y distintos, sin un mock de la función de copiar. La
repetición final agrega la comprobación de los tipos únicos por fila.
La suite propietaria SIA también pasa con navegación, filtros, permisos y Axe.

`npm run verify` completo: **1.491 tests backend**, **433 frontend**,
build/typecheck, probes y controles del repositorio en verde. Sin migraciones
ni cambios de APIs o integración. Quedan **12 criterios abiertos**: diez
parciales y dos pendientes (008 y 019).
Commit `d9355f47` para catálogos y regresiones, más el commit de
este registro. Sin push ni despliegue.


## Avance posterior: Command-K 014

Los resultados remotos todavía mostraban su detalle aunque fuera exactamente
igual al título. Ahora comparten la regla de los comandos locales; un detalle
distinto permanece visible. La insignia «Inventario» se omite en esas filas:
la agrupación por tipo (Safes, cuentas, roles, etc.) ya aporta ese contexto.
Los comandos mezclados conservan su tipo y plataforma. No cambian requests,
ranking, filtros, autorización ni navegación del resultado seleccionado.

Una regresión espera explícitamente el control después de cargar la sesión,
abriendo Command-K por teclado. Contra el build anterior falla en ambos temas
por mostrar «Audit finance» dos veces; el código corregido lo muestra una vez.
Comprueba además contexto distinto, ausencia de insignias redundantes, un
botón de cierre en la barra y que seleccionar el resultado aplica «Audit finance»
en el buscador de Safes. No se toman como evidencia los intentos iniciales que
no esperaban la carga del control y fallaron por timing del test.

El barrido ejecutó **22 E2E de búsqueda**: **20 pasaron** (requests, errores
del backend, permisos, ranking, filtros, teclado y Axe). La nueva regresión
falló en sus dos temas por un fixture que esperaba filtrar con un texto distinto
del nombre seleccionado; se alineó con el contrato existente. La repetición
final de esos **dos casos pasó en ambos temas**, sin cambiar la navegación.
No se afirma una corrida única de los 22 casos completamente verde. `npm run verify` completo conserva **1.491 backend**,
**433 frontend**, build/typecheck y controles del repositorio.

Se cierra 014. Quedan **11 criterios abiertos**: nueve parciales
(004, 009, 015, 017, 018, 021, 022, 023, 024) y dos pendientes (008, 019).
Commit `beb3bab2` para búsqueda y pruebas, más el commit de este
registro. Sin migraciones, push ni despliegue.


## Avance posterior: lenguaje de operador 017 y aclaraciones de 018

Conectores y Primeros pasos sustituyen «workspace» por «vista/selector de
vistas». El filtro de Relaciones dice «Sólo usuarios con evidencia Standard»;
su tooltip explica EPVUser/rol Privilege Cloud y que no confirma facturación.
Se conserva el request `standard_seat=reconciled`. Access traduce el tipo
conocido `Target` a «Destino» y conserva los otros tipos. Ayuda ya mostraba
Responsable/Se actualiza; Limpieza y Usuarios Netskope mantienen las mejoras
anteriores contra nombres de campos internos.

La regresión de copy recorre Conectores, Relaciones, Access, VMs SIA, Usuarios
Netskope y Ayuda en dark/light. Rechaza identificadores snake_case en el texto
visible de interfaz, excluyendo filas de inventario y bloques explícitos de
código: un nombre o ID real puede contener guiones bajos. Los enums de VMs y
Access se comprueban en sus celdas. Limpieza usa su fixture propietario y
extiende su test existente, con sus seis categorías y datos reales del contrato;
no se agrega una segunda prueba con una respuesta genérica inválida.

Relaciones mantiene las cinco columnas antes de buscar, con una sola instrucción
global de inicio. No renderiza cinco placeholders con la misma frase. Al elegir
un nodo conserva los mensajes de frontera y el recorrido. La comprobación vive
en la prueba propietaria de columnas canónicas, sin duplicarla en `cross`.
Steering muestra «Límite por tipo de túnel: N sitios» una vez cuando los dos
límites conocidos coinciden; cada tipo conserva su propio límite si difieren.
Un valor desconocido no se transforma en cero ni hereda el límite del otro tipo.
Se conservan conteos, catálogo Netskope, filtros, retry y análisis Axe.

Control final contra el build anterior: **12 fallos y seis pases** en 18 casos;
fallan los textos antiguos, el tipo Target, las instrucciones repetidas y el
límite duplicado. No se cuenta como regresión el intento previo de Limpieza
que carecía de su fixture ni el puerto ocupado del preview. El primer barrido
actual pasó 36 de 38; dos expectativas antiguas todavía pedían la instrucción
por columna. Se actualizaron conservando los cinco destinos. La repetición
final completa pasa **38 E2E en ambos temas**.

`npm run verify` completo: **1.491 backend**, **433 frontend**, build/typecheck,
probes y controles del repositorio en verde. Se cierra 017; 018 sigue parcial.
Quedan **10 criterios abiertos**: ocho parciales
(004, 009, 015, 018, 021, 022, 023, 024) y dos pendientes (008, 019).
Commits `2bfc3cc6` (copy/Relaciones), `b2e29338`
(límites de Steering), más el commit de documentación de este registro.
Sin cambios de APIs, migraciones, push ni despliegue.


## Cierre posterior: aclaraciones repetidas 018

Salud PAM conserva conectividad, versiones y observación; la explicación de
los conteos está en una ayuda junto al título, cuyo nombre accesible se
conserva. Hallazgos mantiene «Filtros Custodia», cobertura y frescura separadas
por fuente y sus errores/permisos; se elimina la segunda frase de alcance.

Inventario Netskope reúne la explicación del vínculo exacto y los límites de
la evaluación en su ayuda. Fuente y vigencia siguen visibles. La franja de
filtros activos aparece sólo cuando existe un filtro; quitar filtros,
restaurar enlaces y copiar el identificador mantienen sus contratos.

Las pruebas propietarias se extendieron sin duplicar fixtures. El build
anterior falla los ocho casos afectados en ambos temas. La corrida amplia
posterior tiene 121 pases y un fallo por una expectativa antigua del texto
fijo, corregida para verificarlo en la ayuda. Una primera repetición tuvo
nueve pases y un timeout de Axe con suites simultáneas; la repetición aislada
final pasa los diez casos en 43,9 s, incluidos los escaneos Axe y ambos temas.

`npm run verify` completo: 1.491 backend, 433 frontend, tipos/build,
PostgreSQL efímero, probes y harness en verde. Sin nuevas migraciones.
Estado en ese avance: **17 cerrados, siete parciales y dos pendientes**. Quedan
004, 008, 009, 015, 019, 021, 022, 023 y 024.

Commits: `c7027055` (PAM/Hallazgos), `6348ad39` (Netskope).

## Medición HTTP sostenida de 004 (2026-10-08)

Evidencia final proporcionada por el dueño del tracker: backend local en
`:8000`, reiniciado a las **02:32** con el código de **`3920897b` + `e739c951`**,
base configurada y Bearer personal de sólo lectura. **Corrida 2: backend
caliente, load average 0,6**. Treinta rondas por endpoint, cuatro segundos
entre rondas, un solo cliente. Todas las respuestas fueron **200**; sólo se
registraron códigos y tiempos, sin payloads ni credenciales. No se realizaron
mediciones adicionales para este cierre. Presupuesto adoptado: **p95 ≤ 1 s
por endpoint**.

| Endpoint | n | Códigos | p50 | p95 | máx. |
| --- | --- | --- | --- | --- | --- |
| `/api/chains/person/coverage` | 30 | 200 | 0,52 s | 0,59 s | 0,77 s |
| `/api/cyberark-risk/overview` | 30 | 200 | 0,50 s | 0,76 s | 1,16 s |
| `/api/cmdb/netskope/metrics` | 30 | 200 | 0,36 s | 0,40 s | 0,43 s |
| `…/metrics?os=Windows` | 30 | 200 | 0,31 s | 0,33 s | 0,36 s |
| `…/metrics?os=macOS` | 30 | 200 | 0,11 s | 0,12 s | 0,12 s |
| `…/metrics?classification_status=unclassified` | 30 | 200 | 0,11 s | 0,12 s | 0,14 s |

Las seis variantes cumplen el presupuesto p95. El máximo de overview es
**1,16 s** y se conserva explícitamente: el criterio de cierre es p95 ≤ 1 s,
no que cada solicitud esté por debajo de un segundo.

**Observación descartada como evidencia de cierre:** corrida 1 inmediatamente
después del reinicio, con backend frío: p95 de **1,31 s** en Cobertura,
**1,56 s** en métricas y **1,46 s** con `os=Windows`; máximos de **2,4–2,6 s**.
El pico también apareció en Cobertura y overview, que `3920897b` no modifica;
el dueño lo atribuye al arranque en frío y no al commit. Esa corrida no cumple
el presupuesto y no se usa para cerrar 004.

**Contexto histórico:** la tabla anterior de treinta rondas pertenecía al
backend iniciado a las **01:11**, con código **anterior a `3920897b`**, de doce
consultas. Informaba p95 de 0,62 s en Cobertura, 0,72 s en overview y 0,47 s en
métricas. No demuestra el rendimiento del código de seis consultas. Antes de
la auditoría (2026-10-07), Cobertura tardaba **7,4 s**, overview **1,5 s** y
métricas **2,3 s**.

**Límites:** un solo cliente sin carga concurrente; overview incluye la
latencia del proveedor; los valores de filtro salen de la base local; las
mediciones dependen del calentamiento del backend. No se afirma un presupuesto
para arranque en frío ni bajo carga concurrente. Sin cambios de código ni
migraciones en este cierre documental.


## Avance 004 — distribuciones y HTTP completo (2026-10-08)

En ese avance 004 permanecía **En curso**, antes de recibir la evidencia
final del dueño registrada arriba. Las siete distribuciones seleccionadas de Métricas
Netskope comparten ahora una sentencia: `GROUPING SETS` sobre la población
reciente filtrada de dispositivos y sobre usuarios activos, con límites por
métrica (8 o 40), orden por conteo y clave, y «Sin dato» para valores ausentes.
Una selección que no pide distribuciones no ejecuta esa lectura. El servicio
completo pasa de doce a seis consultas; no se afirma que su conteo base,
diagnósticos y cruce usuario/equipo compartan todos un snapshot.

La prueba propietaria introduce una sync confirmada después de la primera
lectura: el código anterior mezcla cinco dispositivos con seis en otras
distribuciones; la consulta nueva conserva cinco para todas y una lectura
posterior ve seis. La prueba de selección valida filtros, scoping de usuarios
frente a dispositivos, registros retirados/antiguos, claves distintas y los
límites reales de ocho y cuarenta buckets. Ambas pruebas fallan con el código
anterior (cinco subcasos); los treinta tests propietarios pasan después.

Siete comparaciones anterior/nueva dentro de la misma transacción
repeatable-read de sólo lectura devuelven respuestas idénticas. El caso
completo midió **493 → 341 ms**; cuatro distribuciones seleccionadas,
**134 → 87 ms**; sólo total, **35 → 35 ms**. `EXPLAIN (ANALYZE, BUFFERS)`
dentro del mismo snapshot: siete sentencias, **163,848 ms** de ejecución
sumada; consulta compartida, **121,829 ms**. Los planes pasan de siete
recorridos del inventario a dos (dispositivos y usuarios). No hay nuevas
migraciones.

El perfil aislado del servicio completo midió **2.847 ms / doce consultas**
antes y **449 ms / seis consultas** después. El cruce usuario/equipo fue
**1.289 ms / 257 ms** sin cambiar su código, por lo que esa diferencia incluye
carga/caché y no se atribuye íntegramente a la agrupación de distribuciones.
La comparación dentro del mismo snapshot es la evidencia más acotada del
cambio.

HTTP **TCP local**, con la composición real de `main.py`, middleware,
autorización efectiva, serialización, pool de ocho conexiones y auditoría
habitual de lectura de riesgo. Se omite el scheduler y no hay sync ni cambios
de inventario. No es una medición del proxy/host desplegado. Por endpoint se
registra una primera lectura y diez muestras posteriores, intercaladas entre
los tres endpoints con una pausa de un segundo entre rondas:

| Endpoint | Primera lectura (ms) | Mediana posterior (ms) | p95 / máximo posterior (ms) |
| --- | ---: | ---: | ---: |
| `/api/chains/person/coverage` | 1.498,90 | 1.234,01 | 1.474,42 |
| `/api/cyberark-risk/overview` | 1.603,01 | 599,61 | 745,53 |
| `/api/cmdb/netskope/metrics` | 2.488,61 | 1.320,22 | 2.212,97 |

Esta serie TCP local corresponde al código **anterior** de distribuciones y
se conserva como contexto histórico. Cobertura y Métricas no cumplían
sostenidamente un segundo; riesgo tampoco en la primera lectura. El reporte
paralelo inicial se identificó después como código de doce consultas. El dueño
aportó ahora las dos corridas sobre `3920897b/e739c951`: únicamente la corrida
caliente de treinta rondas de la sección anterior se usa como evidencia final.
Se resuelve así la falta de confirmación de versión y procedencia. No se
atribuye toda la mejora a distribuciones: los tiempos dependen también del
calentamiento y de la latencia del proveedor.


Validación de este avance: `npm run verify` completo en verde, con **1.492
pruebas backend**, **433 frontend**, tipos/build y PostgreSQL efímero. Grupo
propietario `test:e2e:netskope` completo con ambos proyectos habilitados para
las vistas propietarias: **218 E2E en dark/light**, todos en verde. Puerto y
build privados; sólo escritorio. No hay cambios de CSS, contratos externos,
permisos, migraciones ni despliegue. En ese avance 004 permanecía en curso;
la auditoría tenía **17 cerrados, siete parciales y dos pendientes**.

Commit de código: `3920897b` (UX-AUD2-004). Comparaciones con el código
anterior a ese commit; el merge `d2653eaf` no alteró el árbol de partida.


## Cierre 004 con evidencia final del dueño (2026-10-08)

Se cierra 004 con la corrida caliente de treinta rondas de cada una de las
seis variantes, sobre `3920897b/e739c951`. Las mediciones frías y anteriores
se conservan como contexto. Código: `3920897b`; documentación del avance:
`e739c951`; documentación de cierre: el commit que introduce esta sección
(`docs(audit): cerrar UX-AUD2-004 con medición HTTP del dueño`).

Estado en el cierre de 004, verificado contra el tracker: **18 cerrados, seis parciales y
dos pendientes**. Quedan ocho puntos: pendientes **008 y 019**; parciales
**009, 015, 021, 022, 023 y 024**. Siguiente orden: **008 → 019 → barridos
015 y 021–024**, cada barrido con lista explícita de pantallas faltantes antes
de implementar. 009 conserva su estado parcial. **FE-CSS-001 sigue bloqueado**
hasta cerrar los veintiséis criterios.

Verificación del cierre documental: `node scripts/check-task-trackers.mjs`,
`npm run verify` completo (1.492 backend, 433 frontend, tipos/build,
PostgreSQL efímero y harness) y `git diff --check`, en verde. No se realizaron
nuevas mediciones HTTP ni cambios de código en este paso.


## Cierre UX-AUD2-008 — estado compartido de Netskope (2026-10-08)

Código: `c26f93f6`. Documentación: el commit que introduce esta sección,
`docs(audit): cerrar UX-AUD2-008 con evidencia dark y light`.

La fuente de verdad es la evidencia del último intento con
`source_system = netskope` y `source_file = netskope-api`, ya usada por las
evaluaciones del backend. El nuevo GET `/api/cmdb/netskope/sync-evidence`
expone exclusivamente `source_status`, `source_completed_at`, `source_fresh`
y `as_of`, con los permisos de lectura del catálogo. No consulta al proveedor.
La vigencia la decide el backend: sólo un intento completo dentro de las
últimas 24 horas; no se toma la última corrida exitosa saltando un fallo o
una parcial posterior. Las capturas de alertas, DLP, UCI y Steering no
certifican el inventario de clientes.

El registro propietario declara el contrato de presentación, los permisos y
la query key `['netskope', 'sync-evidence']`. El shell selecciona el registro
de la herramienta dueña del workspace; el hook compartido consume esa misma
consulta que Métricas y los inventarios de equipos/usuarios. No importa
componentes concretos Netskope desde el shell. Los lectores ven el estado sin
necesitar permiso para iniciar sync. La consulta tiene staleTime de 30 s,
sondeo cada 60 s e invalidación al iniciar/terminar una sync y al cambiar la
clave de refresco. Un error de lectura muestra información no disponible en
ambas superficies, sin recurrir a una captura o fecha de observación distinta.

El texto requerido en header y vista es idéntico. Las tarjetas no vuelven a
mostrar el estado: conservan la fecha de observación cuando describe el dato,
los filtros y los conteos. La disponibilidad de una evaluación pertenece a su
snapshot; una tarjeta no calculable no declara por su cuenta otro estado
actual del sync. La explicación metodológica permanece en HelpHint. No se
modifica el cálculo ni la protección que impide evaluar abandono con evidencia
no vigente.

### Evidencia y comandos

- Regresión propietaria `UX-AUD2-008`: con el código anterior falla en los
  dos proyectos porque un lector no tiene estado en el header. Con el nuevo, el último
  intento parcial prevalece sobre las fechas de observación, la evidencia
  vigente de los payloads de métricas/inventario y una corrida de alertas
  completada. Verifica el mismo texto en header, Métricas, equipos y usuarios,
  una sola petición por pantalla y la indisponibilidad coherente ante HTTP 503.
- Backend propietario: sesión requerida, lectura Netskope o administración
  admitidas, DLP solo rechazado antes de leer datos. Prueba HTTP y contrato
  OpenAPI focalizados: dos pases.
- `E2E_PORT=4262 npm --prefix frontend run test:e2e:netskope -- --config
  /tmp/custodia-008-playwright.config.ts`: **220 pases**. Ambos proyectos ejecutan
  todos los casos, sin limitar el proyecto light al shell de autenticación.
- Comprobación de los ajustes finales con `npm --prefix frontend run test:e2e
  -- --config /tmp/custodia-008-playwright.config.ts --grep
  'UX-AUD2-008|header.*sync|product without runs|the stale card counts|the personal board shows unclassified|UX-AUD2-013: Netskope'`:
  **12 pases**; prueba propietaria de tarjetas por diagnóstico con
  `/tmp/custodia-008-preview.config.ts`: **dos pases**. Incluye ambos temas.
- `E2E_PORT=4262 npm --prefix frontend run test:e2e:cross -- --config
  /tmp/custodia-008-preview.config.ts`: **400 pases y dos fallos** de una misma
  expectativa que todavía exigía el estado dentro de la tarjeta. Se ajustó
  para leer el estado compartido y conservar el método en HelpHint. Repetición
  con el mismo comando y `--grep 'Netskope explanations preserve unknowns'`:
  **dos pases**, dark/light. No quedan fallos conocidos sin resolver de esa
  corrida. El config de preview reutiliza el build final aislado en `/tmp`.
- `npm run verify`: **1.493 backend, 433 frontend**, PostgreSQL efímero,
  compilación, ruff, scripts de inspección, Postman, estilos, tipos generados,
  build y harness en verde. En las corridas previas detectó la descripción
  OpenAPI faltante y la colección Postman desactualizada; ambas corregidas.
- `node scripts/check-task-trackers.mjs` y `git diff --check` para el cierre
  documental. No se realizaron nuevas mediciones HTTP de rendimiento.

### Archivos del punto

Código, contratos generados y pruebas (commit `c26f93f6`):

- `backend/app/netskope/sse/api/routes/cmdb_netskope.py`
- `backend/tests/netskope/test_netskope_sync_evidence_http.py`
- `api/postman/Custodia.postman_collection.json`
- `frontend/src/source-contract.ts`
- `frontend/src/sources.ts`
- `frontend/src/cross/components/app-header.tsx`
- `frontend/src/cross/hooks/use-tool-sync-presentation.ts`
- `frontend/src/netskope/sse/source.ts`
- `frontend/src/netskope/sse/lib/netskope-sync-evidence.ts`
- `frontend/src/netskope/sse/components/netskope-workspace.tsx`
- `frontend/tests/netskope/sse/netskope-sync-evidence.unit.test.ts`
- `frontend/tests/e2e/netskope/sse/netskope.spec.ts`
- `frontend/tests/e2e/cross/sync-status.spec.ts`
- `frontend/tests/e2e/cross/metric-reading.spec.ts`
- `frontend/tests/e2e/cross/ux-aud.spec.ts`
- `frontend/tests/e2e/support/fixtures.ts`

Documentación del cierre: `docs/tracking/TO_IMPLEMENT.md`,
`docs/tracking/IMPLEMENTED.md` y este checkpoint.

Estado histórico al cerrar 008, contrastado con el tracker: **19 cerrados, seis parciales y un
pendiente**. Quedan **siete puntos**: pendiente **019**; parciales **009, 015,
021, 022, 023 y 024**. Siguiente orden: **019 → barridos 015 y 021–024**, con
lista explícita de pantallas faltantes antes de implementar cada barrido;
009 sigue parcial. **FE-CSS-001 permanece bloqueado** hasta cerrar los 26.
Sin bloqueos externos, migraciones, cambios de CSS ni push en este punto.


## Decisión UX-AUD2-019 — columnas constantes (2026-10-08)

Se adopta la alternativa de quitar columnas independientes y consolidar su
información en celdas de contexto. No se calcula homogeneidad con `rows`, ni
se oculta una columna según una página parcial. El esquema es fijo para todo
el resultado filtrado y todas sus páginas; no se afirma que los valores sean
constantes en la base. Se conservan las diferencias incluso cuando aparecen
recién al cargar otra página.

| Vista | Columnas a quitar | Conservación del dato |
| --- | --- | --- |
| Identity, Roles y grupos | Tipo | Tipo accesible del chip e identificación del grupo; el contexto Roles/Grupos evita repetir Rol de CyberArk por fila. |
| Hallazgos PAM | Fuente, Categoría / tipo | Procedencia y categoría/tipo junto al hallazgo; Custodia y CyberArk siguen claramente separados por fila, incluso en resultados mixtos. |
| Activos de Access | Estado | Estado informado junto al activo; ausencia de estado explicada en HelpHint, sin repetir Sin estado. |
| Máquinas virtuales SIA | Tipo, Ubicación | Tipo distinto del contexto Máquina virtual y método de ubicación en el contexto de cada recurso; sin inferir direcciones ni descartar variantes. |
| Usuarios Netskope | Primera/Última observación | Una columna Observación: una fecha si coinciden, intervalo con ambas cuando difieren; timestamps originales accesibles y conservados en el drawer. |
| Equipos Netskope | Diagnóstico | Decisión humana junto a Revisión, conservando diagnóstico, estado y volvió a reportar; ausencia de decisión explicada en HelpHint. |

Implementado en `5bb70553`, verificado con páginas parciales y valores
distintos en la siguiente página. No requiere migraciones ni modificar el
contrato de filtrado del backend.

## Cierre UX-AUD2-019 — columnas consolidadas (2026-10-08)

Código: `5bb70553`. Documentación: el commit que introduce esta sección,
`docs(audit): cerrar UX-AUD2-019 con columnas y temas verificados`.

Se implementó y verificó la lista de seis vistas de la decisión anterior.
No hay heurística basada en la página cargada ni ocultamiento condicional
por homogeneidad: las columnas permanecen estables al cambiar filtros o
cargar otra página. Los timestamps se comparan por su cadena original;
observaciones distintas dentro del mismo minuto conservan ambos valores
y su precisión en los atributos datetime. Una decisión explícita con
diagnóstico indeterminado también conserva su estado; sólo se omite el
placeholder cuando no existe decisión humana.

### Corrección de la evidencia de temas

Se detectó que `colorScheme` de Playwright sólo cambia la preferencia del
navegador: Custodia inicia en dark si no tiene preferencia guardada. El fixture
ahora aplica `custodia-theme:v1` a los casos de auditoría. Los seis casos
propietarios de 019 y el de 008 comprueban el data-theme efectivo.

Las corridas anteriores que sólo seleccionaban el proyecto light no prueban
por sí solas el tema claro de la aplicación. Los casos que ya cambiaban
explícitamente data-theme (por ejemplo los de teclado/Axe de Hallazgos)
sí ejercitaban ambos temas. Durante este cierre se revalidaron 008 y los
58 casos Cross de auditoría con la preferencia real. Esta nota corrige el
alcance de las menciones anteriores a los dos proyectos, sin presentar esas
corridas como evidencia de un tema que no aplicaban.

### Verificación y comandos

- Control anterior: seis pruebas propietarias, **12 fallos** en los dos
  proyectos, por columnas y celdas antiguas. Esas corridas preceden a la
  corrección del fixture de temas; no se atribuye al proyecto light una
  cobertura real de tema claro.
- `E2E_PORT=4263 npm --prefix frontend run test:e2e:cyberark -- --config
  /tmp/custodia-019-playwright.config.ts`: **253 pases y 11 fallos** de expectativas
  anteriores: Tipo duplicado, ruta Identity raíz, celdas Tipo/Categoría y
  posición del objeto de un hallazgo. Se actualizaron conservando permisos,
  navegación, nombres ausentes, IDs opacos y detalle.
- `npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-019-playwright.config.ts --grep
  'UX-AUD2-019|UX-AUD2-008|an admin classifies a device|posture desktop keyboard|identity navigation has two tabs|Federaciones tab is hidden|SIA resources workspace shows VM|posture retains local detail|legacy findings fall back|authorized missing entity names'`:
  **44 pases**, incluidas las expectativas anteriores corregidas y teclado/Axe
  en 1280×720 y 1440×900.
- `E2E_PORT=4263 npm --prefix frontend run test:e2e:netskope -- --config
  /tmp/custodia-019-preview.config.ts`: **220 pases y cuatro fallos** de las dos
  listas de columnas que todavía exigían Diagnóstico. Se ajustaron al esquema
  consolidado, sin quitar filtros, enlaces, estados ni accesibilidad.
- Repetición final con `npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-019-preview.config.ts --grep
  'UX-AUD2-019|UX-AUD2-008|NSK-INVENTORY-UX-001|Netskope inventory presents'`:
  **18 pases**. Verifica data-theme real en los propietarios, páginas posteriores
  de Access/VMs/usuarios/equipos, procedencia mixta de hallazgos y timestamps
  distintos dentro del mismo minuto. No quedan fallos conocidos de las
  corridas de plataformas sin resolver.
- `E2E_PORT=4263 npm --prefix frontend run test:e2e:cross -- --config
  /tmp/custodia-019-preview.config.ts --grep 'UX-AUD2-'`: primera corrida,
  **56 pases y dos fallos** del selector de Tipo de VM retirado; corregido para
  comprobar la cabecera Máquina virtual. Repetición completa: **58 pases**
  con preferencias reales dark/light.
- `npm run verify`: **1.493 backend y 433 frontend**, PostgreSQL efímero,
  compilación, ruff, probes/Postman, estilos, tipos, build y harness en verde.
- `node scripts/check-task-trackers.mjs` y `git diff --check` para el cierre.
  Los configs privados sólo amplían el proyecto light a los specs propietarios
  y usan build/preview aislados en /tmp; no se incorporan al repo.

### Archivos cambiados

Código y ajustes visuales mínimos junto al dueño:

- `frontend/src/cyberark/access/components/access-assets-workspace.tsx`
- `frontend/src/cyberark/identity_administration/components/identity-admin-workspace.tsx`
- `frontend/src/cyberark/pam/components/posture-workspace.tsx` y `posture-workspace.css`
- `frontend/src/cyberark/shared/components/catalog-list-panel.tsx` y `catalog-list-panel.css`
- `frontend/src/cyberark/sia/components/sia-resources-workspace.tsx`
- `frontend/src/netskope/sse/components/netskope-workspace.tsx`

Pruebas y soporte: `frontend/tests/e2e/support/fixtures.ts`,
`cross/ux-aud.spec.ts`, `cyberark/identity_administration/identity.spec.ts`,
`cyberark/pam/pam.spec.ts`, `cyberark/risk_management/posture.spec.ts`,
`cyberark/sia/sia.spec.ts` y `netskope/sse/netskope.spec.ts`, bajo
`frontend/tests/e2e/`. Documentación: `TO_IMPLEMENT.md`,
`IMPLEMENTED.md` y este checkpoint.

Estado histórico al cerrar 019, contrastado con los 26 criterios: **20 cerrados, seis parciales
y cero pendientes**. Quedan **009, 015, 021, 022, 023 y 024**. Siguiente:
barrido 015 y luego 021–024, con lista explícita de pantallas antes de
implementar cada punto; 009 sigue parcial. FE-CSS-001 continúa bloqueado.
No creció styles.css. Sin cambios de backend, migraciones, nuevas mediciones
HTTP ni push. Sin bloqueo externo ni acción requerida al dueño para continuar.

## Barrido UX-AUD2-015 — lista previa a implementar (2026-10-08)

Dueño: presentación del shell en cross, metadatos de cada source.ts y
cabeceras locales de PAM, Identity, SIA, Access y SSE. Se conserva un H1 por
vista, los controles, las cifras y las secciones con propósito distinto.
La ayuda metodológica se ancla junto al título principal mediante metadatos
neutrales del workspace; no se reemplaza por un icono aislado en una fila.

| Pantalla / vista concreta | Pendiente comprobado antes de implementar |
| --- | --- |
| /pam/safes, Vigentes y Retiradas | Retirar Inventario de Safes y Safes retiradas, repetidos del H1/pestaña, y sus descripciones; mantener vigencia, conteo, sólo lectura, acciones y secciones Safe Health/Cuentas y plataformas. |
| /pam/identity/users y alias /pam/identity | Retirar H2 Usuarios y la descripción idéntica al H1; mantener conteo, navegación y filtros. |
| /pam/identity/roles y alias /pam/identity/groups | Control de conservación: el panel embebido ya omite el H2; verificar que siga sin duplicarlo. |
| /pam/roles | Retirar H2 Roles CyberArk y el segundo párrafo; mantener conteo y clasificación por nombre en ayuda. |
| /pam/sia, Políticas | Retirar Políticas de acceso, duplicado de la pestaña, y llevar el alcance metodológico a la ayuda del título principal. |
| /pam/sia/resources | Retirar título y descripción del catálogo que repiten la pestaña/H1; conservar conteo, búsqueda, fechas y restricciones en ayuda. |
| /pam/sia/database-accounts | Retirar el segundo título/descripción; conservar el catálogo operativo y su límite de credenciales en ayuda. |
| /pam/sia/target-sets | Retirar el segundo título/descripción; conservar el catálogo y sus límites de datos en ayuda. |
| /pam/access-assets | Retirar título/descripción repetidos; conservar la explicación de estados de 019 junto al H1. |
| /pam/assets y alias /pam/ip-inventory | Retirar H2 Inventario de infraestructura y segunda descripción; mantener conteo, importación autorizada, filtros y tabla. |
| /pam/connectors, PSM y SIA; alias /pam/sia/connectors | Retirar Conectores y segundo párrafo; conservar selector, conteo, búsquedas y aislamiento de inventarios. |
| /pam/platforms, Inventario activo | Retirar CATÁLOGO PAM y Plataformas activas redundantes; mantener contador de activas y selector. Política CPM y Tipos de conector son secciones distintas y se conservan. |
| /netskope/inventory y /netskope/devices | Retirar Inventario de equipos como segundo título contextual; conservar estado compartido de 008 y ayuda de evidencia junto al H1. |
| /netskope/users | Retirar Cobertura de usuarios como segundo título contextual; conservar estado de 008, filtros y ayuda de evidencia junto al H1. |

También se verificará que las descripciones principales de esta lista ocupen
una línea en desktop 1280×720, sin elipsis ni ocultamiento de texto. Métricas
PAM/Netskope ya no repiten el saludo del H1; sus títulos internos y contadores
se revisan en 021. Hallazgos no conserva un título repetido de vista;
sus ayudas/filas de botones se revisan en 022. Steering y Experiencia digital
tienen títulos de bloques distintos del H1. No se amplía el alcance a mobile.

Estado: lista registrada antes de modificar código y **verificada completa**
al cerrar 015. Los quince casos de ruta cubren las catorce filas, incluyen
los alias y las variantes Retiradas, SIA y CPM; cada caso comprueba el tema
real, cabecera, descripción sin recorte, ayuda contextual y controles.
Roles y grupos es el control conformante que ya pasaba antes. Evidencia abajo.


## Cierre UX-AUD2-015 — cabeceras y ayuda contextual (2026-10-08)

Código: **c3f32d32**. Docs del cierre: este commit, con título
`docs(audit): cerrar UX-AUD2-015 contra el barrido de pantallas`.

### Decisión y lista verificada

Se verificaron todas las filas de la lista anterior en desktop 1280×720:
Safes vigentes/retiradas; Identity usuarios y alias raíz; roles/grupos y alias;
roles PAM; políticas, VMs, cuentas BD y target sets SIA; Access; infraestructura
y alias; conectores PSM/SIA y alias; plataformas activas/CPM; equipos Netskope
por ambas rutas y usuarios Netskope. Quince rutas primarias, treinta ejecuciones
en dark/light reales; los alias y variantes se ejercitan dentro de sus casos.
No quedan pantallas abiertas en la lista de 015.

El shell presenta un H1 y una descripción de una línea, sin elipsis. La
metodología y límites se declaran en el source.ts de la herramienta y se
presentan en HelpHint junto al H1 mediante un contrato neutral. No se repiten
en cabeceras ni pies de catálogos embebidos. Se conservan fuente/estado Netskope
de 008, sólo lectura de Retiradas, cifras, búsquedas, filtros y acciones. Política
CPM, tipos de conector y Destinatarios SIA conservan títulos de secciones
con propósito distinto, con jerarquía accesible y el tamaño visual anterior.

Cambiar de workspace remonta su introducción y cierra la ayuda anterior,
incluso al activar una pestaña con teclado o volver por historia. Esta
regresión es distinta del cierre por mousedown/Escape. La ayuda de Safes
promete conservar responsable y unidad; no hace una promesa absoluta sobre
el estado, que tiene la excepción aprobada de Baja retenida. El inventario
importado no crea vínculos normalizados nuevos entre herramientas.

### Comandos y evidencia

- Contra el build anterior 4f351b89, config privado
  `/tmp/custodia-015-red.config.ts`, grep `UX-AUD2-015`: **26 fallos y dos pases**
  (roles/grupos ya conformantes). Al agregar la ruta /netskope/devices se
  repitió contra ese mismo baseline: **dos fallos** por el título repetido.
  Total de regresión de cabeceras: **28 fallos, dos controles conformantes**.
- La regresión de navegación por teclado se corrió contra el primer build
  que no remontaba la introducción, config privado
  `/tmp/custodia-015-help-red.config.ts`: **dos fallos**, la nota anterior seguía
  abierta al navegar. Corregida en App con identidad por workspace.
- `npm --prefix frontend run typecheck`: aprobado. Los builds posteriores
  también verificaron los tipos.
- `E2E_PORT=4264 npm --prefix frontend run test:e2e:cross -- --config
  /tmp/custodia-015-playwright.config.ts --grep 'UX-AUD2-'`: **88 pases** iniciales.
- `E2E_PORT=4264 npm --prefix frontend run test:e2e:cyberark -- --config
  /tmp/custodia-015-playwright.config.ts`: **258 pases, seis fallos**. Axe detectó
  los saltos de encabezado en Retiradas y Destinatarios SIA tras retirar el
  segundo título; se reparó la jerarquía, conservando tamaños. El caso de
  debounce se adelantaba a la petición inicial después de esperar el H1 del
  shell; ahora espera el buscador propietario y la primera petición antes
  de contar las siguientes. Sin quitar aserciones ni ampliar timeouts.
- `E2E_PORT=4264 npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-015-playwright.config.ts --grep
  'UX-AUD2-|Retiradas lists Safes|SIA recipient controls work with Enter|SIA policy search is debounced|Netskope inventory presents'`:
  **116 pases**, incluidos los seis fallos anteriores corregidos, Axe y
  los contratos de 008/019 conservados.
- `E2E_PORT=4264 npm --prefix frontend run test:e2e:netskope -- --config
  /tmp/custodia-015-playwright.config.ts`: **224 pases**.
- Comprobación final con `npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-015-playwright.config.ts --grep
  'UX-AUD2-015|UX-PERSON-002: the Netskope platform keeps its own deep link|Retiradas lists Safes|SIA recipient controls work with Enter|SIA policy search is debounced'`:
  **40 pases**, incluidos los 32 propietarios de 015 en los temas reales
  y el deep link de Personas cuyo selector quedó actualizado.
- Primera corrida `npm run verify`: el import sin extensión del módulo de
  ayuda rompía nueve suites del registro en Node, aunque Vite lo resolvía.
  Corregido al patrón .ts del registro. La siguiente corrida dejó **432/433**
  por una expectativa del nombre largo de SIA en la descripción; actualizada
  a su rótulo corto, conservando las comprobaciones de separación por dominio.
  Repetición completa final: **1.493 backend y 433 frontend**, PostgreSQL
  efímero, ruff, probes, estilos, tipos, build y harness en verde.
- Sobre ese build final, `npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-015-built-preview.config.ts --grep
  '/pam/safes has one view heading|/pam/assets has one view heading|Retiradas lists Safes'`:
  **seis pases** tras precisar el texto de ambas ayudas.
- `node scripts/check-task-trackers.mjs` y `git diff --check` en el cierre.

Los configs privados conservan dos workers, timeouts y Axe del repositorio;
usan un preview propio y amplían los specs de light. Los casos UX-AUD2-015
comprueban data-theme real; las pruebas Axe que cambian el tema lo aplican
explícitamente. No se atribuye tema claro real a todo caso genérico sólo por
el nombre del proyecto.

### Archivos cambiados

- `frontend/src/App.tsx`
- `frontend/src/cross/components/connection-inventory-workspace.tsx`
- `frontend/src/cross/components/workspace-intro.css`
- `frontend/src/cross/components/workspace-intro.tsx`
- `frontend/src/cyberark/access/components/access-assets-workspace.tsx`
- `frontend/src/cyberark/access/source.ts`
- `frontend/src/cyberark/identity_administration/components/identity-admin-workspace.tsx`
- `frontend/src/cyberark/identity_administration/source.ts`
- `frontend/src/cyberark/pam/components/pam-platforms-workspace.tsx`
- `frontend/src/cyberark/pam/components/pam-roles-workspace.css`
- `frontend/src/cyberark/pam/components/pam-roles-workspace.tsx`
- `frontend/src/cyberark/pam/components/pam-technical-catalog.css`
- `frontend/src/cyberark/pam/components/retired-safes-list.css`
- `frontend/src/cyberark/pam/components/retired-safes-list.tsx`
- `frontend/src/cyberark/pam/components/safes-workspace.tsx`
- `frontend/src/cyberark/pam/source.ts`
- `frontend/src/cyberark/shared/components/catalog-list-panel.css`
- `frontend/src/cyberark/shared/components/catalog-list-panel.tsx`
- `frontend/src/cyberark/shared/source.ts`
- `frontend/src/cyberark/sia/components/sia-database-accounts-workspace.tsx`
- `frontend/src/cyberark/sia/components/sia-grantee-detail.tsx`
- `frontend/src/cyberark/sia/components/sia-resources-workspace.tsx`
- `frontend/src/cyberark/sia/components/sia-target-sets-workspace.tsx`
- `frontend/src/cyberark/sia/components/sia-workspace.css`
- `frontend/src/cyberark/sia/components/sia-workspace.tsx`
- `frontend/src/cyberark/sia/source.ts`
- `frontend/src/netskope/sse/components/netskope-workspace.css`
- `frontend/src/netskope/sse/components/netskope-workspace.tsx`
- `frontend/src/netskope/sse/lib/netskope-inventory-help.ts`
- `frontend/src/netskope/sse/source.ts`
- `frontend/src/source-contract.ts`
- `frontend/tests/cross/workspaces.unit.test.ts`
- `frontend/tests/e2e/cross/person.spec.ts`
- `frontend/tests/e2e/cross/ux-aud.spec.ts`
- `frontend/tests/e2e/cyberark/identity_administration/identity.spec.ts`
- `frontend/tests/e2e/cyberark/pam/pam.spec.ts`
- `frontend/tests/e2e/cyberark/pam/safes.spec.ts`
- `frontend/tests/e2e/cyberark/sia/sia.spec.ts`
- `frontend/tests/e2e/netskope/sse/netskope.spec.ts`


Documentación: `TO_IMPLEMENT.md`, `IMPLEMENTED.md` y este checkpoint.
Estado histórico al cerrar 015, contrastado con los 26 criterios: **21 cerrados, cinco parciales
y cero pendientes**. Quedan **009, 021, 022, 023 y 024**. Sigue 021, luego
022–024, con lista concreta antes de cada barrido; 009 conserva su estado parcial.
FE-CSS-001 sigue bloqueado hasta los 26 cierres. No creció ni se reorganizó
styles.css; se hicieron ajustes mínimos junto a los componentes dueños.
Sin backend, migraciones, nuevas mediciones HTTP, push ni bloqueo externo.

## Barrido UX-AUD2-021 — lista previa a implementar (2026-10-08)

Dueño: tablero PAM en general-workspace y tablero SSE en netskope-workspace;
las preferencias y el cálculo de métricas conservan sus contratos. Revisión
sobre desktop 1280×720 y 1440×900, dark/light reales. No hay alcance mobile.

| Pantalla / estado concreto | Trabajo que falta verificar |
| --- | --- |
| /pam, lectura con datos y gráficos | Retirar MI VISTA, Lo que elegiste seguir, subtítulos metodológicos y contadores de datos/bloques; conservar un título por sección, los valores y las acciones de edición/plantillas. |
| /pam, edición | Mantener límites, tamaño, posición, filtros, guardar/cancelar y teclado; no repetir los contadores de bloques en cabeceras. |
| /pam, tablero vacío | Una cabecera del estado; método y alcance de la recomendación en ayuda, conservando las tres acciones y sin guardar automáticamente. |
| /netskope, lectura con inventario | Retirar capas de títulos y contadores; mantener el estado compartido de 008 una vez en el tablero. Poblaciones, filtros y períodos se conservan accesibles desde cada indicador. |
| /netskope, KPI de actividad, equipos, usuarios y revisión | Sublíneas breves de una línea sin recorte; conservar numerador, población, disponibilidad, desconocidos y filtros en ayuda. Diferencia con Netskope mantiene ambos conteos y el signo en su explicación, sin ajustar ninguno. |
| /netskope, grilla con dos gráficos anchos y variantes mixtas | El reparto ocupa la fila sin una celda reservada vacía; conservar el orden y los tamaños guardados, sin reescribir preferencias. Verificar que todos los gráficos y sus drilldowns sigan presentes. |
| /netskope, edición | Quitar guía/contadores redundantes; mantener explicación de interacción, límites, filtros, tamaños, orden y acciones de guardar/cancelar. |
| /netskope, agregados de alertas | Un título de sección; alcance y límites de dimensiones en HelpHint junto al título, con ventanas, disponibilidad y valores operativos visibles. |
| /netskope, tablero vacío | Una cabecera del estado y acciones; explicación de la recomendación en ayuda, sin aceptar/guardar una recomendación automáticamente. |

Estado: lista registrada antes de implementar y **verificada completa**
al cerrar 021: lectura, edición y vacío de PAM/SSE, seis variantes de KPI,
gráficos anchos/mixtos y agregados. No quedan filas abiertas de este barrido. FE-CSS-001 sigue
bloqueado. Los ajustes de disposición se limitarán al componente dueño y a
lo requerido por este criterio, sin mover reglas ni crecer styles.css.

Decisión de disposición de 021: las filas de gráficos SSE usan el espacio
restante mediante flex, con bases relativas de pequeño/ancho/grande y el
orden original. No se modifican, normalizan ni guardan tamaños o filtros
al leer la vista. Un bloque grande ocupa una fila completa; dos anchos
comparten una fila sin la tercera celda reservada del grid anterior. La
regresión verifica también una mezcla ancho/pequeño/grande y cero escrituras.
Las sublíneas conservan una lectura breve; el detalle completo de población,
filtros y captura permanece en la ayuda del indicador. Ningún conteo se
recalcula en la presentación. Las suites finales y los propietarios verifican esta decisión.


## Cierre UX-AUD2-021 — tableros y grillas (2026-10-08)

Código: **5e94ed6c**. Docs del cierre: este commit, con título
`docs(audit): cerrar UX-AUD2-021 con tableros y grillas verificados`.
Las nueve filas del barrido previo están verificadas, sin pantallas pendientes
para este criterio. 009 conserva el barrido de fechas/relativos aún abierto.

### Resultado y límites de la decisión

PAM y SSE usan el H1 de Métricas y un H2 por sección con propósito distinto.
Se retiran MI VISTA, Lo que elegiste seguir, los subtítulos metodológicos y
los contadores de datos/bloques. Se conservan las acciones, límites y controles
del editor, los valores y el estado compartido de SSE de 008. La guía SSE
redundante se retira; el toolbar sigue explicando cómo ordenar y muestra si
hay cambios sin guardar. No se sobrescriben preferencias al leer ni cancelar.

Los tableros vacíos conservan una cabecera y las tres acciones. El alcance y
la aceptación de la recomendación están en HelpHint junto a esa cabecera;
la recomendación sólo se guarda al aceptarla. El bloque de alertas conserva
ventanas, valores y disponibilidad; sus límites de agregación quedan junto
al título en una sola ayuda.

Las sublíneas SSE conservan una lectura breve; la ayuda existente recibe el
detalle completo que antes se recortaba, incluidos filtros y captura. La
diferencia de usuarios no ajusta ningún total y ahora explicita también su
signo en la explicación. Se verifican seis tipos de KPI con población y
valores no triviales, incluido el estado desconocido de cuentas, a 1280×900
y 1440×900. El resto de estados primarios usa desktop 1280×720.

Las filas de gráficos usan bases relativas pequeño/ancho/grande y distribuyen
el espacio restante sin la tercera celda reservada del grid anterior. Se
verifican dos anchos y una mezcla ancho/pequeño/grande: mismo orden, ancho mayor
que pequeño y grande en una fila completa. No se modifican ni se guardan los
tamaños/orden/filtros del contrato; cero escrituras de preferencias al leer.
Los ajustes CSS son mínimos junto a los dueños, sin mover reglas legadas ni
alterar el tope de styles.css. No es el refactor FE-CSS-001.

### Comandos y evidencia

- `E2E_PORT=4266 npm --prefix frontend run test:e2e:cross -- --config
  /tmp/custodia-021-red.config.ts --grep 'UX-AUD2-021'`: **seis fallos** sobre el
  build previo 5e63538c, por títulos redundantes y sublíneas con elipsis.
  La cuarta regresión de agregados se agregó y corrió contra el mismo build,
  grep `UX-AUD2-021: aggregate alerts`: **dos fallos** por la cabecera anterior.
  Total: **ocho controles anteriores fallan por el comportamiento a corregir**.
- `npm --prefix frontend run typecheck`: aprobado; build posterior vuelve
  a comprobar todos los tipos.
- Primera corrida green del criterio: cuatro pases, dos fallos de PAM porque
  el mock de preferencias vacío no contemplaba el query string. Se corrigió
  para comparar pathname. Ampliación de grilla: cuatro pases y dos fallos
  porque se comparaba su ancho con el borde exterior; ahora se compara el
  área interior, descontando padding/bordes, sin aflojar la comprobación.
- `E2E_PORT=4266 npm --prefix frontend run test:e2e -- --config
  /tmp/custodia-021-playwright.config.ts --grep
  'UX-AUD2-021|NSK-XMET-003:.*card|NSK-DEVREV-001: the board|NSK-REF-|NSK-USR-001|NSK-A11Y-002|NSK-HB-001: the stale card|NSK-XMET-003:.*activity'`:
  **20 pases**, incluidos los ocho propietarios de 021 con data-theme real,
  ciclo lectura/edición/vacío, valores, ventanas, filtros, null/No disponible,
  referencia con signo y Axe del editor/drawer. La primera selección de 16
  había dejado cuatro expectativas del texto largo; actualizadas para
  comprobar la lectura breve y el detalle en ayuda, conservando numeradores,
  denominadores, captura y estados de disponibilidad.
- `E2E_PORT=4266 npm --prefix frontend run test:e2e:netskope -- --config
  /tmp/custodia-021-preview.config.ts`: **218 pases y seis fallos** de tres casos
  anteriores: alcance y recomendación en texto fijo, más un selector que
  confundía el nuevo botón Explicar con el botón de drill. Se conservaron
  las aserciones de permiso, conteos, ventana, filtros y guardado explícito.
- Repetición con el mismo build y comando anterior, grep
  `NSK-EMPTY-001|NSK-XMET-001|NSK-UX-003`: **cuatro pases** (los dos primeros
  casos). El alias de alertas se repitió por su ID correcto `NSK-ALR-001`:
  **dos pases**. No quedan fallos de la corrida Netskope sin resolver.
- `E2E_PORT=4267 npm --prefix frontend run test:e2e:cross -- --config
  /tmp/custodia-021-cross.config.ts --grep
  'dashboard.spec.ts|auth.spec.ts|UX-AUD2-'`: **220 pases** de tableros PAM,
  shell/auth y regresiones de auditoría; persistencia, presets, filtros,
  teclado y permisos conservados.
- `E2E_PORT=4267 npm --prefix frontend run test:e2e:cyberark -- --config
  /tmp/custodia-021-cross.config.ts --grep
  'readers see metrics|readers find PAM views|opening PAM from home|CyberArk node in the home'`:
  **ocho pases**, entradas a PAM y métricas sin controles de sync para lectores.
- `npm run verify`, al implementar y otra vez tras corregir las expectativas
  E2E: **1.493 backend y 433 frontend**, PostgreSQL efímero, ruff, probes,
  estilos, tipos, build y harness en verde. `node scripts/check-task-trackers.mjs`
  y `git diff --check` en el cierre.

Los configs privados usan preview/build aislados, dos workers y los timeouts
originales. Los ocho casos de 021 verifican data-theme real en dark/light;
no se atribuye un tema real a cada caso genérico sólo por el nombre de proyecto.
La suite amplia conserva también sus cambios explícitos de tema para Axe.

### Archivos cambiados

- `frontend/src/cyberark/pam/components/general-workspace.css`
- `frontend/src/cyberark/pam/components/general-workspace.tsx`
- `frontend/src/cyberark/pam/source.ts`
- `frontend/src/netskope/sse/components/netskope-metric-reading.tsx`
- `frontend/src/netskope/sse/components/netskope-workspace.css`
- `frontend/src/netskope/sse/components/netskope-workspace.tsx`
- `frontend/src/netskope/sse/source.ts`
- `frontend/tests/e2e/cross/auth.spec.ts`
- `frontend/tests/e2e/cross/ux-aud.spec.ts`
- `frontend/tests/e2e/netskope/sse/netskope-aa.spec.ts`
- `frontend/tests/e2e/netskope/sse/netskope.spec.ts`


Documentación: `TO_IMPLEMENT.md`, `IMPLEMENTED.md` y este checkpoint.
Estado histórico al cerrar 021, contrastado con los 26 criterios: **22 cerrados, cuatro parciales
y cero pendientes**. Quedan **009, 022, 023 y 024**. Sigue 022, luego 023/024
y completar 009, con lista previa de pantallas antes de cada barrido.
FE-CSS-001 sigue bloqueado. Sin backend, migraciones, nuevas mediciones HTTP,
push ni bloqueo externo; no hace falta intervención del dueño para continuar.

## Barrido UX-AUD2-022 — lista previa a implementar (2026-10-08)

La revisión parte de `4721e5f7`. Esta lista se registra antes de modificar
componentes; ninguna fila se da por verificada todavía.

| Pantalla / estado concreto | Falta y criterio de verificación |
| --- | --- |
| SIA › Políticas, sin selección | Mantener la tabla a todo el ancho, sin panel ni drawer vacío. |
| SIA › Políticas, detalle seleccionado | Un único drawer reúne identificación, plataformas, reglas, destinos, Safes/cuentas y destinatarios; eliminar la duplicación entre expansión y lateral. Conservar navegación y referencias autorizadas. |
| SIA › Políticas, teclado / detalle largo | Abrir con Enter, foco dentro del diálogo, Tab/Shift+Tab contenidos, Escape restaura el botón; scroll interno y sin desbordamiento a 1280/1440, dark/light reales. |
| SIA › Políticas, ayuda / vacío / filtros | Glosario junto al título del detalle; vacío compacto sin afirmar conexión externa; limpiar filtros sigue disponible. |
| Personas, estado inicial | Una instrucción de una línea, sin panel explicativo grande ni segundo título; metodología de correo/nombre y ausencia de registro en ayuda junto al H1. |
| Personas, búsqueda / selección / error | Conservar sugerencias, navegación y estados de carga/error; no fabricar registros ni cobertura. Control de regresión del flujo existente. |
| Hallazgos PAM, lector sin acciones | Ayuda junto al H1; no renderizar una superficie vacía dedicada a un ícono o botones inexistentes. |
| Hallazgos PAM, acciones / vacío filtrado | Conservar permisos, actualizar/reintentar y limpiar filtros; vacío de una línea, metodología en ayuda. |
| Hallazgos PAM, Tipos / Evolución | Revisar vacíos y ayudas de ambas subvistas de Risk Management; mantener desconocidos y errores. |
| Netskope › Políticas, con datos | Ayuda ya junto al título: verificar como control conforme, conservar período/frescura y datos. El buscador se revisa en 024. |
| Netskope › Políticas, sin ventana / captura ausente / cero observado / búsqueda vacía | Vacíos compactos; conservar la distinción entre falta de evidencia y captura sin disparos. Explicación en ayuda, limpiar búsqueda disponible. |
| Netskope › Steering, no habilitado / sin captura / cero túneles | Vacíos compactos y ayuda junto al título. Conservar cero frente a desconocido, límites y catálogo de POPs; configuración técnica fuera del texto fijo. |
| Netskope › Steering, POPs vacíos / filtrados / error | Una línea por vacío, limpiar filtros/reintentar disponibles; conservar la captura anterior ante error de refresco. |

Decisión de detalle SIA: el drawer es la única superficie de detalle. La tabla
no reduce su ancho ni mantiene una segunda copia expandida. Se reutiliza el
contrato de foco de los diálogos del sistema; no se cambian APIs, permisos,
relaciones ni migraciones. Los estados vacíos compactos usan el componente del
sistema y conservan las acciones operativas; carga y error mantienen su detalle.

## Cierre UX-AUD2-022 (2026-10-08)

Las trece filas de la lista previa quedan verificadas con las regresiones
`UX-AUD2-022` de `ux-aud.spec.ts` (dark/light reales) y los specs de SIA y
Netskope adaptados. Quedan **009, 023 y 024**. FE-CSS-001 sigue bloqueado. Sin
backend, migraciones ni push.

### Verificación complementaria de 022 (2026-10-08)

El dueño registró la implementación y docs en `8fdccb6a`. Se actualizaron las
expectativas de cabecera de Personas en `2be738eb`, conservando permisos,
poblaciones, navegación y scans Axe. `npm run verify` completo: **1.493 backend,
433 frontend**, PostgreSQL efímero, build y propiedad de estilos en verde.
El grupo Cross focal de Personas/022/filas expandibles produjo **84 pases y
20 expectativas anteriores**; repetido con las expectativas actuales:
**104 pases**. La comprobación posterior de 022 y geometría de Personas,
incluyendo la cabecera actual en Axe, produjo **24 pases** dentro de una corrida
de 30 casos (los otros seis corresponden a 023; cuatro pasan y dos detectan un
ancho de ID PSM que sigue en corrección). Sin backend, migraciones ni push.

Estado histórico al cerrar 022: **23 cerrados, tres parciales y cero pendientes**. Quedaban
**009, 023 y 024**. FE-CSS-001 permanece bloqueado.

## Barrido UX-AUD2-023 — lista previa a implementar (2026-10-08)

Se parte de `8fdccb6a`, que implementa 022. Antes de editar código se registra
este alcance; las filas siguientes permanecen pendientes de verificación.

| Pantalla / celdas concretas | Falta y criterio |
| --- | --- |
| Conectores PAM › PSM: servidor, ID y plataformas asociadas | Repartir las cuatro columnas; nombre de PSM en una línea, conservar texto completo en tooltip/accesibilidad si se recorta. Los nombres de plataformas no se parten dentro de un botón y siguen navegando. |
| Conectores PAM › SIA: versión y estado | Versiones como `141.1.7.2827 (64-bit)` no se parten; conservar estado y sesiones. |
| Netskope › Inventario / Dispositivos: señal, revisión, SO y cliente | Fecha, insignias y versiones atómicas; repartir las siete columnas sin ocultar datos ni inferir valores. Nombres/correos largos conservan su texto completo en tooltip y drawer. |
| Netskope › Usuarios: observaciones y actividad observada | Primera/última observación y actividad en una línea por fecha; conservar fechas distintas y el modo con actividad. |
| SIA › Políticas: vinculación y estado | Control de insignias `Sin coincidencia` / `Vinculada por IP`; no deben partirse ni crear scroll lateral con el detalle cerrado. |
| SIA › Máquinas virtuales / Cuentas BD | Control de fecha de escaneo / modificación: una línea y valores originales conservados. |
| Access › Activos y Hallazgos PAM | Revisar estados/insignias y fechas de tablas compactas como controles conformantes; sólo cambiar donde la geometría falle. |

Criterio: se pueden envolver listas entre chips completos, nunca dentro de una
insignia, fecha o versión. Nombres extremos pueden usar elipsis con su valor
completo accesible; fechas y versiones permanecen legibles. La decisión no
depende de una página parcial ni elimina campos. Verificación desktop 1280/1440,
dark/light reales, pruebas propietarias y `npm run verify`. CSS mínimo junto a
cada dueño; FE-CSS-001 permanece bloqueado y styles.css no crece.

## Cierre UX-AUD2-023 — celdas y columnas (2026-10-08)

Las siete filas de la lista previa quedan verificadas a 1280/1440 px en dark y
light reales. PSM reparte servidor, dirección, ID y plataformas; los nombres
largos mantienen tooltip, nombre accesible y navegación. SIA conserva versión,
estado y sesiones. Dispositivos Netskope reserva espacio para señal, revisión,
SO y cliente; los nombres extremos usan elipsis y conservan el valor completo
en tooltip/drawer. Usuarios conserva observaciones distintas y la actividad
filtrada. Políticas SIA, VMs, cuentas BD y Activos Access son controles
conformantes. Hallazgos PAM reserva ancho para la fecha completa.

Prueba propietaria: geometría del texto renderizado (una línea y dentro de su
celda), ausencia de scroll lateral, valores completos y navegación. No se
verifica por presencia de reglas CSS. El build anterior reproduce cuatro
fallos en PSM/Dispositivos, con dos controles conformantes SIA; la fecha de
Hallazgos reproduce otros dos fallos. Aplicar sólo nowrap deja la fecha fuera
de su columna en ambos temas; repartir los anchos resuelve esa regresión.

Verificación final:

- `npm run verify`: 1.493 backend y 433 frontend, PostgreSQL efímero, build,
  propiedad de estilos y git diff --check en verde.
- Cross propietario: ocho pases; Netskope actividad: dos pases. Estos diez
  casos comprueban explícitamente el tema real de la aplicación.
- E2E CyberArk amplio: **264 pases**.
- E2E Netskope amplio: 218 pases y seis fallos. Dos fueron assets 404 por usar
  inicialmente la misma carpeta de build para dos previews; cuatro fueron
  expectativas/timeout durante la ejecución concurrente. Repetición con
  artefactos congelados independientes, sin ampliar timeout ni retries:
  **13 pases y un timeout de Postura; el caso restante aislado pasa en 13,4 s**.
  No se presenta la corrida amplia como verde de una sola vez.

CSS mínimo en los archivos dueños de PAM y SSE; styles.css no cambia.
Sin backend, migraciones, nuevas mediciones HTTP ni push. FE-CSS-001 sigue
bloqueado. Estado histórico al cerrar 023, contrastado con los 26 criterios: 24 cerrados,
dos parciales (009 y 024), cero pendientes. Sigue 024 con lista concreta previa;
después completar el barrido de fechas de 009.

### Comandos y archivos de 023

- `npm run verify` completo, sin omitir PostgreSQL.
- `npm --prefix frontend run build -- --outDir /tmp/custodia-023-final-dist`.
- `E2E_PORT=4272 npm --prefix frontend run test:e2e:netskope -- --config /tmp/custodia-023-netskope.config.ts`.
- `E2E_PORT=4273 npm --prefix frontend run test:e2e:cyberark -- --config /tmp/custodia-023-cyberark.config.ts`.
- `E2E_PORT=4277 npm --prefix frontend run test:e2e:cross -- --config /tmp/custodia-023-final-owner.config.ts --grep UX-AUD2-023 --workers=1`.
- `E2E_PORT=4274 npm --prefix frontend run test:e2e:netskope -- --config /tmp/custodia-023-netskope-recheck.config.ts --grep 'NSK-VER-001: client compliance|NSK-VER-001: a Netskope admin|NSK-POSTURE-UX-001: posture has no horizontal|NSK-A11Y-001: axe check|single inventory: review evidence|VIS-NSK-HIST-001: device history|UX-AUD2-023' --workers=1`.
- Último caso, sin otras suites activas: mismo comando Netskope/config con
  `--grep 'NSK-POSTURE-UX-001: posture has no horizontal' --project=chromium-dark --workers=1`.
- `node scripts/check-task-trackers.mjs` y `git diff --check`.

Los configs temporales conservan los proyectos del repositorio. Las repeticiones
sirven builds congelados independientes; no se recompilan assets mientras el
preview está en uso. Los diez propietarios afirman el tema real; los nombres
`chromium-light-shell` de otros tests no garantizan por sí solos tema light.
No se afirma que todos los 264/224 casos amplios ejerciten light real.
La suite CyberArk amplia precede al último reparto de ancho de Hallazgos;
el build final y sus ocho controles Cross verifican ese reparto en ambos temas.

Código: `7e6c8869`; docs: este commit, titulado
`docs(audit): cerrar UX-AUD2-023 con celdas y columnas verificadas`.
Archivos de código: `pam-platforms-workspace.tsx`, `pam-technical-catalog.css`,
`posture-workspace.css` (PAM); `netskope-workspace.tsx` y
`netskope-workspace.css` (SSE). Pruebas: `cross/ux-aud.spec.ts`,
`netskope/sse/netskope.spec.ts` y la utilidad de geometría
`support/cell-geometry.ts`. Docs: este checkpoint, `TO_IMPLEMENT.md` e
`IMPLEMENTED.md`. Sin bloqueo externo.

## Barrido UX-AUD2-024 — lista previa a implementar (2026-10-08)

Se parte de `07bb38e4`. Las filas quedan pendientes hasta verificar cada vista.
Propiedad: frontend PAM/SIA/SSE y Cross para Administración; sin backend ni
migraciones. CSS mínimo en el componente dueño, sin aumentar styles.css.

| Pantalla / estado concreto | Falta y criterio |
| --- | --- |
| Safes › tabla y drawer › Unidad sin asignar / asignada | Fondo, borde y texto neutros al no asignar; conservar selector, cambios pendientes y guardado. |
| Safes › cabecera de sincronización | Oración con avisos y relativo dentro de frase sin mayúsculas internas; control conforme y sin inventar frescura. |
| Administración › alta local / hybrid / OIDC | Placeholders de nombre/correo en alta autorizada; OIDC sin alta local. Conservar política de contraseña. |
| Administración › Grupos Okta | Singular para una identidad observada; conservar plural, miembros observados y ausencia de evidencia. |
| Actividad › cinco pestañas y búsquedas de Actividad / Logs / Errores | Tipografía compacta y buscadores del sistema; conservar filtros y consultas. |
| Netskope › Políticas observadas | Buscador del sistema, filtrado/limpieza y orden conservados. |
| Netskope › UCI | Buscador del sistema, búsqueda y calificación conservadas. |
| SIA › Políticas › drawer › destinatarios | Buscador del sistema; filtros locales, foco, paginación y aislamiento conservados. |
| PAM › Limpieza | Buscador del sistema por objeto/par; categoría y denominadores conservados. |
| Administración › Roles | Buscador con ícono del sistema; permisos y selección conservados. |
| Controles conformantes: Steering, ADEM, Personas, Safes, Identity, catálogos SIA/Access, plataformas y roles PAM | Inspección visual y pruebas propietarias de búsqueda/navegación; no cambiar controles especializados por tamaño de archivo. |
| Netskope › inventario y ayudas de métricas | Singular/plural para un resultado o identidad, sin cambiar poblaciones ni valores. |
| Glosario › Baja retenida | Describir la excepción aprobada de sync; no afirmar que siempre es una marca manual. |

Verificación propietaria dark/light reales y desktop, pruebas existentes de
cada flujo más regresión del control/copy anterior y `npm run verify`.
FE-CSS-001 sigue bloqueado; no se cierra 024 hasta verificar todas las filas.

## Cierre UX-AUD2-024 — controles y copy (2026-10-08)

Las trece filas de la lista previa quedan verificadas. Se reutiliza el
buscador del sistema (ícono, campo sin borde interior y foco), conservando
búsqueda, paginación, filtros y permisos. Unidad sin asignar es neutra en tabla
y drawer; elegir una unidad conserva su estado, resumen y PATCH de guardado.
La cabecera de Safe inserta el estado en minúsculas dentro de la oración.
Grupos Okta e inventarios Netskope usan singular cuando corresponde; el método
de métricas conserva la población de una identidad y el plural para varias.
Baja retenida explica la excepción aprobada de sync, sin afirmar que es siempre
manual. Placeholders local/hybrid y ausencia de alta local OIDC son controles
conformantes; lo mismo Steering, ADEM y nueve inventarios con buscador propio.

Evidencia por fila:

| Fila de alcance | Prueba / comprobación propietaria |
| --- | --- |
| Safes tabla/drawer Unidad | `safe drawer shows a reviewable draft… (UX-AUD2-024)`: neutro igual en tabla/drawer, distinto de asignada, borrador y PATCH conservados. |
| Cabecera Safe | `workspace intro translates… (UX-AUD2-024)` y `sync warnings form one sentence…`: completada/con avisos en oración, relativo en minúscula y tema real. |
| Alta local/hybrid/OIDC | Tres casos `account creation hints…`: placeholders y selector presentes donde corresponde, sin alta local OIDC. |
| Grupos Okta | Caso existente de miembros observados ampliado: una identidad con observación, dos sin observación; miembros reales del fixture conservados. |
| Actividad | Caso de las cinco pestañas ampliado con geometría/foco de las tres búsquedas; specs de paginación, histogramas, permisos y teclado. |
| Políticas observadas | `NSK-POL-003` ampliado: búsqueda acento/case-insensitive, página/orden, limpiar y control del sistema. |
| UCI | `NSK-UBA-002` ampliado: búsqueda y gaps conservados, control del sistema y Axe. |
| Destinatarios SIA | Caso de filtros locales ampliado: texto/estado/fuente, paginación, sin nuevas peticiones; teclado y no overflow en desktop. |
| Limpieza PAM | Caso de categoría/objeto/par ampliado: controles, seis resúmenes, denominadores, limpiar y conteo de lecturas; teclado/geometry/Axe. |
| Roles Administración | Caso del catálogo protegido ampliado: ícono/control del sistema, grupo Okta y permisos del rol conservados. |
| Buscadores conformantes | Steering y ADEM extienden sus propios flujos; `existing inventory searches…` recorre Safes, Personas, Identity, roles/plataformas/conectores PAM, políticas/VMs SIA y Activos Access. |
| Conteos Netskope | `one inventory result and one identity…`: un dispositivo, un usuario, fila conservada y ayuda con 100% de una identidad; caso existente con 8.975 identidades conserva plural y ventanas. |
| Baja retenida | Glosario abierto desde Safe, descripción de sync verificada en ambos temas, Escape y flujo de clasificación conservados. |

Regresión anterior: **16 fallos** de los ocho propietarios ampliados en ambos
temas, más **seis fallos de copy y ocho controles conformantes** en la corrida
adicional. Los fallos se producen por el control sin ícono/sistema, plural,
color de Unidad y mayúsculas del estado. Primera corrida final: **32 pases y
dos errores del locator agregado de Unidad**; exigía un nombre accesible exacto
que también incluye el valor seleccionado. Se corrigió el locator, sin cambiar
el producto, y el caso de Safe pasa en ambos temas en el grupo CyberArk.
Los 36 propietarios/control afirman el tema real con el fixture y sus checks.
No se afirma light real sólo por el nombre de un proyecto.

Verificación final: `npm run verify` **1.493 backend / 433 frontend**, con
PostgreSQL efímero, build, propiedad de estilos y diff en verde. Grupo CyberArk
focal **18 pases**; Cross focal **28 pases**; Netskope focal **22 pases**; control plural adicional **dos pases**.
No se presentan estos grupos focales como suites completas de plataforma.

Comandos principales:

- `npm --prefix frontend run build -- --outDir /tmp/custodia-024-final-dist`.
- `E2E_PORT=4278 npm --prefix frontend run test:e2e -- --config /tmp/custodia-024-red.config.ts --grep UX-AUD2-024 --workers=1` (build previo congelado).
- Corrida adicional del mismo baseline: `--grep 'workspace intro translates|sync warnings form|one inventory result|account creation hints|existing inventory searches'`.
- `E2E_PORT=4279 npm --prefix frontend run test:e2e -- --config /tmp/custodia-024-owner.config.ts --grep UX-AUD2-024 --workers=1`.
- `E2E_PORT=4279 npm --prefix frontend run test:e2e:cyberark -- --config /tmp/custodia-024-owner.config.ts --grep 'UX-AUD2-024|cleanup desktop keyboard|SIA recipient controls|Safe filters and grouped inventory' --workers=1`.
- `E2E_PORT=4279 npm --prefix frontend run test:e2e:cross -- --config /tmp/custodia-024-owner.config.ts --grep 'UX-AUD2-024|activity uses shared search|submitting the currently selected page|Activity, operational logs and errors label|access administration tablist supports|directory readers without mapping' --workers=1`.
- `E2E_PORT=4279 npm --prefix frontend run test:e2e:netskope -- --config /tmp/custodia-024-owner.config.ts --grep 'UX-AUD2-024|NSK-POL|NSK-UBA|NSK-XMET-002' --workers=1`.
- Control plural adicional del grupo Netskope: mismo config/puerto,
  `--grep 'Netskope distinguishes inventory users from recent device activity' --workers=1`.
- `npm run verify`, `node frontend/scripts/verify-style-ownership.mjs`,
  `node scripts/check-task-trackers.mjs`, `git diff --check`.

Los previews sirven builds congelados separados del dist que genera verify.
Los grupos focales se ejecutan secuencialmente; sin aumentar timeouts/retries.
CSS sólo junto al dueño para los cambios de controles; styles.css no cambia.
Sin backend, migraciones, cambios de contrato/proveedor, mediciones HTTP ni
push. Sin bloqueo externo. FE-CSS-001 sigue bloqueado hasta cerrar 009.
Estado vigente contrastado con los 26 criterios: **25 cerrados, un parcial
(009), cero pendientes**. El barrido de fechas y tooltips de 009 queda abierto.

Código: `a45917b9`; docs: este commit, titulado
`docs(audit): cerrar UX-AUD2-024 contra el barrido de controles`.

Archivos de código y pruebas:

- `frontend/src/cross/components/activity-view.tsx`.
- `frontend/src/cross/components/activity-workspace.css`.
- `frontend/src/cross/components/activity-workspace.tsx`.
- `frontend/src/cross/components/oidc-groups.tsx`.
- `frontend/src/cross/components/operational-errors-view.tsx`.
- `frontend/src/cross/components/operational-logs-view.tsx`.
- `frontend/src/cross/components/role-admin.tsx`.
- `frontend/src/cross/components/status-glossary.tsx`.
- `frontend/src/cross/components/workspace-intro.tsx`.
- `frontend/src/cyberark/pam/components/pam-cleanup-signals-view.tsx`.
- `frontend/src/cyberark/pam/components/pam-cleanup-workspace.css`.
- `frontend/src/cyberark/pam/components/safe-detail-drawer.css`.
- `frontend/src/cyberark/pam/components/safe-detail-drawer.tsx`.
- `frontend/src/cyberark/pam/components/safe-table.css`.
- `frontend/src/cyberark/sia/components/sia-grantee-detail.tsx`.
- `frontend/src/cyberark/sia/components/sia-workspace.css`.
- `frontend/src/netskope/sse/components/netskope-observed-policies.css`.
- `frontend/src/netskope/sse/components/netskope-observed-policies.tsx`.
- `frontend/src/netskope/sse/components/netskope-uci-workspace.tsx`.
- `frontend/src/netskope/sse/components/netskope-uci.css`.
- `frontend/src/netskope/sse/components/netskope-workspace.tsx`.
- `frontend/tests/e2e/cross/auth.spec.ts`.
- `frontend/tests/e2e/cross/ux-aud.spec.ts`.
- `frontend/tests/e2e/cyberark/pam/pam-cleanup.spec.ts`.
- `frontend/tests/e2e/cyberark/pam/safes.spec.ts`.
- `frontend/tests/e2e/cyberark/sia/sia.spec.ts`.
- `frontend/tests/e2e/netskope/sse/netskope-experience.spec.ts`.
- `frontend/tests/e2e/netskope/sse/netskope-steering.spec.ts`.
- `frontend/tests/e2e/netskope/sse/netskope-uci.spec.ts`.
- `frontend/tests/e2e/netskope/sse/netskope.spec.ts`.
- `frontend/tests/e2e/support/search-control.ts`.

Docs: `UX_AUD2_CHECKPOINT.md`, `TO_IMPLEMENT.md` e `IMPLEMENTED.md`.

## Barrido UX-AUD2-009 — lista previa de fechas (2026-10-08)

Se parte de `27f3e0bf`. Una fecha absoluta usa `formatDate` y tooltip relativo;
se conserva el timestamp original en `datetime` donde se representa un valor
individual. Fechas futuras dicen «en…»; inválidas/ausentes mantienen un estado
sin dato. Fechas de calendario no inventan hora ni cambian de día por zona.

| Pantalla / superficie | Falta o control |
| --- | --- |
| PAM › Limpieza | Cálculo, intento y última ingesta: absoluta común y relativo, sin confundir cálculo con ingesta. |
| PAM › Salud | Epoch en segundos de última observación: conversión explícita y tooltip, sin inferir capacidad/host. |
| PAM › Métricas | Captura del dato/widget y lectura ampliada, mismo formato y tooltip. |
| PAM › cuentas de Safe | Fecha de cambio de secreto/alta usa formato propio corto UTC: unificar presentación, conservar ISO y no inferir rotación. |
| PAM › Safes retiradas / cuentas retiradas / auditoría Safe | Fecha de retiro/detección y eventos; conservar vacíos y dato bruto. |
| PAM / Risk Management › Hallazgos y detalle | Primera/última detección, consulta correcta y puntos de progreso. |
| Identity › Usuarios / drawer / roles / membresías | Último acceso, primera/última observación y corrida de referencia; no mezclar herramientas. |
| Netskope › Usuarios / Dispositivos / drawer | Observaciones distintas, actividad y señal; preservar valores completos y estados de evidencia. |
| Netskope › historial y revisión de dispositivos | Fecha de captura y decisión humana, sin cambiar diagnóstico ni estado. |
| Netskope › Métricas / lectura / capturas agregadas | Fechas dentro de ayudas, captura individual y último inventario observado. |
| Netskope › Operaciones | Corridas anterior/última y edición de baseline; cada fecha con relativo propio. |
| Netskope › Políticas / Steering / UCI | Capturas y extremos de ventana comunes; UCI conserva columna de edad como edad. |
| Netskope › ADEM / DLP / AA | Ventanas en segundos, última actividad/evento y consulta/captura. |
| Administración › Actividad / Logs / Errores | Fecha absoluta y relativo en tooltip, sin repetir el mismo dato en una fila. |
| Administración › Sync / Agenda / aviso de frescura | Instantes de corrida/actualización, último éxito/intento y próxima ejecución; conservar duración y estados. |
| Administración › miembros Okta | Fecha de observación de grupos, sin inferir fecha de alta. |
| Conexiones › Personas / fuente importada | Inicio/finalización de corrida y fecha del import, sin cambiar cobertura. |

Los ejes/ticks de gráficos conservan su contrato de 010 (distinguir muestras),
las duraciones permanecen duraciones, las celdas tituladas como edad muestran
edad y tooltip absoluto común, los inputs de calendario y los exports conservan
su contrato. Son tipos de valor distintos de una fecha absoluta de pantalla.
No modificar APIs, migraciones, fuentes, estilos estructurales ni styles.css.
Lista verificada en el cierre de 009 (más abajo).

## Complemento UX-AUD2-024 — conteo después de cargar (2026-10-08)

La suite completa Netskope durante 009 detectó una expectativa antigua de
`NSK-LOAD-001`: buscaba «dispositivos» para un único resultado. La UI ya
mostraba correctamente «1 dispositivo». Se actualiza la prueba, sin cambiar
producción; conserva el bloqueo de respuesta y la comprobación de skeleton
y «Cargando inventario…», y comprueba el tema real dark/light.

Código de prueba: `458ebbd1`. La suite completa tuvo **222 pases y cuatro
fallos**: dos de esta expectativa y dos del texto de captura tratado en 009.
La repetición focal Netskope de 009/023/024 tuvo **44 pases**, incluidos ambos
temas de este caso. `npm run verify` previo: **1.493 backend y 433 frontend**,
PostgreSQL, build y verificadores aprobados. Comandos:

- `npm --prefix frontend run test:e2e:netskope -- --config=/tmp/custodia-009-final-next.config.ts --workers=2`.
- `npm --prefix frontend run test:e2e:netskope -- --config=/tmp/custodia-009-last.config.ts --grep='UX-AUD2-009|UX-AUD2-023|UX-AUD2-024' --workers=2`.
- `node scripts/check-task-trackers.mjs`.

Docs: este commit, `docs(audit): complementar UX-AUD2-024 con la carga en singular`.
024 permanece cerrado; 009 sigue parcial. Sin migraciones ni push.

## Cierre UX-AUD2-009 — fechas y relativos (2026-10-08)

Las 17 filas del barrido previo están implementadas con `DateTime`
(`cross/components/date-time.tsx`) y los helpers `dateTimeHint` y
`epochSecondsToIso` de `cross/lib/format.ts`. `AgeCell` usa el mismo hint.

Verificación:
- `npm run verify` en verde.
- E2E CyberArk completo: **264 pases y dos fallos**. Uno fue el axe de
  subnav de Safes, intermitente: pasa al repetirlo. El otro corrió `pam.spec`
  en el proyecto `light-shell`, que la config real limita a `auth.spec`; fue
  un artefacto de la config temporal que forzó `testMatch` global.
- E2E Cross completo: **472 pases y dos fallos**, ambos en `auth.spec`
  (líneas 201 y 802). Esperaban el heading «Buscá una persona por correo o
  nombre», que 022 (`8fdccb6a`) había quitado. Se actualizaron al searchbox
  «Buscar persona por correo o nombre»; los dos pasan en dark y light.

Sin backend, migraciones, APIs ni cambios de styles.css. FE-CSS-001 pasa a
trabajo posterior; no se inicia aquí.
