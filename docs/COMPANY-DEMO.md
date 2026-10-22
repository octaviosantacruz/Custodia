---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Faro Digital: una empresa para investigar

Requisito del dueño: la demo representa una empresa, conserva la experiencia
original y muestra para qué sirve inventariar herramientas de ciberseguridad
y cruzar su evidencia. No es una colección de pantallas con cifras sueltas.

## Empresa y población

**Faro Digital** es ficticia: presta servicios de software y pagos, con trabajo
en Asunción y remoto. Tiene tres áreas (Infraestructura, Finanzas e Ingeniería),
seis personas, seis equipos registrados en Netskope, dos Safes y tres cuentas
privilegiadas en PAM. No representa el tamaño típico de un cliente; es toda
la población del ejemplo, pequeña para poder comprobar cada cifra.

La fotografía se evalúa al **22/10/2026, 14:00 UTC**, con capturas normales a
las 13:00. Los correos usan `faro.example`; las direcciones de destinos son
`192.0.2.0/24`. No se usan inventarios, identidades, dominios, grupos ni
credenciales de una empresa real.

[company.json](../company-demo/lab/company.json) es la única fuente de estos
datos. Los endpoints sintéticos derivan de ella búsquedas, fichas, relaciones,
equipos y cuentas: no mantienen cifras decorativas independientes.

## Casos del operador

| Persona / área | Evidencia del escenario | Qué se puede concluir |
|---|---|---|
| Ana Soto / Infraestructura | Acceso a Safe de producción con dos cuentas. Dos equipos Netskope: uno reciente y otro con señal hace 12 días. | Cobertura Netskope parcial. Investigar el equipo anterior; no afirmar abandono, compromiso o ausencia de EDR. |
| Bruno Ruiz / Finanzas | Identidad única, un equipo reciente, sin registro PAM. | Cobertura Netskope observada. No necesita un acceso PAM por aparecer en el inventario. |
| Carla Vega / Infraestructura | Acceso al Safe de desarrollo. Identidad y usuario Netskope únicos, sin equipos observados en la captura completa. | Brecha de cobertura para revisar. No es un incidente confirmado. |
| Diego Paz / Ingeniería | Identidad única y un equipo reciente. | Caso de referencia con cobertura observada. |
| Elena Ríos / Finanzas | Dos identidades activas comparten correo; un usuario Netskope con equipo. | Vínculo Identity ambiguo y cobertura desconocida. No elegir una identidad por conveniencia. |
| Federico Luna / Ingeniería | Identidad única y un equipo Netskope reciente. | Cobertura del cliente Netskope. No demuestra que CrowdStrike esté instalado o sano. |

En la captura normal: **3 cubiertas, 1 parcial, 1 brecha y 1 desconocida**
sobre 6 personas; 50% de cobertura completa. Hay siete registros Identity
para seis personas por la duplicación deliberada de Elena.

## Recorrido disponible

En `company-demo/` se recuperó el frontend React registrado en `f6a7acc`:
Geist, verde de Custodia, temas, shell, búsqueda, vista radial, tablas,
filtros y detalle originales. No se vuelve a implementar esa UI desde cero.

1. Abrir los casos de la empresa y elegir Ana. Revisar CyberArk y Netskope.
2. Expandir evidencia del cliente. Ver regla `CONN-001` v1, población,
   procedencia, corrida, vigencia y razón del estado parcial.
3. Abrir Netskope desde su ficha: aparecen exactamente sus dos equipos.
   Expandir el anterior para ver persona, sistema, versión y última señal.
4. Abrir Safes: los dos Safes son los mismos del escenario. Producción tiene
   dos cuentas, Ana como responsable y un historial humano de ejemplo.
5. Abrir CyberArk desde Ana para recorrer persona → rol → Safe.
6. Comparar Carla y Elena. Cambiar la fuente a parcial o vencida: las seis
   coberturas pasan a desconocidas, sin convertir falta de evidencia en brecha.

La barra de empresa y sus casos son contexto de demostración añadido al
frontend; no sustituyen sus pantallas operativas. El reloj de evaluación es
fijo. En el modo vencido se conserva una captura de 73 horas: sus observaciones
se trasladan a esa captura, nunca a fechas posteriores a ella.
Las fechas relativas de la interfaz también usan ese instante de evaluación:
la lectura del caso sigue siendo la misma aunque se abra en otra fecha.

## Qué demuestra y qué falta

La API es un adaptador **dentro del navegador**, con la forma de los contratos
HTTP existentes. Declara las correspondencias del escenario; no ejecuta la
ingesta Python ni un nuevo resolvedor Go. Las reglas Python siguen siendo
referencia para la matriz de paridad. Los registros no se fusionan.

La sesión es simulada y de lectura, sin autenticación real. Las escrituras
son rechazadas. Las preferencias de navegación sólo viven en la pestaña;
recargar restaura el estado del adaptador. No hay base, jobs ni sincronizaciones
reales. Los endpoints sin modelo responden explícitamente con error; nunca
pasan al backend laboral ni se disfrazan de inventarios vacíos.

Personas, Safes, cadena PAM e inventarios Netskope tienen datos. Otros recorridos
del shell indican que no forman parte de esta demo. ADEM/UEBA no están incluidos;
sus secciones no reciben scores ni alertas inventados. CrowdStrike necesita su
propio contrato de activos/sensores, identidad y vigencia antes de agregar
cobertura EDR; no hay un conector implementado.

Los filtros básicos de inventario están modelados; los filtros avanzados sin
contrato sintético responden explícitamente con error, en lugar de conservar
las mismas filas como si hubieran aplicado el criterio. El inventario reciente
usa siete días; la vista «Todo el inventario» conserva los seis registros.

La base conserva módulos originales todavía no adaptados; no se considera
limpieza de producto ni paridad completa. La sesión simulada sólo se instala
desde `lab/main.tsx`; no se incorpora al checkout laboral ni al futuro backend.
La configuración Vite no lee `.env` ni tiene proxy API. El adaptador rechaza
fetch fuera de `/api/` del mismo origen y no tiene fallback de red.

## Ejecución y verificación

```bash
cd company-demo
npm ci
npm run build
npm run preview
# http://127.0.0.1:4182
```

Desde la raíz del producto, `npm run verify` valida documentos y modelos;
`npm run verify:company` compila y ejecuta las pruebas de esta empresa en
Chromium, en el puerto descartable 4183. Requiere instalar dependencias de
`company-demo/`, Chromium y sus bibliotecas. `CUSTODIA_CHROMIUM_PATH` permite
indicar un Chromium ya disponible sin fijar una ruta de esta máquina en código.

Las pruebas cubren integridad de referencias, totales, casos ambiguos, vigencia,
parciales, búsqueda/paginación, vínculos persona → equipos/Safe, ausencia de
fallback, navegación original y accesibilidad automática de Personas. No son
una certificación de accesibilidad ni de toda la aplicación anterior.

La procedencia de la UI recuperada se registra en
[PROVENANCE.md](PROVENANCE.md). El dueño acepta esta base para avanzar y pide
refinar el estilo. No implica diseño final, distribución, publicación en
Portfolio ni soporte de fabricantes.
