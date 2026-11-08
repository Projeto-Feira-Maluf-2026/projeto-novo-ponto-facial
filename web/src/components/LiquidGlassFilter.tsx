import { useEffect, useState } from 'react';

/**
 * Real refraction for small glass elements (Chromium only): an SVG
 * feDisplacementMap whose map is drawn on a canvas, flat in the middle and
 * bending hard near the edges. Other browsers keep the plain blur fallback,
 * because the `lg-refract` class is only set when Chromium is detected.
 */
function buildDisplacementMap(size = 128, edge = 0.22) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      // Distance to the nearest edge on each axis, 0 at the edge, `edge` inside.
      const bend = (t: number) => {
        const toEdge = Math.min(t, 1 - t);
        if (toEdge >= edge) return 0;
        const strength = Math.pow(1 - toEdge / edge, 2.4);
        return (t < 0.5 ? 1 : -1) * strength;
      };
      const index = (y * size + x) * 4;
      image.data[index] = 128 + bend(u) * 127;
      image.data[index + 1] = 128 + bend(v) * 127;
      image.data[index + 2] = 128;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function isChromium() {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData?.brands;
  return Boolean(brands?.some((item) => item.brand === 'Chromium'));
}

export function LiquidGlassFilter() {
  const [map, setMap] = useState<string | null>(null);

  useEffect(() => {
    if (!isChromium()) return undefined;
    const url = buildDisplacementMap();
    if (!url) return undefined;
    setMap(url);
    document.documentElement.classList.add('lg-refract');
    return () => document.documentElement.classList.remove('lg-refract');
  }, []);

  if (!map) return null;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <filter id="lg-liquid" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="38" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
