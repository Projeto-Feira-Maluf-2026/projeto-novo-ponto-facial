type IndicatorMotion = { cancel: () => void };

export function moveIndicator(
  indicator: HTMLElement,
  target: HTMLElement,
  axis: 'x' | 'y',
): IndicatorMotion | null {
  const firstPosition = indicator.dataset.motionReady !== 'true';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const placeImmediately = firstPosition || reduceMotion;
  if (placeImmediately) indicator.style.transition = 'none';

  if (axis === 'y') {
    indicator.style.transform = `translate3d(0, ${target.offsetTop}px, 0)`;
    indicator.style.height = `${target.offsetHeight}px`;
  } else {
    indicator.style.transform = `translate3d(${target.offsetLeft}px, 0, 0)`;
    indicator.style.width = `${target.offsetWidth}px`;
  }

  if (placeImmediately) {
    indicator.dataset.motionReady = 'true';
    void indicator.offsetWidth;
    indicator.style.removeProperty('transition');
  }

  // A interpolação é feita pelo transition do design system. O contrato de
  // cancelamento mantém o efeito compatível com o ciclo de vida do layout sem
  // carregar uma engine de animação em todas as rotas.
  return placeImmediately ? null : { cancel: () => undefined };
}
