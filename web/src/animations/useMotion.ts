import { useLayoutEffect, type RefObject } from 'react';

import { createLoginMotion, createModalMotion, createTableMotion } from './motion';

export function useLoginMotion(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const scope = createLoginMotion(ref.current);
    return () => scope.revert();
  }, [ref]);
}

export function useTableMotion(ref: RefObject<HTMLElement>, changeKey: string) {
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const scope = createTableMotion(ref.current);
    return () => scope.revert();
  }, [changeKey, ref]);
}

export function useModalMotion(ref: RefObject<HTMLElement>, presenceKey: string | null) {
  useLayoutEffect(() => {
    if (!ref.current || !presenceKey) return undefined;
    const scope = createModalMotion(ref.current);
    return () => scope.revert();
  }, [presenceKey, ref]);
}
