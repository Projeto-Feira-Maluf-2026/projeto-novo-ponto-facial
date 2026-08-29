import { animate, createScope, createTimeline, stagger, utils, type Scope } from 'animejs';

export const motionTokens = {
  duration: {
    micro: 140,
    fast: 210,
    normal: 340,
    enter: 480,
    cinematic: 820,
  },
  distance: {
    micro: 4,
    small: 10,
    normal: 16,
  },
  stagger: {
    tight: 40,
    normal: 54,
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

function clearMotionStyles(elements: Array<Element | null>) {
  elements.forEach((element) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
    element.style.removeProperty('filter');
  });
}

export function createLoginMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
    defaults: { ease: motionTokens.ease.enter },
  }).add((scope) => {
    const windowElement = root.querySelector('.login-window');
    const brand = root.querySelector('.login-brand');
    const contextItems = visibleElements(Array.from(root.querySelectorAll('.login-context-content > *')));
    const formItems = visibleElements(Array.from(root.querySelectorAll('.login-form > *')));
    const targets = [windowElement, brand, ...contextItems, ...formItems].filter(Boolean) as Element[];

    if (scope?.matches.reduceMotion) return;

    const timeline = createTimeline({
      defaults: { ease: motionTokens.ease.enter },
      onComplete: () => clearMotionStyles(targets),
    });
    if (windowElement) {
      timeline.add(windowElement, {
        opacity: [0, 1],
        scale: [0.992, 1],
        duration: 520,
      }, 0);
    }
    if (brand) timeline.add(brand, { opacity: [0, 1], x: [-14, 0], duration: 380 }, 80);
    if (contextItems.length) {
      timeline.add(contextItems, {
        opacity: [0, 1],
        y: [24, 0],
        duration: 520,
        delay: stagger(72),
      }, 160);
    }
    if (formItems.length) {
      timeline.add(formItems, {
        opacity: [0, 1],
        y: [18, 0],
        duration: 440,
        delay: stagger(62),
      }, 210);
    }
  });
}

export function createTableMotion(root: HTMLElement): Scope {
  return createScope({
    root,
    mediaQueries: reducedMotionMedia,
  }).add((scope) => {
    const rows = visibleElements(Array.from(root.querySelectorAll('tbody tr:not([aria-hidden="true"])')));
    const emptyItems = visibleElements(Array.from(root.querySelectorAll('.data-table-empty > *')));
    const targets = rows.length ? rows : emptyItems;
    if (scope?.matches.reduceMotion || !targets.length) return;

    animate(targets, {
      opacity: [0, 1],
      x: rows.length ? [12, 0] : [0, 0],
      y: rows.length ? [0, 0] : [10, 0],
      duration: rows.length ? 320 : 380,
      delay: stagger(rows.length ? 38 : 55),
      ease: motionTokens.ease.enter,
      onComplete: () => clearMotionStyles(targets),
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
      return;
    }
    const headerItems = visibleElements(Array.from(dialog.querySelectorAll('.enrollment-dialog-header > *')));
    const bodyItems = visibleElements(Array.from(dialog.querySelectorAll('.enrollment-camera-column, .enrollment-side-panel > *')));
    const targets = [root, dialog, ...headerItems, ...bodyItems];
    createTimeline({
      defaults: { ease: motionTokens.ease.enter },
      onComplete: () => clearMotionStyles(targets),
    })
      .add(root, { opacity: [0, 1], duration: motionTokens.duration.fast }, 0)
      .add(dialog, {
        opacity: [0, 1],
        y: [motionTokens.distance.small, 0],
        scale: [0.975, 1],
        duration: motionTokens.duration.normal,
      }, 35)
      .add(headerItems, {
        opacity: [0, 1],
        y: [8, 0],
        duration: 280,
        delay: stagger(45),
      }, 130)
      .add(bodyItems, {
        opacity: [0, 1],
        y: [14, 0],
        duration: 360,
        delay: stagger(55),
      }, 170);
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
