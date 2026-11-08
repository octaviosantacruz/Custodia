// Mejora progresiva del sitio: sin este script todo se ve, sólo sin animar.
// `is-seen` revela un bloque la primera vez que entra en pantalla; `is-in`
// marca si se ve ahora, y las animaciones en bucle corren sólo mientras tanto.
const root = document.documentElement;
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!still && 'IntersectionObserver' in window) {
  root.classList.add('can-animate');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.classList.toggle('is-in', entry.isIntersecting);
      if (entry.isIntersecting) entry.target.classList.add('is-seen');
    }
  }, { threshold: 0.2 });
  for (const element of document.querySelectorAll('.reveal, .story')) observer.observe(element);
}
