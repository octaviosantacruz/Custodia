// Mejora progresiva del sitio: sin este script todo se ve, sólo sin animar.
// `is-seen` revela un bloque la primera vez que entra en pantalla. Ninguna
// animación se repite sola y nada toma el control del scroll.
const root = document.documentElement;
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!still && 'IntersectionObserver' in window) {
  root.classList.add('can-animate');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-seen');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.2 });
  for (const element of document.querySelectorAll('.reveal')) observer.observe(element);
}

// El recorrido: en pantalla ancha las cinco pantallas comparten un escenario
// fijo y se muestra la del paso cuyo texto cruza el centro de la pantalla. La
// página se desplaza normal; sin este script cada paso lleva su pantalla. Con
// movimiento reducido cada paso conserva su captura, sin escenario fijo.
const tour = document.querySelector<HTMLElement>('[data-tour]');
if (tour && !still && 'IntersectionObserver' in window) {
  const steps = [...tour.querySelectorAll<HTMLElement>('.tour-step')];
  tour.classList.add('is-scrolly');
  const activate = (active: Element | null) => {
    for (const step of steps) step.classList.toggle('is-active', step === active);
  };
  // El teclado selecciona la misma pantalla que el texto enfocado.
  tour.addEventListener('focusin', event => {
    if (event.target instanceof Element) activate(event.target.closest('.tour-step'));
  });
  const stage = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const active = entry.target.closest('.tour-step');
      activate(active);
    }
  }, { rootMargin: '-35% 0px -45% 0px' });
  for (const step of steps) { const copy = step.querySelector('.tour-copy'); if (copy) stage.observe(copy); }
}
