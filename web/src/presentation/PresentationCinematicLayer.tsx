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
  const geometry = new THREE.SphereGeometry(1.72, 64, 64);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const jaw = y < -0.32 ? 1 - Math.min(0.28, (-y - 0.32) * 0.16) : 1;
    const nose = z > 0
      ? Math.exp(-((x / 0.27) ** 2) - (((y - 0.02) / 0.42) ** 2)) * 0.42
      : 0;
    const eyes = z > 0
      ? Math.exp(-(((Math.abs(x) - 0.48) / 0.2) ** 2) - (((y - 0.34) / 0.17) ** 2)) * 0.12
      : 0;
    positions.setXYZ(index, x * 0.76 * jaw, y * 1.12, z * 0.7 + nose - eyes);
  }
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uVisibility: { value: 1 },
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
        float wave = sin(position.y * 9.0 + uTime * 1.25 + uProgress * 5.0) * 0.018;
        vPulse = wave + 0.5;
        vec3 displaced = position + normal * wave * (1.0 + uProgress * 0.8);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uLeaf;
      uniform vec3 uForest;
      uniform float uProgress;
      uniform float uVisibility;
      varying float vPulse;
      varying vec3 vNormal;
      void main() {
        float fresnel = pow(1.0 - abs(vNormal.z), 2.2);
        float scanGrid = smoothstep(0.94, 1.0, sin(vPulse * 13.0 + uProgress * 9.0));
        vec3 color = mix(uForest, uLeaf, clamp(fresnel + vPulse * 0.26 + uProgress * 0.18 + scanGrid * 0.16, 0.0, 1.0));
        gl_FragColor = vec4(color, (0.13 + fresnel * 0.58 + scanGrid * 0.08) * uVisibility);
      }
    `,
  });
  const surface = new THREE.Mesh(geometry, material);
  const wire = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({ color: 0xdad7cd, wireframe: true, transparent: true, opacity: 0.11 }),
  );
  wire.scale.setScalar(1.012);
  const points = new THREE.Points(
    geometry.clone(),
    new THREE.PointsMaterial({ color: 0xbad5b7, size: 0.018, transparent: true, opacity: 0.3 }),
  );
  points.scale.setScalar(1.02);
  const group = new THREE.Group();
  group.add(surface, wire, points);
  return { group, material };
}

type FadableMaterial = THREE.Material & { opacity: number };

function createConstructionBrandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#132219';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#8fac91';
  context.lineWidth = 8;
  context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  context.fillStyle = '#dfe8dc';
  context.font = '700 66px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('CURITIBA EMPREITEIRA', canvas.width / 2, 105);
  context.fillStyle = '#a3b18a';
  context.font = '600 28px Arial, sans-serif';
  context.letterSpacing = '5px';
  context.fillText('OBRA EM CONSTRUÇÃO', canvas.width / 2, 173);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createConstructionSite() {
  const group = new THREE.Group();
  const materials: FadableMaterial[] = [];
  const material = (
    color: THREE.ColorRepresentation,
    baseOpacity = 1,
    options: { metalness?: number; roughness?: number; wireframe?: boolean } = {},
  ) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      metalness: options.metalness ?? 0.05,
      roughness: options.roughness ?? 0.82,
      wireframe: options.wireframe ?? false,
      transparent: true,
      opacity: 0,
    });
    value.userData.baseOpacity = baseOpacity;
    materials.push(value);
    return value;
  };
  const concrete = material('#b8b8ad', 1, { roughness: 0.94 });
  const concreteDark = material('#777f77', 1, { roughness: 0.96 });
  const steel = material('#536158', 0.94, { metalness: 0.58, roughness: 0.44 });
  const safety = material('#4b7754', 0.28, { roughness: 0.8 });
  const timber = material('#806d50', 0.86, { roughness: 0.9 });
  const groundMaterial = material('#2b3930', 0.82, { roughness: 1 });
  const addBox = (
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    boxMaterial: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), boxMaterial);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const addStrut = (
    parent: THREE.Object3D,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    strutMaterial: THREE.Material,
  ) => {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 6),
      strutMaterial,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const frame = new THREE.Group();
  const width = 6.8;
  const depth = 3.3;
  const baseY = -2.15;
  const floorHeight = 1.02;
  const floors = 5;
  for (let floor = 0; floor <= floors; floor += 1) {
    const y = baseY + floor * floorHeight;
    addBox(frame, [width, 0.14, depth], [0, y, 0], concrete);
    if (floor > 0) {
      addBox(frame, [width, 0.2, 0.2], [0, y - 0.12, depth / 2], concreteDark);
      addBox(frame, [width, 0.2, 0.2], [0, y - 0.12, -depth / 2], concreteDark);
    }
  }
  const columnHeight = floors * floorHeight;
  [-width / 2, -width / 6, width / 6, width / 2].forEach((x) => {
    [-depth / 2, 0, depth / 2].forEach((z) => {
      addBox(frame, [0.22, columnHeight, 0.22], [x, baseY + columnHeight / 2, z], concrete);
      addBox(frame, [0.045, 0.72, 0.045], [x, baseY + columnHeight + 0.36, z], steel);
    });
  });

  const scaffolding = new THREE.Group();
  const scaffoldZ = depth / 2 + 0.35;
  for (let x = -width / 2; x <= width / 2 + 0.01; x += width / 6) {
    addBox(scaffolding, [0.045, columnHeight + 0.45, 0.045], [x, baseY + columnHeight / 2, scaffoldZ], steel);
  }
  for (let floor = 0; floor <= floors; floor += 1) {
    const y = baseY + floor * floorHeight + 0.18;
    addBox(scaffolding, [width + 0.2, 0.045, 0.045], [0, y, scaffoldZ], steel);
  }
  for (let bay = 0; bay < 6; bay += 1) {
    const x0 = -width / 2 + bay * (width / 6);
    const x1 = x0 + width / 6;
    for (let floor = 0; floor < floors; floor += 1) {
      const y0 = baseY + floor * floorHeight + 0.2;
      const y1 = y0 + floorHeight * 0.82;
      addStrut(
        scaffolding,
        new THREE.Vector3(x0, y0, scaffoldZ),
        new THREE.Vector3(x1, y1, scaffoldZ),
        0.018,
        steel,
      );
    }
  }
  const safetyMesh = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.12, columnHeight * 0.78), safety);
  safetyMesh.position.set(0, baseY + columnHeight * 0.58, scaffoldZ + 0.03);
  scaffolding.add(safetyMesh);

  const site = new THREE.Group();
  const crane = new THREE.Group();
  const towerX = 4.25;
  const towerHeight = 6.55;
  [-0.13, 0.13].forEach((offsetX) => {
    [-0.13, 0.13].forEach((offsetZ) => {
      addBox(crane, [0.07, towerHeight, 0.07], [towerX + offsetX, baseY + towerHeight / 2, offsetZ], steel);
    });
  });
  for (let y = baseY; y <= baseY + towerHeight; y += 0.48) {
    addBox(crane, [0.42, 0.045, 0.045], [towerX, y, 0.13], steel);
    addBox(crane, [0.045, 0.045, 0.42], [towerX + 0.13, y, 0], steel);
    if (y + 0.44 <= baseY + towerHeight) {
      addStrut(
        crane,
        new THREE.Vector3(towerX - 0.13, y, 0.14),
        new THREE.Vector3(towerX + 0.13, y + 0.44, 0.14),
        0.018,
        steel,
      );
    }
  }
  const jibY = baseY + towerHeight;
  addBox(crane, [7.8, 0.13, 0.13], [0.55, jibY, 0], steel);
  addBox(crane, [1.25, 0.45, 0.55], [4.72, jibY - 0.18, 0], concreteDark);
  const cableMaterial = new THREE.LineBasicMaterial({ color: '#9fad9f', transparent: true, opacity: 0 });
  cableMaterial.userData.baseOpacity = 0.72;
  materials.push(cableMaterial);
  const cableGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.1, jibY, 0),
    new THREE.Vector3(-1.1, 0.45, 0),
  ]);
  const cable = new THREE.Line(cableGeometry, cableMaterial);
  crane.add(cable);
  const hook = addBox(crane, [0.22, 0.3, 0.16], [-1.1, 0.3, 0], steel);

  for (let stack = 0; stack < 5; stack += 1) {
    const x = -3.2 + stack * 1.22;
    const height = 0.18 + (stack % 3) * 0.08;
    for (let layer = 0; layer < 3; layer += 1) {
      addBox(site, [0.92, height, 0.68], [x, baseY + 0.12 + layer * (height + 0.035), 2.35], timber);
    }
  }
  addBox(site, [3.2, 0.08, 0.08], [2.1, baseY + 0.45, 2.2], steel).rotation.z = -0.09;
  addBox(site, [3.2, 0.08, 0.08], [2.15, baseY + 0.64, 2.2], steel).rotation.z = 0.07;

  const brandTexture = createConstructionBrandTexture();
  if (brandTexture) {
    const brandMaterial = new THREE.MeshBasicMaterial({
      map: brandTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    brandMaterial.userData.baseOpacity = 0.98;
    materials.push(brandMaterial);
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(3.25, 0.82), brandMaterial);
    brand.position.set(0.7, -1.05, depth / 2 + 0.43);
    group.add(brand);
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(19, 13), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = baseY - 0.1;
  ground.receiveShadow = true;
  group.add(ground, frame, scaffolding, crane, site);

  const hemisphere = new THREE.HemisphereLight('#d8dfd3', '#18231b', 1.25);
  const sun = new THREE.DirectionalLight('#f0eadb', 2.7);
  sun.position.set(-5, 8, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 28;
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -6;
  group.add(hemisphere, sun);
  group.position.set(0.25, -0.62, -1.4);
  group.rotation.y = -0.32;
  group.visible = false;

  return {
    group,
    materials,
    hook,
    cable,
    dispose: () => brandTexture?.dispose(),
  };
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
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
      gsap.fromTo('.presentation-team-giant-number', {
        xPercent: 68,
        scale: 1.6,
        rotate: 16,
        opacity: 0,
      }, {
        xPercent: 0,
        scale: 1,
        rotate: 0,
        opacity: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.presentation-story-team-teaser', start: 'top 96%', end: 'center 48%', scrub: 0.75, ...common },
      });
      gsap.fromTo('[data-story-team-copy] > *', {
        x: -190,
        y: 90,
        rotateY: -18,
        opacity: 0,
      }, {
        x: 0,
        y: 0,
        rotateY: 0,
        opacity: 1,
        stagger: 0.1,
        ease: 'power4.out',
        scrollTrigger: { trigger: '.presentation-story-team-teaser', start: 'top 90%', end: 'center 57%', scrub: 0.65, ...common },
      });
      gsap.fromTo('[data-story-team-disciplines] > *', {
        x: 220,
        scale: 0.72,
        opacity: 0,
      }, {
        x: 0,
        scale: 1,
        opacity: 1,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.presentation-story-team-teaser', start: 'top 80%', end: 'center 52%', scrub: 0.6, ...common },
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.3, 8.4);
    const grid = createSurveyGrid();
    scene.add(grid);
    const { group: core, material } = createDataCore();
    scene.add(core);
    const construction = createConstructionSite();
    scene.add(construction.group);
    const coreSurface = core.children[0] as THREE.Mesh;
    const ghostFaces = [-1, 1].map((direction) => {
      const ghost = new THREE.Mesh(
        coreSurface.geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x588157, wireframe: true, transparent: true, opacity: 0.065 }),
      );
      ghost.position.set(direction * 3.1, 0, -2.1);
      ghost.rotation.y = direction * -0.48;
      ghost.scale.setScalar(0.72);
      scene.add(ghost);
      return ghost;
    });
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
      const siteReveal = THREE.MathUtils.smoothstep(progress, 0.79, 0.965);
      material.uniforms.uTime.value = now / 1000;
      material.uniforms.uProgress.value = progress;
      material.uniforms.uVisibility.value = 1 - siteReveal;
      core.rotation.y = now * 0.00016 + progress * Math.PI * 2.2 + pointer.x * 0.09;
      core.rotation.x = -0.12 + pointer.y * 0.07 + Math.sin(now * 0.00042) * 0.035;
      core.position.x = Math.sin(progress * Math.PI * 2) * 1.5;
      core.position.y = 0.15 + Math.sin(progress * Math.PI * 3.4) * 0.65;
      core.scale.setScalar(1 - progress * 0.24);
      rings.forEach((ring, index) => {
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - siteReveal);
        ring.rotation.z += delta * (0.055 + index * 0.025);
        ring.rotation.y += delta * (0.035 + index * 0.018);
        ring.position.x = core.position.x * (0.2 + index * 0.08);
      });
      ghostFaces.forEach((ghost, index) => {
        (ghost.material as THREE.MeshBasicMaterial).opacity = 0.065 * (1 - siteReveal);
        ghost.position.y = Math.sin(now * 0.00038 + index * 2.1) * 0.18;
        ghost.rotation.y += delta * (index ? -0.018 : 0.018);
      });
      grid.position.z = (progress * 8) % 2;
      (grid.material as THREE.LineBasicMaterial).opacity = 0.16 * (1 - siteReveal);
      construction.group.visible = siteReveal > 0.002;
      construction.materials.forEach((constructionMaterial) => {
        constructionMaterial.opacity = constructionMaterial.userData.baseOpacity * siteReveal;
      });
      construction.group.position.y = -0.62 + (1 - siteReveal) * 1.15;
      construction.group.position.x = 0.25 + pointer.x * 0.08 * siteReveal;
      construction.group.rotation.y = -0.32 + (1 - siteReveal) * 0.16 + pointer.x * 0.025;
      construction.group.scale.setScalar(0.75 + siteReveal * 0.2);
      construction.hook.position.y = 0.3 + Math.sin(now * 0.0007) * 0.07;
      construction.cable.rotation.z = Math.sin(now * 0.00045) * 0.006;
      camera.position.z = 8.4 - Math.sin(progress * Math.PI) * 1.5 + siteReveal * 5.15;
      camera.position.x = pointer.x * 0.2 - siteReveal * 0.35;
      camera.position.y = 0.3 + siteReveal * 0.22;
      camera.lookAt(siteReveal * 0.2, -0.1, 0);
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener('scroll', updateTarget);
      window.removeEventListener('pointermove', onPointerMove);
      observer.disconnect();
      resizeObserver.disconnect();
      construction.dispose();
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
