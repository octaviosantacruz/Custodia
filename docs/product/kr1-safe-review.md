# Revisión KR1: inventario de Safes

## Regla vigente

La clasificación del alcance no se infiere únicamente del nombre. Un Safe se considera `Interno CyberArk` solo después de revisión manual. La señal de candidato actual combina: nombre terminado en `_Accounts` y tipo de cuenta `CYBERARK MANAGED`.

## Baseline actual

- Safes activos: `465`
- Safes retirados: `0`
- Safes con alcance pendiente: `465`
- Safes con calidad pendiente: `465`
- Miembros: dato técnico de relaciones Safe-miembro; no se usa como KPI de licencias ni cobertura.

## Candidatos internos detectados

| Safe number | Safe | CPM | Decisión |
|---:|---|---|---|
| 21 | `fo-cyberark-srv_Accounts` | `fo-cyberark-srv` | Pendiente de confirmación |
| 45 | `CPM_UENO_Accounts` | `CPM_UENO` | Pendiente de confirmación |
| 69 | `PasswordManager_Accounts` | `PasswordManager` | Pendiente de confirmación |
| 492 | `EC2AMAZ-4OVM110_Accounts` | `EC2AMAZ-4OVM110` | Pendiente de confirmación |
| 500 | `EC2AMAZ-HOOJ20U_Accounts` | `EC2AMAZ-HOOJ20U` | Pendiente de confirmación |


## Posibles grupos similares

Esta detección solo quita dígitos finales del nombre y agrupa coincidencias. No significa que sean duplicados: puede tratarse de nodos o ambientes distintos.

| Base normalizada | Safes |
|---|---|
| `da_oci_prd-compute-forms` | `192 DA_OCI_PRD-COMPUTE-FORMS001`, `193 DA_OCI_PRD-COMPUTE-FORMS002` |
| `da_oci_vmclfindia-zkwli` | `185 DA_OCI_VMCLFINDIA-ZKWLI1`, `186 DA_OCI_VMCLFINDIA-ZKWLI2` |
| `da_oci_vmcluops01-kpnyt` | `187 DA_OCI_VMCLUOPS01-KPNYT1`, `188 DA_OCI_VMCLUOPS01-KPNYT2` |
| `da_oci_vmcluprod01_lk5mi` | `183 DA_OCI_VMCLUPROD01_LK5MI1`, `184 DA_OCI_VMCLUPROD01_LK5MI2` |
| `dj_oci_dev_compute_bd_desa` | `438 DJ_OCI_DEV_COMPUTE_BD_DESA`, `444 DJ_OCI_DEV_COMPUTE_BD_DESA2` |
| `dj_oci_prd-compute-forms` | `120 DJ_OCI_PRD-COMPUTE-FORMS001`, `121 DJ_OCI_PRD-COMPUTE-FORMS002` |
| `dj_oci_vmclfindia-zkwli` | `112 DJ_OCI_VMCLFINDIA-ZKWLI1`, `113 DJ_OCI_VMCLFINDIA-ZKWLI2` |
| `dj_oci_vmcluops01-kpnyt` | `114 DJ_OCI_VMCLUOPS01-KPNYT1`, `115 DJ_OCI_VMCLUOPS01-KPNYT2` |
| `dj_oci_vmcluprod01_lk5mi` | `110 DJ_OCI_VMCLUPROD01_LK5MI1`, `111 DJ_OCI_VMCLUPROD01_LK5MI2` |
| `eb_oci_dev_compute_bd_desa` | `439 EB_OCI_DEV_COMPUTE_BD_DESA2`, `443 EB_OCI_DEV_COMPUTE_BD_DESA` |
| `eb_oci_prd-compute-forms` | `180 EB_OCI_PRD-COMPUTE-FORMS001`, `181 EB_OCI_PRD-COMPUTE-FORMS002` |
| `eb_oci_vmclfindia-zkwli` | `173 EB_OCI_VMCLFINDIA-ZKWLI1`, `174 EB_OCI_VMCLFINDIA-ZKWLI2` |
| `eb_oci_vmcluops01-kpnyt` | `175 EB_OCI_VMCLUOPS01-KPNYT1`, `176 EB_OCI_VMCLUOPS01-KPNYT2` |
| `eb_oci_vmcluprod01_lk5mi` | `171 EB_OCI_VMCLUPROD01_LK5MI1`, `172 EB_OCI_VMCLUPROD01_LK5MI2` |
| `fo_oci_dev_compute_bd_desa` | `423 FO_OCI_DEV_COMPUTE_BD_DESA`, `424 FO_OCI_DEV_COMPUTE_BD_DESA2` |
| `fo_oci_prd-compute-forms` | `132 FO_OCI_PRD-COMPUTE-FORMS001`, `133 FO_OCI_PRD-COMPUTE-FORMS002` |
| `fo_oci_vmclfindia-zkwli` | `125 FO_OCI_VMCLFINDIA-ZKWLI1`, `126 FO_OCI_VMCLFINDIA-ZKWLI2` |
| `fo_oci_vmcluops01-kpnyt` | `127 FO_OCI_VMCLUOPS01-KPNYT1`, `128 FO_OCI_VMCLUOPS01-KPNYT2` |
| `fo_oci_vmcluprod01_lk5mi` | `123 FO_OCI_VMCLUPROD01_LK5MI1`, `124 FO_OCI_VMCLUPROD01_LK5MI2` |
| `fo_oci_vmclustb01-yjgbo` | `393 FO_OCI_VMCLUSTB01-YJGBO1`, `394 FO_OCI_VMCLUSTB01-YJGBO2` |
| `gh_oci_dev_compute_bd_desa` | `429 GH_OCI_DEV_COMPUTE_BD_DESA`, `430 GH_OCI_DEV_COMPUTE_BD_DESA2` |
| `gh_oci_prd-compute-forms` | `144 GH_OCI_PRD-COMPUTE-FORMS001`, `145 GH_OCI_PRD-COMPUTE-FORMS002` |
| `gh_oci_stg_compute_fielpro` | `402 GH_OCI_STG_COMPUTE_FIELPRO01`, `403 GH_OCI_STG_COMPUTE_FIELPRO02` |
| `gh_oci_vmclfindia-zkwli` | `137 GH_OCI_VMCLFINDIA-ZKWLI1`, `138 GH_OCI_VMCLFINDIA-ZKWLI2` |
| `gh_oci_vmcluops01-kpnyt` | `139 GH_OCI_VMCLUOPS01-KPNYT1`, `140 GH_OCI_VMCLUOPS01-KPNYT2` |
| `gh_oci_vmcluprod01_lk5mi` | `135 GH_OCI_VMCLUPROD01_LK5MI1`, `136 GH_OCI_VMCLUPROD01_LK5MI2` |
| `ld_oci_prd-compute-forms` | `168 LD_OCI_PRD-COMPUTE-FORMS001`, `169 LD_OCI_PRD-COMPUTE-FORMS002` |
| `ld_oci_vmclfindia-zkwli` | `161 LD_OCI_VMCLFINDIA-ZKWLI1`, `162 LD_OCI_VMCLFINDIA-ZKWLI2` |
| `ld_oci_vmcluops01-kpnyt` | `163 LD_OCI_VMCLUOPS01-KPNYT1`, `164 LD_OCI_VMCLUOPS01-KPNYT2` |
| `ld_oci_vmcluprod01_lk5mi` | `159 LD_OCI_VMCLUPROD01_LK5MI1`, `160 LD_OCI_VMCLUPROD01_LK5MI2` |
| `lz_oci_dev_compute_bd_desa` | `433 LZ_OCI_DEV_COMPUTE_BD_DESA`, `434 LZ_OCI_DEV_COMPUTE_BD_DESA2` |
| `lz_oci_prd-compute-forms` | `156 LZ_OCI_PRD-COMPUTE-FORMS001`, `157 LZ_OCI_PRD-COMPUTE-FORMS002` |
| `lz_oci_prod_compute_tomcat` | `390 LZ_OCI_PROD_COMPUTE_TOMCAT`, `391 LZ_OCI_PROD_COMPUTE_TOMCAT02` |
| `lz_oci_vmclfindia-zkwli` | `149 LZ_OCI_VMCLFINDIA-ZKWLI1`, `150 LZ_OCI_VMCLFINDIA-ZKWLI2` |
| `lz_oci_vmcluops01-kpnyt` | `151 LZ_OCI_VMCLUOPS01-KPNYT1`, `152 LZ_OCI_VMCLUOPS01-KPNYT2` |
| `lz_oci_vmcluprod01_lk5mi` | `147 LZ_OCI_VMCLUPROD01_LK5MI1`, `148 LZ_OCI_VMCLUPROD01_LK5MI2` |
| `ueno_oci_rdp_cierre` | `105 UENO_OCI_RDP_CIERRE`, `106 UENO_OCI_RDP_CIERRE02` |

## Duplicados

Los nombres con sufijos `01/02` no se marcan como duplicados automáticamente. Pueden representar nodos distintos. La decisión requiere comparar URL ID, plataforma, entorno, responsable y relación técnica.

## Próxima acción

Seguimiento central: [`KR1-001`](../TO_IMPLEMENT.md).

1. Confirmar los candidatos internos con CyberArk/Platform.
2. Marcar los confirmados como `Interno CyberArk` y `Depurado` desde el detalle.
3. Revisar los grupos similares con evidencia de plataforma y nodo.
4. Calcular cobertura solo sobre Safes de negocio confirmados.

## Capa CMDB normalizada

La migración `016_cmdb_objects_and_relationships.sql` prepara una capa separada para resolver las cadenas PAM y SIA:

```text
users -> roles -> safes -> platforms -> psm
users -> roles -> access policies -> sia
```

La capa contiene los Safes verificados del inventario actual y la cadena PAM sincronizada desde APIs reales. El baseline de CMDB registrado es: 95 usuarios, 78 roles, 465 Safes, 75 plataformas y 3 PSM. Identity Administration y SIA tienen ahora fuentes y vistas independientes; su estado operativo depende de configuración y de la última corrida, no de este documento KR1. No se inventan relaciones a partir de miembros sin evidencia de API.
