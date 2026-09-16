# Remotes de Git

Este repositorio local se sincroniza con **tres** remotos independientes, sin
depender de GitHub Actions ni de ningún mirror automático:

```bash
git remote -v
# gvz     git@github.com:octavio-santacruz_gvz/DSHub.git   (SSH, cuenta personal original)
# itti    git@github.com:itti-cybersecurity/DSHub.git       (SSH, organización, remoto activo)

```

- `itti` — repositorio bajo la organización `itti-cybersecurity`, destino
  actual del trabajo del equipo.
- `gvz` — repositorio bajo la cuenta personal donde arrancó el proyecto antes
  de existir una organización (`octavio-santacruz_gvz`, vía SSH).

## Flujo de push

No hay push automático entre los tres: cada uno se actualiza explícitamente.

```bash
git push itti main
git push gvz main


Si solo uno de los remotos es relevante para un cambio puntual, basta con
pushear a ese. En el uso normal del equipo, empujar a `itti` es lo que
importa; `gvz` y `origin` quedan como respaldos de historiales personales.

## Origin gestionado por VSCode

El 2026-09-13, después de usar el panel de Source Control de VSCode para
commitear y pushear, `origin` pasó de `git@github.com:octavio-santacruz_gvz/
DSHub.git` (SSH) a `https://github.com/octaviosantacruz/DSHub.git` (HTTPS,
otra cuenta), y el remote `itti` desapareció de `.git/config`. No fue un
problema de permisos ni de SSO — `itti` seguía siendo accesible por SSH todo
el tiempo — sino que VSCode reescribió `origin` usando la sesión de GitHub
con la que está autenticada esa extensión, y de paso limpió el remote extra
que no reconocía. Se volvió a agregar `itti` y además `gvz` (para no perder
ese acceso) por terminal; `origin` se dejó tal como VSCode lo configuró.
Si vuelve a desaparecer un remote después de operar desde el panel de
VSCode, este es el motivo más probable — revisar `.git/config` y volver a
agregar el remote faltante con `git remote add <nombre> <url>`.

## Acceso SSH a la organización

`itti-cybersecurity` tiene SAML SSO habilitado/forzado. Para que `git push
itti` funcione, la key SSH en uso debe estar **autorizada para SSO** en esa
organización (GitHub → Settings → SSH and GPG keys → "Configure SSO" sobre la
key correspondiente). Si `git fetch itti` o `git push itti` fallan con un
error de SAML SSO, ese es el primer punto a revisar — no es un problema de
credenciales de `origin`.

## Correr los comandos desde el directorio correcto

Siempre ejecutar `git push`/`git pull`/etc. parado dentro de `~/DSHub` (o con
`git -C ~/DSHub ...`). El 2026-09-13 apareció un repositorio git separado y
accidental en `/home/ubuntu` (el home del usuario), con `origin` apuntando
también a `itti-cybersecurity/DSHub.git` y un único commit (`first commit`,
el mismo README autogenerado). Ese `.git` en el home mezclaba el remoto del
proyecto con decenas de carpetas de configuración/credenciales del usuario
(`.ssh/`, `.npmrc`, `.config/`, etc.) como *untracked* — un `git add .` ahí
podía terminar subiendo secretos al remoto de la organización. Se eliminó
(`rm -rf /home/ubuntu/.git`) tras verificar que no tenía otros commits,
branches ni stash. Si vuelve a aparecer un `.git` en el home, no asumir que
es el repo del proyecto: verificar con `git -C /home/ubuntu remote -v` /
`log` antes de operar y, si es un duplicado sin contenido propio, borrarlo.

## Historial

Ambos remotos comparten el mismo historial de commits desde 2026-09-13: el
remoto de la organización tenía únicamente el commit inicial autogenerado por
GitHub (`first commit`, un `README.md` de una línea) y se reconcilió con
`git push itti main --force-with-lease`, reemplazando ese commit por el
historial completo del repo personal. No repetir ese force push salvo que
vuelvan a divergir intencionalmente los historiales.
