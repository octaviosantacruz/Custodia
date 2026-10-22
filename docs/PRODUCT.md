---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-22
---

# Custodia: base del producto

Entrada nueva, independiente de la historia de la instalación laboral.
Decisión del dueño: **presentación en Portfolio → producto autohospedado →
evaluar SaaS si tiene éxito**. El backend del producto será Go. La extensión
a otras herramientas forma parte de la dirección; cada integración necesita
su propio contrato probado. La demo empresarial Faro Digital está aceptada
como base, con refinamiento de estilo pendiente; todavía no hay backend Go.
Aclaración del dueño el 22/10: preservar la UI y experiencia anteriores,
inventariar Netskope/CyberArk/CrowdStrike y otras herramientas y permitir
cruces e inferencias. Ver [la revisión de la base existente](EXISTING-PRODUCT.md).

## Qué queremos resolver

Un operador tiene inventario y señales repartidos entre herramientas de
seguridad. Necesita saber qué observó cada una, qué cambió, qué información
falta y quién debe revisar una situación. Custodia conserva esa evidencia y
las decisiones del equipo sin obligarlo a mantener planillas paralelas.
Los cruces entre herramientas y las inferencias son parte central del
producto, sobre evidencias que conservan origen, reglas y vigencia. Las
vistas existentes de Personas, cobertura y postura ya expresan esa dirección.

Propuesta de presentación: **«Tus herramientas, un inventario explicable y
un historial de decisiones»**. Es posicionamiento propuesto, no una promesa
de cobertura sobre todas las herramientas del mercado.

El primer usuario es un operador de seguridad o infraestructura con varias
consolas y tareas recurrentes de inventario. Primero validar que interpreta
un cambio y toma una acción; después ampliar conectores y automatizaciones.

## Tres entregas diferentes

| Etapa | Entrega | Qué demuestra |
|---|---|---|
| Portfolio | Mostrar la experiencia original con datos ficticios y caso ES/EN. | El producto que se está estandarizando. La demo reducida no sustituye esa experiencia ni acredita integración real. |
| Autohospedado | Go + PostgreSQL, UI React, conexión configurada por el operador y sincronización read-only. | Instalación reproducible y un recorrido real con historia, permisos y recuperación. |
| SaaS condicionado | Evaluación comercial y de aislamiento después de uso recurrente. | Una necesidad observada de operación alojada. Hoy no se implementan facturación ni infraestructura multiempresa. |

## Principios que se conservan

- Cada dato tiene conexión de origen, identificador externo, fecha y corrida.
- Observaciones externas y decisiones humanas son capas distintas.
- Una corrida parcial o fallida no demuestra una baja.
- Ausencia, falta de permiso y cero observado son estados distintos.
- Los vínculos entre herramientas necesitan reglas explícitas y evidencia;
  coincidencia de nombres no convierte dos registros en una identidad.
- Cada cambio local relevante se autoriza y audita junto con su mutación.
- Custodia consulta herramientas; las remediaciones remotas quedan fuera del
  primer producto. Una acción del operador puede ser asignar o documentar.

## Qué no se hereda automáticamente

Nombres del empleador, dominios, grupos corporativos, cuentas, reglas de
correlación excepcionales, permisos concedidos a un tenant, tickets de Jira,
objetivos de migración y métricas particulares quedan como referencia de v1.
No se copian a la demo ni se convierten en comportamiento universal.
CyberArk y Netskope pasan a ser adaptadores posibles, no las dos únicas
categorías de la aplicación. Tampoco se importa todo su backlog al producto.

La reutilización de implementación y assets se revisa antes de distribución:
atribución, licencia y autorización de materiales se registran explícitamente.
No se decide una licencia ni una apertura del repositorio por esta revisión.

## Cómo leer esta base

| Necesidad | Documento |
|---|---|
| Entender qué hay hoy y qué aprovechar | [Revisión del checkout](REFERENCE.md) |
| Construir el backend Go sin arrastrar el despliegue laboral | [Arquitectura](ARCHITECTURE.md) |
| Estandarizar la configuración y ejecución de integraciones | [Contrato de conectores](CONNECTORS.md) |
| Elegir Switchboard u OIDC y separar QA | [Acceso](ACCESS.md) |
| Diseñar la demo y presentar un caso entendible | [Diseño y demo](DESIGN.md) |
| Decidir cuándo pasar a autohospedado o evaluar SaaS | [Aceptación y distribución](VALIDATION.md) |
| Ejecutar trabajo con estado e IDs | [Tracker único](TO_IMPLEMENT.md) |
| Consultar la decisión de dirección | [Decisiones](DECISIONS.md) |

Estos documentos describen contratos y criterios; el tracker es la única
lista de trabajo. Este árbol inicia el producto sin runtime heredado. La
versión anterior permanece en otro checkout; no se migran bases ni se
publica una demo por hacer esta limpieza.
