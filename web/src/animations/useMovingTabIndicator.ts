import { useLayoutEffect, type RefObject } from 'react';
import { moveIndicator } from './navigationMotion';

export function useMovingTabIndicator(ref: RefObject<HTMLElement>, selection: string | null) {
  useLayoutEffect(() => {
    const list = ref.current;
    const indicator = list?.querySelector<HTMLElement>('[data-tab-indicator]');
    if (!list || !indicator) return;
    const update = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (active) moveIndicator(indicator, active, 'y');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [ref, selection]);
}
