import { animate } from 'animejs';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { createMetricMotion, createModalMotion, createTableMotion, motionTokens } from './motion';

export function useTableMotion(ref: RefObject<HTMLElement>, changeKey: string) {
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const scope = createTableMotion(ref.current);
    return () => scope.revert();
  }, [changeKey, ref]);
}

export function useMetricMotion(
  rootRef: RefObject<HTMLElement>,
  valueRef: RefObject<HTMLElement>,
  value: string | number,
) {
  const previousValue = useRef<number | null>(typeof value === 'number' ? value : null);

  useLayoutEffect(() => {
    if (!rootRef.current) return undefined;
    const scope = createMetricMotion(rootRef.current);
    return () => scope.revert();
  }, [rootRef]);

  useEffect(() => {
    if (typeof value !== 'number') {
      previousValue.current = null;
      return undefined;
    }
    const previous = previousValue.current;
    previousValue.current = value;
    if (previous === null || previous === value || !valueRef.current) return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      valueRef.current.textContent = value.toLocaleString('pt-BR');
      return undefined;
    }

    const counter = { value: previous };
    const animation = animate(counter, {
      value,
      duration: motionTokens.duration.normal,
      ease: motionTokens.ease.standard,
      onUpdate: () => {
        if (valueRef.current) valueRef.current.textContent = Math.round(counter.value).toLocaleString('pt-BR');
      },
    });
    return () => {
      animation.cancel();
    };
  }, [value, valueRef]);
}

export function useModalMotion(ref: RefObject<HTMLElement>, presenceKey: string | null) {
  useLayoutEffect(() => {
    if (!ref.current || !presenceKey) return undefined;
    const scope = createModalMotion(ref.current);
    return () => scope.revert();
  }, [presenceKey, ref]);
}
