import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export function routeLinkDestination(event: MouseEvent, currentUrl: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return null;
  const current = new URL(currentUrl);
  const next = new URL(anchor.href, currentUrl);
  if (next.origin !== current.origin || next.pathname === current.pathname || !['http:', 'https:'].includes(next.protocol)) return null;
  return next.pathname + next.search + next.hash;
}

/** Native snapshots stay in the browser; authorization continues in route guards. */
export function useSmoothNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (!transitionDocument.startViewTransition) return;
    let active = false;
    const click = (event: MouseEvent) => {
      if (active || document.querySelector('.presentation-story') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
        || document.documentElement.dataset.motionMode === 'reduced') return;
      const destination = routeLinkDestination(event, window.location.href);
      if (!destination) return;
      event.preventDefault();
      active = true;
      document.documentElement.dataset.routeTransition = 'true';
      let transition: { finished: Promise<void> };
      try {
        transition = transitionDocument.startViewTransition!(() => flushSync(() => { void navigate(destination); }));
      } catch {
        active = false;
        delete document.documentElement.dataset.routeTransition;
        void navigate(destination);
        return;
      }
      void transition.finished.catch(() => undefined).finally(() => {
        active = false;
        delete document.documentElement.dataset.routeTransition;
      });
    };
    document.addEventListener('click', click, true);
    return () => { document.removeEventListener('click', click, true); delete document.documentElement.dataset.routeTransition; };
  }, [navigate]);
}
