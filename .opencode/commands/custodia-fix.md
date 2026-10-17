---
description: Ronda de correcciones sin aprobaciones sobre un ID cuya corrida quedó detenida o con hallazgos
agent: autopilot
---

Ronda de correcciones autorizada por el dueño: $ARGUMENTS

Trabajá en el worktree del ID (scripts/wt.sh new <ID> lo reutiliza; rama task/<ID>).
Partí del último informe de .opencode/runs/ y del diff sin commitear de ese worktree (git status
--short y git diff). Entregale al worker-auto los hallazgos concretos del informe,
corré el gate completo, pedí una revisión nueva con reviewer-auto y, solo con accept
y gate verde, commiteá localmente con los mismos recaudos del flujo. Una única ronda:
si vuelve a fallar, no commitees; actualizá el informe y detenete. Sin push.
