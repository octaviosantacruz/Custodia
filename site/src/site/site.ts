// Mejora progresiva del sitio: sin este script todo se ve, sólo sin animar.
// `is-seen` revela un bloque la primera vez que entra en pantalla. Ninguna
// animación se repite sola: la historia del inicio corre una vez, queda en su
// veredicto y ofrece «Repetir»; las minis de los pasos siguen el scroll.
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
  for (const element of document.querySelectorAll('.reveal, .story')) observer.observe(element);

  const story = document.querySelector<HTMLElement>('.story');
  const replay = story?.querySelector<HTMLButtonElement>('.story-replay');
  if (story && replay) {
    replay.hidden = false;
    // La última pieza en aparecer es el hallazgo: cuando termina, se puede repetir.
    story.querySelector('.st-finding')?.addEventListener('animationend', () => story.classList.add('is-done'));
    replay.addEventListener('click', () => {
      story.classList.remove('is-done');
      for (const animation of story.getAnimations({ subtree: true })) { animation.cancel(); animation.play(); }
    });
  }
}
