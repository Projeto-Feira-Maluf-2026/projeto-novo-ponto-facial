import { useEffect } from 'react';

type NavigatorWithMemory = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

export function useUtilityEffects() {
  useEffect(() => {
    const navigatorInfo = navigator as NavigatorWithMemory;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const constrainedDevice = (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
      || (navigatorInfo.deviceMemory !== undefined && navigatorInfo.deviceMemory <= 4)
      || Boolean(navigatorInfo.connection?.saveData);
    const enabled = !reducedMotion && canHover && !constrainedDevice;
    document.documentElement.dataset.spatialEffects = enabled ? 'full' : 'reduced';
    if (!enabled) return undefined;

    let frame = 0;
    let pending: { element: HTMLElement; event: PointerEvent } | null = null;
    const render = () => {
      frame = 0;
      if (!pending) return;
      const { element, event } = pending;
      const bounds = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      const strength = Number(element.dataset.tiltStrength || 2.4);
      element.style.setProperty('--tilt-x', `${(0.5 - y) * strength}deg`);
      element.style.setProperty('--tilt-y', `${(x - 0.5) * strength}deg`);
      element.style.setProperty('--halo-x', `${x * 100}%`);
      element.style.setProperty('--halo-y', `${y * 100}%`);
      element.style.setProperty('--pointer-x', `${(x - 0.5) * 2}`);
      element.style.setProperty('--pointer-y', `${(y - 0.5) * 2}`);
    };
    const onPointerMove = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt], [data-lens-track]');
      if (!element) return;
      pending = { element, event };
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    const onPointerLeave = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt], [data-lens-track]');
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      element.style.setProperty('--tilt-x', '0deg');
      element.style.setProperty('--tilt-y', '0deg');
      element.style.setProperty('--pointer-x', '0');
      element.style.setProperty('--pointer-y', '0');
    };
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerLeave, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerLeave);
      delete document.documentElement.dataset.spatialEffects;
    };
  }, []);
}
