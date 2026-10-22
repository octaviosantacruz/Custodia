// Live UI uses the wall clock. A dated demonstration can explicitly choose
// its evaluation instant without changing Date.now for caches or timers.
let reference: number | undefined;

export function setPresentationTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Instante de presentación inválido');
  reference = parsed;
}

export const presentationNow = () => reference ?? Date.now();
