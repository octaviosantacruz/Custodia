# Conciliación de asientos Standard de Privilege Cloud

## Decisión

DS Hub muestra **“Asientos Standard conciliados”**, no “licencias consumidas”.
Es una conciliación operativa del inventario PAM, no sustituye el reporte de
facturación de CyberArk.

## Método

Un asiento queda confirmado cuando ambos conjuntos contienen al mismo usuario
PAM activo:

1. `attributes.user_type = EPVUser`.
2. pertenencia a `Privilege Cloud Administrators` o `Privilege Cloud Users`.

Para la corrida validada el 2026-09-09, ambos conjuntos contienen 47 usuarios
únicos. La vista lista cada usuario y los roles que aportan evidencia.

Los nombres con prefijo `sg_cyberark_privilege_cloud_` se muestran como
conciliación operativa de grupos Okta; no aumentan el denominador ni se suman
como licencias.

## Exclusiones

- `ExtUser` (tres usuarios mapeados fuera del alcance Standard).
- Usuarios técnicos y de componente (PSM, CPM, PVWA y similares).
- Filas de `safe_members`, cuentas y cualquier inferencia de acceso a Safes.

Si aparecen usuarios sólo en uno de los dos conjuntos, el estado deja de ser
“Confirmado” y muestra las diferencias para revisión.
