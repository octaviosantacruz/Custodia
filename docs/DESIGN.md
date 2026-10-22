---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Diseño: preservar la experiencia construida

La aclaración del dueño del 22/10 sustituye el recorte anterior. La base es
la interfaz React de Custodia existente, con su lógica y flujos. El objetivo
es estandarizar un producto de inventario de ciberseguridad, cruces e
inferencias; el cambio a Go corresponde al backend.

Revisión del dueño, 22/10: Faro Digital queda aceptada como base para avanzar;
falta una vuelta al estilo. El próximo lote visual conserva esta experiencia
y refina su presentación, con capturas comparables y validación de los flujos.

## Qué se conserva

- Identidad de Custodia: Geist/Geist Mono, verde, tema oscuro por defecto y
  alternativa clara; controles y componentes propios.
- Shell y navegación por herramienta y pregunta. Registrar nuevas capacidades
  sin forzar todos los dominios a Conexiones, Inventario y Cambios.
- Tablas operativas, filtros, búsqueda, selección y acciones por lote;
  detalle con contexto, cuentas/miembros, clasificación e historial.
- Métricas que llevan a su lista, postura y seguimiento humano. No reducir
  toda esa lógica a cambios de atributos de un recurso genérico.
- Personas, cadenas y cobertura con evidencia por fuente, estados ambiguos,
  referencias y ausencia de datos. Extenderlos a más herramientas.
- Orientación operativa a escritorio; no modificar densidad o navegación
  de la aplicación para convertirla en una presentación móvil.

La adaptación pública de Portfolio puede ser responsive sin rediseñar la
aplicación. Las nuevas vistas siguen el criterio existente de una pregunta,
una persona y una entidad por pantalla. El origen, la ayuda y los permisos
conservan su significado.

## Qué se estandariza

Configuración de instancias y credenciales, habilitación de herramientas,
capacidad disponible, clasificaciones, políticas y reglas de cruce. Evitar
valores corporativos por defecto. La revisión está en
[EXISTING-PRODUCT.md](EXISTING-PRODUCT.md).

Separar “integración configurada” de las Conexiones/Cobertura actuales: esa
vista opera destinos declarados y observados, no credenciales de APIs.
Los campos específicos de un fabricante no se borran por no ser universales;
permanecen en su módulo cuando aportan una respuesta útil.

## Primer laboratorio fiel

La demo debe representar una empresa. [Faro Digital](COMPANY-DEMO.md)
implementa el primer laboratorio en `company-demo/`: frontend original
recuperado, personas/áreas/equipos/accesos del mismo escenario y contratos
HTTP sintéticos. Ya permite Personas, cobertura, cadena PAM, Safes y equipos
Netskope con búsqueda, evidencia, ambigüedad y falta de dato. No demuestra
autorización de backend ni todas las pantallas de la aplicación.
Comparar el flujo contra Python y sus pruebas antes de sustituir endpoints
por Go. No navegar inventarios laborales para obtener capturas.

## Guion determinista del laboratorio

El experimento de `demo/` y [su fixture](../fixtures/lab/scenario.json) se
conserva: dos conexiones, tres recursos, siete pasos, revisión humana y
corridas parciales/completas. Sus pruebas siguen siendo válidas para ese
experimento. No representan Personas, cobertura de destinos, postura,
permisos o toda la ingesta existentes; Go no debe heredarlas como único
contrato de producto. No se sigue ampliando esa UI como reemplazo.

## Presentación

Mostrar la experiencia original con ejemplos nuevos. La paleta grafito del
experimento no reemplaza el verde de Custodia. El material anterior de
[PRESENTATION.md](PRESENTATION.md) queda retenido hasta alinearlo con esta
base. No pedir aceptación de la demo reducida para destrabar el backend Go.
