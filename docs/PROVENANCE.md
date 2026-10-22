---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Procedencia de lo que lleva la demo

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
página. La OFL permite redistribuirlas con el producto; conservar su aviso al
publicar el build es parte de `PROD-SHOW-001`.

Sólo de desarrollo, sin entrar al build: Vite, `@vitejs/plugin-react`,
TypeScript, `@types/*`, Playwright y `@axe-core/playwright`.

## Pendiente de decisión del dueño

- Licencia y apertura del repositorio. Hoy el árbol parte de una historia que
  incluye trabajo hecho para el empleador; esa historia no se publica con la
  demo. Opción a evaluar: publicar un repositorio nuevo, sin esa historia.
- Aviso de terceros (React, fuentes) dentro del build publicado.
- Si la dirección visual de la versión anterior (tema, Geist) se reutiliza o se
  deja el de Portfolio, que es el que usa hoy la demo.
