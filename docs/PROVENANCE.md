---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Procedencia de lo que lleva la demo

## Demo vigente: empresa ficticia con UI recuperada

`company-demo/src/`, `company-demo/public/`, tsconfig y el lock de dependencias
se recuperaron del frontend registrado en `f6a7acc`, sin `.env`, configuración
de despliegue ni backend. Esta base tiene historia de trabajo laboral: la
recuperación local no resuelve derechos ni autoriza su distribución. La
decisión anterior de no copiar esa UI quedó sustituida por la instrucción
del dueño de conservarla. No se afirma que sea código nuevo independiente.

`company-demo/lab/` es nuevo: datos ficticios Faro Digital, modelo de lectura,
API simulada, contexto visible de empresa y pruebas. No toma los valores de
los fixtures laborales. `vite.config.ts` es nuevo, sin hosts corporativos,
proxy ni lectura de `.env`. Las versiones directas se fijaron a las del lock.

Cambios en la UI recuperada: contexto de empresa, enlaces de casos a Personas,
restricción de recorridos aún sin modelo, destinos iniciales hacia inventarios,
empresa declarada antes del fallback visual por dominio y roles ARIA de los
grupos de evidencia. Se mantienen sus componentes y estilos originales.
Los controles de escritura de Safes se deshabilitan para la sesión lectora;
la API simulada también rechaza las escrituras.
Las fechas relativas usan un instante de presentación explícito, instalado
por el entrypoint del laboratorio. No se altera `Date.now` de la aplicación,
sus timers o su caché. Fuera del laboratorio el helper conserva el reloj real.

Interfaz nueva `web/` (22/10, [WEB.md](WEB.md)): código propio sin
componentes ni assets de `company-demo/src`. Incluye
`@fontsource-variable/instrument-sans` y
`@fontsource-variable/jetbrains-mono` 5.3.0 (OFL-1.1) en el build . Desde el 22/10 incluye, a pedido del
dueño, `public/logos/` con los logos blancos de CyberArk, Netskope y BigID
copiados de `company-demo/public` (`71c68de`): identifican productos de los
que Custodia lee y el sitio declara que son marcas de sus dueños, sin
afiliación. Siguen dentro de la revisión de marcas de `PROD-DIST-001`. El modelo de Faro Digital es una copia del de
`company-demo/lab/` (commit `71c68de`; carpeta retirada el 22/10).

El build de Faro Digital incorpora más dependencias y logos que el experimento
reducido: React, TanStack Query, React Aria, Lucide, ECharts, Geist, Caveat y
assets originales, entre otros. La tabla inferior **sólo cubre `demo/`**;
no es un inventario de licencias completo de `company-demo/`. Antes de
distribuir esta nueva base falta revisar su árbol, retirar lo ajeno al alcance,
resolver procedencia y generar sus propios avisos. No hay paquete ni publicación
de Faro Digital.

## Experimento anterior

Registro inicial de `PROD-DIST-001`: qué código y qué assets forman el build
de `demo/` y de dónde vienen. No decide la licencia del producto ni autoriza
publicar nada; eso es del dueño.

## Código y datos propios

| Qué | Origen | Nota |
|---|---|---|
| `demo/src/` (interfaz, modelo, textos ES/EN) | Escrito para este producto el 2026-10-22 | No copia archivos de la versión anterior (`f6a7acc`). Sólo toma de ella la dirección visual de DESIGN.md. |
| `fixtures/lab/scenario.json` | Escrito para este producto | Datos ficticios: «Laboratorio Norte/Sur», `r-17`…`r-19`, «Ana Ejemplo». Ningún valor viene de una instalación real. |
| `demo/src/styles.css` | Escrito para este producto | Usa los valores de color del tema de Portfolio (grafito frío, acento azul) como tokens propios. |

## Dependencias que entran en el build

Versiones exactas en `demo/package.json`; licencias leídas de cada paquete
instalado.

| Paquete | Versión | Licencia | Dónde |
|---|---|---|---|
| `react`, `react-dom` | 19.2.9 | MIT | Código del bundle |
| `scheduler` (de `react-dom`) | 0.27.0 | MIT | Código del bundle |
| `@fontsource-variable/manrope` | 5.3.0 | OFL-1.1 | Tipografía de la interfaz, archivos `woff2` en `dist/assets` |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | Tipografía de datos, archivos `woff`/`woff2` en `dist/assets` |

Las fuentes viajan con el build y no se piden a un tercero al cargar la
página. Sus avisos originales, junto con los de React/react-dom/scheduler,
se copian automáticamente a `dist/THIRD-PARTY-NOTICES.txt` en cada build.
La demo enlaza ese archivo; una prueba comprueba que se sirve con los cinco
paquetes. Esto no decide la licencia de Custodia ni autoriza distribuir la
historia Git.

Sólo de desarrollo, sin entrar al build: Vite, `@vitejs/plugin-react`,
TypeScript, `@types/*`, Playwright y `@axe-core/playwright`.

## Pendiente de decisión del dueño

- Licencia y apertura del repositorio. Hoy el árbol parte de una historia que
  incluye trabajo hecho para el empleador; esa historia no se publica con la
  demo. Opción a evaluar: publicar un repositorio nuevo, sin esa historia.
- Aceptación de distribución del paquete. Los avisos de terceros ya forman
  parte del build; no se publicó ese build.
- La dirección visual original ya fue elegida por el dueño. Quedan la revisión
  de procedencia y los avisos del nuevo build; no otra decisión de paleta.
