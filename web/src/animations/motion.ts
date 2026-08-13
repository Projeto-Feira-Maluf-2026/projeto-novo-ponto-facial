import { animate, createScope, createTimeline, stagger, utils, type Scope } from 'animejs';

export const motionTokens = {
  duration: {
    micro: 140,
    fast: 190,
    normal: 300,
    enter: 420,
  },
  distance: {
    micro: 4,
    small: 8,
    normal: 12,
  },
  stagger: {
    tight: 34,
    normal: 46,
  },
  ease: {
    standard: 'out(3)',
    enter: 'out(4)',
  },
} as const;

const reducedMotionMedia = {
  reduceMotion: '(prefers-reduced-motion: reduce)',
};

function visibleElements(elements: Element[]) {
  return elements.filter((element) => {
    const node = element as HTMLElement;
    return node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden';
  });
}

export function createPageMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
    defaults: { ease: motionTokens.ease.enter },
  }).add((scope) => {
    const heading = root.querySelector('.page-heading');
    const headingItems = heading
      ? visibleElements(Array.from(heading.querySelectorAll(':scope > div > *'))).slice(0, 4)
      : [];
    const pageRoot = Array.from(root.children).find((element) => element !== heading) as HTMLElement | undefined;
    const sections = pageRoot
      ? visibleElements(Array.from(pageRoot.children)).slice(0, 10)
      : [];
    const targets = [...headingItems, ...sections];

    if (!targets.length) return;
    if (scope?.matches.reduceMotion) {
      utils.set(targets, { opacity: 1, y: 0 });
      return;
    }

    const timeline = createTimeline({ defaults: { ease: motionTokens.ease.enter } });
    if (headingItems.length) {
      timeline.add(headingItems, {
        opacity: [0, 1],
        y: [motionTokens.distance.small, 0],
        duration: motionTokens.duration.normal,
        delay: stagger(motionTokens.stagger.tight),
      }, 0);
    }
    if (sections.length) {
      timeline.add(sections, {
        opacity: [0, 1],
        y: [motionTokens.distance.normal, 0],
        duration: motionTokens.duration.enter,
        delay: stagger(motionTokens.stagger.normal),
      }, headingItems.length ? 72 : 0);
    }
  });
}

export function createTableMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
    defaults: { ease: motionTokens.ease.standard },
  }).add((scope) => {
    const rows = visibleElements(Array.from(root.querySelectorAll('tbody tr'))).slice(0, 12);
    if (!rows.length) return;
    if (scope?.matches.reduceMotion) {
      utils.set(rows, { opacity: 1, y: 0 });
      return;
    }
    animate(rows, {
      opacity: [0, 1],
      y: [motionTokens.distance.small, 0],
      duration: motionTokens.duration.normal,
      delay: stagger(motionTokens.stagger.tight),
      ease: motionTokens.ease.standard,
    });
  });
}

export function createMetricMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
  }).add((scope) => {
    if (scope?.matches.reduceMotion) {
      utils.set(root, { opacity: 1, y: 0 });
      return;
    }
    const siblings = root.parentElement
      ? Array.from(root.parentElement.querySelectorAll(':scope > .metric-card'))
      : [];
    const index = Math.max(0, siblings.indexOf(root));
    animate(root, {
      opacity: [0, 1],
      y: [motionTokens.distance.small, 0],
      duration: motionTokens.duration.normal,
      delay: Math.min(index, 5) * motionTokens.stagger.tight,
      ease: motionTokens.ease.enter,
    });
  });
}

export function createModalMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
  }).add((scope) => {
    const dialog = root.querySelector(':scope > section');
    if (!dialog) return;
    if (scope?.matches.reduceMotion) {
      utils.set([root, dialog], { opacity: 1, y: 0, scale: 1 });
      return;
    }
    createTimeline({ defaults: { ease: motionTokens.ease.enter } })
      .add(root, { opacity: [0, 1], duration: motionTokens.duration.fast }, 0)
      .add(dialog, {
        opacity: [0, 1],
        y: [motionTokens.distance.small, 0],
        scale: [0.975, 1],
        duration: motionTokens.duration.normal,
      }, 35);
  });
}

export function playModalExit(root: HTMLElement | null, onComplete: () => void) {
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onComplete();
    return;
  }
  const dialog = root.querySelector(':scope > section');
  if (!dialog) {
    onComplete();
    return;
  }
  createTimeline({
    defaults: { ease: 'in(2)' },
    onComplete,
  })
    .add(dialog, {
      opacity: 0,
      y: motionTokens.distance.small,
      scale: 0.985,
      duration: motionTokens.duration.fast,
    }, 0)
    .add(root, { opacity: 0, duration: motionTokens.duration.fast }, 20);
}

export function moveIndicator(
  indicator: HTMLElement,
  target: HTMLElement,
  axis: 'x' | 'y',
) {
  const isFirstPosition = indicator.dataset.motionReady !== 'true';
  if (isFirstPosition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (axis === 'y') utils.set(indicator, { y: target.offsetTop, height: target.offsetHeight });
    else utils.set(indicator, { x: target.offsetLeft, width: target.offsetWidth });
    indicator.dataset.motionReady = 'true';
    return null;
  }
  if (axis === 'y') {
    return animate(indicator, {
      y: target.offsetTop,
      height: target.offsetHeight,
      duration: motionTokens.duration.normal,
      ease: motionTokens.ease.enter,
    });
  }
  return animate(indicator, {
    x: target.offsetLeft,
    width: target.offsetWidth,
    duration: motionTokens.duration.normal,
    ease: motionTokens.ease.enter,
  });
}
