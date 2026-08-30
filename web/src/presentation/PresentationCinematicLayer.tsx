import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';

interface PresentationCinematicLayerProps {
  rootRef: RefObject<HTMLDivElement>;
  paused: boolean;
  allowReducedMotion?: boolean;
}

function shouldUseWebGL(allowReducedMotion = false) {
  if (!allowReducedMotion
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function createSurveyGrid() {
  const points: number[] = [];
  const size = 16;
  const divisions = 16;
  for (let step = 0; step <= divisions; step += 1) {
    const position = -size / 2 + (step / divisions) * size;
    points.push(-size / 2, -2.4, position, size / 2, -2.4, position);
    points.push(position, -2.4, -size / 2, position, -2.4, size / 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x7f9b7d, transparent: true, opacity: 0.16 }),
  );
}

function createDataCore() {
  const geometry = new THREE.IcosahedronGeometry(1.6, 5);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uLeaf: { value: new THREE.Color('#a3b18a') },
      uForest: { value: new THREE.Color('#3a5a40') },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uProgress;
      varying float vPulse;
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        float wave = sin(position.y * 3.4 + uTime * 1.25 + uProgress * 5.0) * 0.045;
        vPulse = wave + 0.5;
        vec3 displaced = position + normal * wave * (1.0 + uProgress * 0.8);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uLeaf;
      uniform vec3 uForest;
      uniform float uProgress;
      varying float vPulse;
      varying vec3 vNormal;
      void main() {
        float fresnel = pow(1.0 - abs(vNormal.z), 2.2);
        vec3 color = mix(uForest, uLeaf, clamp(fresnel + vPulse * 0.32 + uProgress * 0.18, 0.0, 1.0));
        gl_FragColor = vec4(color, 0.18 + fresnel * 0.58);
      }
    `,
  });
  const surface = new THREE.Mesh(geometry, material);
  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.62, 2),
    new THREE.MeshBasicMaterial({ color: 0xdad7cd, wireframe: true, transparent: true, opacity: 0.18 }),
  );
  const group = new THREE.Group();
  group.add(surface, wire);
  return { group, material };
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

export function PresentationCinematicLayer({ rootRef, paused, allowReducedMotion = false }: PresentationCinematicLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pausedRef = useRef(paused);
  const lenisRef = useRef<Lenis | null>(null);
  const [webglEnabled, setWebglEnabled] = useState(() => shouldUseWebGL(allowReducedMotion));

  useEffect(() => {
    setWebglEnabled(shouldUseWebGL(allowReducedMotion));
  }, [allowReducedMotion]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) lenisRef.current?.stop();
    else lenisRef.current?.start();
  }, [paused]);

  useEffect(() => {
    const root = rootRef.current;
    const content = root?.querySelector<HTMLElement>('main');
    if (!root || !content) return undefined;
    if (!allowReducedMotion
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ wrapper: root, content, duration: 1.05, smoothWheel: true });
    lenisRef.current = lenis;
    root.dataset.motionEngine = 'gsap';
    const updateProgress = () => {
      const maximum = Math.max(1, content.scrollHeight - root.clientHeight);
      root.style.setProperty('--story-progress', String(root.scrollTop / maximum));
    };
    lenis.on('scroll', () => {
      ScrollTrigger.update();
      updateProgress();
    });
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      const common = { scroller: root } as const;
      gsap.to('[data-story-hero-copy]', {
        yPercent: -34,
        scale: 0.9,
        opacity: 0.08,
        ease: 'none',
        scrollTrigger: { trigger: '.presentation-story-hero', start: 'top top', end: 'bottom 22%', scrub: 0.65, scroller: root },
      });
      gsap.utils.toArray<HTMLElement>('[data-story-heading]').forEach((heading) => {
        gsap.fromTo(heading.children,
          { y: 110, opacity: 0, rotateX: -18, transformOrigin: '50% 100%' },
          {
            y: 0,
            opacity: 1,
            rotateX: 0,
            stagger: 0.08,
            ease: 'power3.out',
            scrollTrigger: { trigger: heading, start: 'top 94%', end: 'top 56%', scrub: 0.55, ...common },
          });
      });
      gsap.utils.toArray<HTMLElement>('[data-story-step]').forEach((step, index) => {
        gsap.fromTo(step,
          { x: index % 2 ? 180 : -180, y: 80, scale: 0.78, rotateZ: index % 2 ? 3 : -3, opacity: 0 },
          {
            x: 0,
            y: 0,
            scale: 1,
            rotateZ: 0,
            opacity: 1,
            ease: 'power3.out',
            scrollTrigger: { trigger: step, start: 'top 96%', end: 'center 62%', scrub: 0.72, ...common },
          });
      });
      gsap.fromTo('.presentation-journey-beam span',
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { trigger: '.presentation-story-journey', start: 'top 72%', end: 'bottom 70%', scrub: true, ...common },
        });
      gsap.fromTo('.presentation-blueprint-stack > div', {
        y: (index) => 480 - index * 90,
        x: (index) => index % 2 ? 240 : -240,
        z: -420,
        rotateX: 84,
        rotateZ: (index) => index % 2 ? 14 : -14,
        opacity: 0,
      }, {
        y: 0,
        x: 0,
        z: 0,
        rotateX: 0,
        rotateZ: 0,
        opacity: 1,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.presentation-story-blueprint', start: 'top 88%', end: 'center 48%', scrub: 0.8, ...common },
      });
      gsap.fromTo('.presentation-impact-line article', {
        y: 220,
        rotateX: -48,
        scale: 0.68,
        opacity: 0,
      }, {
        y: 0,
        rotateX: 0,
        scale: 1,
        opacity: 1,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.presentation-impact-line', start: 'top 94%', end: 'center 55%', scrub: 0.65, ...common },
      });
      gsap.fromTo('.presentation-trust-symbol',
        { scale: 0.15, rotate: -160, opacity: 0 },
        { scale: 1, rotate: 0, opacity: 1, ease: 'back.out(1.35)', scrollTrigger: { trigger: '.presentation-story-trust', start: 'top 88%', end: 'center 58%', scrub: 0.55, ...common } });
      gsap.fromTo('.presentation-school-backdrop',
        { scale: 1.34, yPercent: -8, filter: 'saturate(.55) contrast(1.08)' },
        { scale: 1.04, yPercent: 8, filter: 'saturate(.88) contrast(1.02)', ease: 'none', scrollTrigger: { trigger: '.presentation-story-school', start: 'top bottom', end: 'bottom top', scrub: 0.8, ...common } });
      gsap.fromTo('.presentation-story-school > :not(.presentation-school-backdrop):not(.presentation-school-veil)', {
        x: (index) => index ? 180 : -180,
        y: 90,
        opacity: 0,
      }, {
        x: 0,
        y: 0,
        opacity: 1,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.presentation-story-school', start: 'top 86%', end: 'center 52%', scrub: 0.7, ...common },
      });
      gsap.fromTo('.presentation-story-final > *', {
        y: 160,
        scale: 0.72,
        opacity: 0,
      }, {
        y: 0,
        scale: 1,
        opacity: 1,
        stagger: 0.1,
        ease: 'power4.out',
        scrollTrigger: { trigger: '.presentation-story-final', start: 'top 92%', end: 'center 55%', scrub: 0.68, ...common },
      });
    }, root);

    if (paused) lenis.stop();
    updateProgress();
    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh).catch(() => undefined);
    root.querySelectorAll('img').forEach((image) => image.addEventListener('load', refresh, { once: true }));
    window.setTimeout(refresh, 80);
    return () => {
      context.revert();
      lenis.destroy();
      lenisRef.current = null;
      gsap.ticker.remove(tick);
      root.style.removeProperty('--story-progress');
      delete root.dataset.motionEngine;
    };
  }, [allowReducedMotion, rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const content = root.querySelector<HTMLElement>('main');
    if (!content) return;
    root.toggleAttribute('data-cinematic-paused', paused);
  }, [paused, rootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || !webglEnabled) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.3, 8.4);
    const grid = createSurveyGrid();
    scene.add(grid);
    const { group: core, material } = createDataCore();
    scene.add(core);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xa3b18a, wireframe: true, transparent: true, opacity: 0.24 });
    const rings = [2.35, 3.15, 4].map((radius, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 8, 120), ringMaterial.clone());
      ring.rotation.set(index * 0.62 + 0.28, index * 0.48, index * 0.18);
      scene.add(ring);
      return ring;
    });
    const pointer = new THREE.Vector2();
    let targetProgress = 0;
    let progress = 0;
    let frame = 0;
    let visible = true;
    let lastTime = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const updateTarget = () => {
      const content = root.querySelector<HTMLElement>('main');
      const maximum = Math.max(1, (content?.scrollHeight || root.scrollHeight) - root.clientHeight);
      targetProgress = THREE.MathUtils.clamp(root.scrollTop / maximum, 0, 1);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.01 });
    observer.observe(canvas);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    root.addEventListener('scroll', updateTarget, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    resize();
    updateTarget();

    const render = (now: number) => {
      frame = window.requestAnimationFrame(render);
      if (!visible || document.hidden || pausedRef.current) return;
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      progress = THREE.MathUtils.damp(progress, targetProgress, 4.5, delta);
      material.uniforms.uTime.value = now / 1000;
      material.uniforms.uProgress.value = progress;
      core.rotation.y = now * 0.00016 + progress * Math.PI * 2.2 + pointer.x * 0.09;
      core.rotation.x = -0.12 + pointer.y * 0.07 + Math.sin(now * 0.00042) * 0.035;
      core.position.x = Math.sin(progress * Math.PI * 2) * 1.5;
      core.position.y = 0.15 + Math.sin(progress * Math.PI * 3.4) * 0.65;
      core.scale.setScalar(1 - progress * 0.24);
      rings.forEach((ring, index) => {
        ring.rotation.z += delta * (0.055 + index * 0.025);
        ring.rotation.y += delta * (0.035 + index * 0.018);
        ring.position.x = core.position.x * (0.2 + index * 0.08);
      });
      grid.position.z = (progress * 8) % 2;
      camera.position.z = 8.4 - Math.sin(progress * Math.PI) * 1.5;
      camera.position.x = pointer.x * 0.2;
      camera.lookAt(0, -0.1, 0);
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener('scroll', updateTarget);
      window.removeEventListener('pointermove', onPointerMove);
      observer.disconnect();
      resizeObserver.disconnect();
      disposeScene(scene);
      renderer.dispose();
    };
  }, [rootRef, webglEnabled]);

  return (
    <div className="presentation-cinematic-layer" aria-hidden="true" data-webgl={webglEnabled || undefined}>
      {webglEnabled && <canvas ref={canvasRef} />}
      <div className="presentation-cinematic-vignette" />
      <div className="presentation-cinematic-noise" />
    </div>
  );
}
