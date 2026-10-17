---
description: Ejecutar un único ID del tracker en su propio worktree, mediante orchestrator, worker y reviewer
agent: orchestrator
---

ID autorizado y alcance: $ARGUMENTS

Primero creá (o reutilizá) el worktree del ID con scripts/wt.sh new <ID> y trabajá
sólo ahí, en la rama task/<ID>. Después seguí el protocolo orchestrator → worker →
gate aprobado → reviewer → aceptación humana. Contrastá trackers/código y estado
Git. Si falta ID inequívoco o alcance, preguntá antes de editar. No elijas otra
tarea ni hagas push. Commits locales requieren autorización humana explícita del
mensaje y archivos/hunks y aprobación por comando; no equivalen a aceptación ni
cierre. No ejecutes producción. No cierres el tracker sin aceptación humana.
Tras la aceptación, ofrecé scripts/wt.sh merge <ID> (con aprobación humana).
