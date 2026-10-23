import type { PresentationResult } from './presentationResult';

let queuedNavigationResult: PresentationResult | null = null;

export function queuePresentationResultForNavigation(result: PresentationResult) {
  queuedNavigationResult = result;
}

export function consumeQueuedPresentationResult() {
  const result = queuedNavigationResult;
  queuedNavigationResult = null;
  return result;
}
