# Custodia · Faro Digital

Demo local de una empresa ficticia usando la interfaz React original.
Ver [escenario, recorridos y límites](../docs/COMPANY-DEMO.md).

```bash
npm ci
npm run build
npm run preview
```

Abrir http://127.0.0.1:4182. Usar los casos de la empresa para comenzar.
No requiere `.env`, contraseñas, backend, bases ni acceso a fabricantes.
El build usa únicamente su API sintética en el navegador. Es de sólo lectura.

`src/` y `public/` se recuperaron de `Custodia` en `f6a7acc`, con cambios
acotados para el escenario y su aislamiento. `lab/` contiene los datos nuevos,
el adaptador y el contexto de la empresa. La configuración de despliegue de
la instalación laboral no se copió. Go y CrowdStrike siguen pendientes.

Pruebas: `npm test` y `npm run test:e2e` contra el build. Para navegador:
`npx playwright install chromium`; instalar sus bibliotecas del sistema si
faltan. Opcionalmente `CUSTODIA_CHROMIUM_PATH` selecciona un ejecutable local.

Este directorio es una base de revisión local. La procedencia y distribución
se tratan en `../docs/PROVENANCE.md`; no es un paquete aprobado para publicar.
