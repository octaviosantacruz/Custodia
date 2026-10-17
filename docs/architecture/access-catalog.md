---
estado: vigente
dueño: Octavio Santacruz
revisado: 2026-10-09
generado: sí
---

# Catálogo de roles y permisos (generado)

> **Archivo generado. No editar a mano.** Se regenera con `backend/.venv/bin/python scripts/generate_access_catalog.py` aplicando las migraciones
> en un PostgreSQL efímero y leyendo el catálogo. El test `backend/tests/cross/test_access_catalog.py`
> falla si este archivo está desactualizado respecto de `migrations/`.

Solo figuran las filas sembradas por las migraciones (`system_managed`); los roles compuestos que
crea un administrador en tiempo de ejecución son datos, no catálogo. Un rol compuesto no copia
permisos: elige un nivel por dominio y hereda los del rol base de ese nivel. «Planificado» indica
un dominio o rol sin integración; no concede acceso útil todavía. «—» en «Roles que lo conceden» significa que
ningún rol sembrado lo incluye: un administrador lo asigna mediante un rol personalizado. Los permisos
estrictos (`netskope:dlp_read`, `netskope:uba_read`) no los otorgan `access:manage` ni `netskope:read`:
sólo el rol que los lista. Qué permiso exige cada endpoint:
[Referencia de la API](api-reference.md).

## Dominios y niveles

| Dominio | Nombre | Estado | Niveles (rol base) |
|---|---|---|---|
| `platform` | Plataforma | active | Lector → `reader`, Operador → `operator`, Administrador → `admin` |
| `pam` | CyberArk PAM | active | Lector → `cyberark_reader`, Operador → `cyberark_operator`, Administrador → `cyberark_admin` |
| `dlp` | Netskope | active | Lector → `netskope_reader`, Administrador → `netskope_admin` |
| `dspm` | BigID DSPM | planned | Lector → `bigid_reader`, Administrador → `bigid_admin` |
| `sia` | Secure Infrastructure Access | active | Lector → `sia_reader` |
| `identity` | Identity Administration | active | Lector → `identity_reader` |

## Roles

| Rol | Nombre | Tipo | Dominio | Estado | Permisos propios |
|---|---|---|---|---|---|
| `netskope_admin` | Netskope · Administrador | directo | `dlp` | active | `domain:dlp`, `netskope:admin`, `netskope:admin_inventory_read`, `netskope:dlp_read`, `netskope:read`, `netskope:uba_read` |
| `netskope_reader` | Netskope · Lector | directo | `dlp` | active | `domain:dlp`, `netskope:read` |
| `bigid_admin` | BigID · Administrador | directo | `dspm` | planned | `bigid:admin`, `bigid:read`, `domain:dspm` |
| `bigid_reader` | BigID · Lector | directo | `dspm` | planned | `bigid:read`, `domain:dspm` |
| `identity_reader` | Identity · Lector | directo | `identity` | active | `domain:identity`, `identity:catalogs_read` |
| `cyberark_admin` | CyberArk · Administrador | directo | `pam` | active | `catalogs:manage`, `catalogs:read`, `catalogs:write`, `connections:import`, `coverage:manage`, `coverage:read`, `domain:pam`, `findings:manage`, `ingestion:preview`, `ingestion:run`, `inventory:export`, `inventory:read`, `inventory:write`, `pam:catalogs_read`, `pam:risk_entities_read`, `pam:risk_read`, `safes:bulk_classify`, `safes:classify`, `safes:manage`, `safes:read` |
| `cyberark_operator` | CyberArk · Operador | directo | `pam` | active | `catalogs:manage`, `catalogs:read`, `connections:import`, `coverage:manage`, `coverage:read`, `domain:pam`, `findings:manage`, `ingestion:preview`, `ingestion:run`, `inventory:read`, `inventory:write`, `pam:catalogs_read`, `pam:risk_read`, `safes:bulk_classify`, `safes:classify`, `safes:manage`, `safes:read` |
| `cyberark_reader` | CyberArk · Lector | directo | `pam` | active | `coverage:read`, `domain:pam`, `inventory:read`, `pam:risk_read`, `safes:read` |
| `admin` | Administrador de plataforma | directo | `platform` | active | `access:directory_read`, `access:local_users_manage`, `access:manage`, `access:oidc_mappings_read`, `access:permissions_manage`, `access:role_assignments_manage`, `access:roles_manage`, `access:roles_read`, `audit:read`, `catalogs:manage`, `catalogs:read`, `catalogs:write`, `connections:import`, `coverage:manage`, `coverage:read`, `domain:admin`, `domain:dlp`, `domain:identity`, `domain:pam`, `domain:sia`, `findings:manage`, `identity:catalogs_read`, `ingestion:preview`, `ingestion:run`, `inventory:export`, `inventory:read`, `inventory:write`, `netskope:admin`, `netskope:admin_inventory_read`, `netskope:dlp_read`, `netskope:read`, `netskope:uba_read`, `pam:catalogs_read`, `pam:risk_entities_read`, `pam:risk_read`, `safes:bulk_classify`, `safes:classify`, `safes:manage`, `safes:read`, `security:events_read`, `sia:catalogs_read` |
| `operator` | Operador de plataforma | directo | `platform` | active | `catalogs:manage`, `catalogs:read`, `connections:import`, `coverage:manage`, `coverage:read`, `domain:pam`, `findings:manage`, `ingestion:preview`, `ingestion:run`, `inventory:read`, `inventory:write`, `pam:risk_read`, `safes:bulk_classify`, `safes:classify`, `safes:manage`, `safes:read` |
| `reader` | Lector de plataforma | directo | `platform` | active | `coverage:read`, `domain:pam`, `inventory:read`, `pam:risk_read`, `safes:read` |
| `sia_reader` | SIA · Lector | directo | `sia` | active | `domain:sia`, `sia:catalogs_read` |

## Permisos

| Permiso | Dominio | Estado | Descripción | Roles que lo conceden |
|---|---|---|---|---|
| `domain:dlp` | Netskope | active | Ingresar a Netskope | `admin`, `netskope_admin`, `netskope_reader` |
| `netskope:admin` | Netskope | active | Editar las líneas base del cliente y del SO, y aceptar diagnósticos de equipos | `admin`, `netskope_admin` |
| `netskope:admin_inventory_read` | Netskope | active | Consultar los administradores de Netskope, sus roles y permisos | `admin`, `netskope_admin` |
| `netskope:dlp_read` | Netskope | active | Consultar alertas DLP mínimas por usuario, sin artefacto sensible | `admin`, `netskope_admin` |
| `netskope:read` | Netskope | active | Ver inventario, postura, experiencia y métricas de Netskope | `admin`, `netskope_admin`, `netskope_reader` |
| `netskope:uba_read` | Netskope | active | Consultar el índice de confianza (UCI) de usuarios Netskope | `admin`, `netskope_admin` |
| `bigid:admin` | BigID DSPM | planned | Administrar capacidades de BigID DSPM | `bigid_admin` |
| `bigid:read` | BigID DSPM | planned | Consultar capacidades de BigID DSPM | `bigid_admin`, `bigid_reader` |
| `domain:dspm` | BigID DSPM | planned | Ingresar al dominio BigID DSPM | `bigid_admin`, `bigid_reader` |
| `domain:identity` | Identity Administration | active | Ingresar al dominio Identity Administration | `admin`, `identity_reader` |
| `identity:catalogs_read` | Identity Administration | active | Consultar el catálogo de federaciones de Identity Administration | `admin`, `identity_reader` |
| `catalogs:manage` | CyberArk PAM | active | Administrar unidades y responsables | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `catalogs:read` | CyberArk PAM | active | Heredado: ninguna función lo exige | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `catalogs:write` | CyberArk PAM | active | Heredado: ninguna función lo exige | `admin`, `cyberark_admin` |
| `connections:import` | CyberArk PAM | active | Heredado: lo reemplazó coverage:manage | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `coverage:manage` | CyberArk PAM | active | Importar, exportar y editar el inventario de destinos y su estado | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `coverage:read` | CyberArk PAM | active | Consultar la cobertura de destinos en Privilege Cloud y SIA | `admin`, `cyberark_admin`, `cyberark_operator`, `cyberark_reader`, `operator`, `reader` |
| `domain:pam` | CyberArk PAM | active | Ingresar al dominio CyberArk PAM | `admin`, `cyberark_admin`, `cyberark_operator`, `cyberark_reader`, `operator`, `reader` |
| `findings:manage` | CyberArk PAM | active | Actualizar estado y excepciones de hallazgos | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `ingestion:preview` | CyberArk PAM | active | Previsualizar cambios de sincronización | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `ingestion:run` | CyberArk PAM | active | Ejecutar sincronizaciones de inventario | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `inventory:export` | CyberArk PAM | active | Exportar inventario y cuentas | `admin`, `cyberark_admin` |
| `inventory:read` | CyberArk PAM | active | Consultar inventario PAM | `admin`, `cyberark_admin`, `cyberark_operator`, `cyberark_reader`, `operator`, `reader` |
| `inventory:write` | CyberArk PAM | active | Heredado: ninguna función lo exige | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `pam:catalogs_read` | CyberArk PAM | active | Consultar catálogos técnicos de PAM: plataformas, conectores PSM, componentes, aplicaciones AIM y assets de Access | `admin`, `cyberark_admin`, `cyberark_operator` |
| `pam:risk_entities_read` | CyberArk PAM | active | Consultar el nombre de la entidad de los hallazgos de Risk Management | `admin`, `cyberark_admin` |
| `pam:risk_read` | CyberArk PAM | active | Consultar postura de riesgo calculada por CyberArk en modo sólo lectura | `admin`, `cyberark_admin`, `cyberark_operator`, `cyberark_reader`, `operator`, `reader` |
| `safes:bulk_classify` | CyberArk PAM | active | Heredado: lo reemplazó safes:manage | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `safes:classify` | CyberArk PAM | active | Heredado: lo reemplazó safes:manage | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `safes:manage` | CyberArk PAM | active | Clasificar Safes y cuentas, también en forma masiva | `admin`, `cyberark_admin`, `cyberark_operator`, `operator` |
| `safes:read` | CyberArk PAM | active | Consultar Safes, sus miembros y sus cuentas | `admin`, `cyberark_admin`, `cyberark_operator`, `cyberark_reader`, `operator`, `reader` |
| `access:directory_read` | Plataforma | active | Consultar personas e identidades locales/OIDC | `admin` |
| `access:local_users_manage` | Plataforma | active | Administrar identidades locales y sus credenciales temporales | `admin` |
| `access:manage` | Plataforma | active | Administrar usuarios, roles y permisos de Custodia | `admin` |
| `access:oidc_mappings_read` | Plataforma | active | Consultar mapeos y diagnóstico OIDC no secreto | `admin` |
| `access:permissions_manage` | Plataforma | active | Crear permisos internos; reservado al superadministrador | `admin` |
| `access:role_assignments_manage` | Plataforma | active | Asignar roles dentro del techo de delegación | `admin` |
| `access:roles_manage` | Plataforma | active | Crear y modificar roles dentro del techo de delegación | `admin` |
| `access:roles_read` | Plataforma | active | Consultar roles, permisos, dominios y niveles | `admin` |
| `audit:read` | Plataforma | active | Consultar auditoría y registros operativos sanitizados | `admin` |
| `domain:admin` | Plataforma | active | Ingresar a la administración de Custodia | `admin` |
| `security:events_read` | Plataforma | active | Consultar eventos de autenticación y seguridad sanitizados | `admin` |
| `domain:sia` | Secure Infrastructure Access | active | Ingresar al dominio SIA | `admin`, `sia_reader` |
| `sia:catalogs_read` | Secure Infrastructure Access | active | Consultar catálogos técnicos de SIA: conectores, recursos y cuentas fuertes de base de datos | `admin`, `sia_reader` |
