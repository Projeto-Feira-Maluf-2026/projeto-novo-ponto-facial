import { Box, Maximize2, MousePointer2, RefreshCcw, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Worksite } from '../types/domain';

interface WorksiteWorld3DProps {
  worksite: Worksite;
}
interface WorldBuild {
  root: THREE.Group;
  interactables: THREE.Object3D[];
}

const palettes = [
  { wall: 0xd9d8d3, side: 0xb8b9b5, accent: 0x8b7653, glass: 0x6f8587 },
  { wall: 0xd5d8d6, side: 0xaeb5b3, accent: 0x55766c, glass: 0x647c82 },
  { wall: 0xd8d7d2, side: 0xb0b1ae, accent: 0x65727a, glass: 0x637880 },
  { wall: 0xd8d4cf, side: 0xb6b0aa, accent: 0x806b5d, glass: 0x687e80 },
];

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  options: { cast?: boolean; receive?: boolean; name?: string; outline?: boolean } = {},
) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  object.position.set(...position);
  object.castShadow = options.cast ?? true;
  object.receiveShadow = options.receive ?? true;
  if (options.name) {
    object.name = options.name;
    object.userData.assetLabel = options.name;
  }
  parent.add(object);
  if (options.outline) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(object.geometry, 24),
      new THREE.LineBasicMaterial({ color: 0x4d5755, transparent: true, opacity: 0.22 }),
    );
    edges.position.copy(object.position);
    edges.rotation.copy(object.rotation);
    parent.add(edges);
  }
  return object;
}

function createBuilding(
  random: () => number,
  palette: (typeof palettes)[number],
  name: string,
  variant: number,
) {
  const building = new THREE.Group();
  building.name = name;
  building.userData.assetLabel = name;

  const width = 7.2 + random() * 2.4;
  const depth = 5.2 + random() * 1.5;
  const floors = 5 + Math.floor(random() * 5);
  const floorHeight = 0.86;
  const completeFloors = Math.max(3, floors - 1 - Math.floor(random() * 2));
  const builtHeight = completeFloors * floorHeight;

  const concrete = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.84, metalness: 0.03 });
  const core = new THREE.MeshStandardMaterial({ color: palette.side, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.62, metalness: 0.18 });
  const structure = new THREE.MeshStandardMaterial({ color: 0xaaa9a4, roughness: 0.94 });
  const mullion = new THREE.MeshStandardMaterial({ color: 0x505a5a, roughness: 0.42, metalness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: palette.glass,
    transparent: true,
    opacity: 0.78,
    roughness: 0.18,
    metalness: 0.12,
    transmission: 0.08,
    clearcoat: 0.35,
  });

  addBox(building, [width, builtHeight, depth], [0, builtHeight / 2 + 0.32, 0], concrete, { name, outline: true });
  addBox(building, [width + 1.1, 0.5, depth + 0.9], [0, 0.25, 0.1], structure, { outline: true });
  addBox(building, [1.28, builtHeight + 0.12, depth + 0.18], [-width / 2 + 0.78, builtHeight / 2 + 0.35, 0], core, { outline: true });

  const facadeWidth = width * (variant === 2 ? 0.7 : 0.76);
  const facadeX = width * 0.08;
  addBox(
    building,
    [facadeWidth, builtHeight - 0.38, 0.09],
    [facadeX, builtHeight / 2 + 0.34, depth / 2 + 0.055],
    glass,
    { cast: false, receive: false, outline: true },
  );

  const bayCount = 4 + variant;
  for (let column = 0; column <= bayCount; column += 1) {
    const x = facadeX - facadeWidth / 2 + (column * facadeWidth) / bayCount;
    addBox(building, [0.055, builtHeight - 0.3, 0.065], [x, builtHeight / 2 + 0.34, depth / 2 + 0.115], mullion, { cast: false });
  }
  for (let floor = 1; floor < completeFloors; floor += 1) {
    addBox(
      building,
      [facadeWidth, 0.055, 0.065],
      [facadeX, 0.35 + floor * floorHeight, depth / 2 + 0.116],
      mullion,
      { cast: false },
    );
  }

  if (variant === 1) {
    addBox(building, [0.34, builtHeight + 0.18, 0.18], [width * 0.34, builtHeight / 2 + 0.33, depth / 2 + 0.13], accent);
  } else if (variant === 2) {
    addBox(building, [facadeWidth, 0.22, 0.2], [facadeX, builtHeight - 0.38, depth / 2 + 0.13], accent);
  } else {
    addBox(building, [0.24, builtHeight + 0.1, depth + 0.2], [width / 2 - 0.42, builtHeight / 2 + 0.34, 0], accent);
  }

  for (let floor = completeFloors; floor < floors; floor += 1) {
    const slabY = 0.32 + floor * floorHeight;
    addBox(building, [width + 0.18, 0.14, depth + 0.18], [0, slabY, 0], structure, { outline: true });
    const columns: Array<[number, number]> = [
      [-width / 2 + 0.28, -depth / 2 + 0.28],
      [width / 2 - 0.28, -depth / 2 + 0.28],
      [-width / 2 + 0.28, depth / 2 - 0.28],
      [width / 2 - 0.28, depth / 2 - 0.28],
    ];
    columns.forEach(([x, z]) => addBox(building, [0.2, floorHeight, 0.2], [x, slabY + floorHeight / 2, z], structure));
  }

  const roofHeight = 0.32 + floors * floorHeight;
  addBox(building, [2.25, 0.4, 1.5], [-width * 0.18, roofHeight + 0.2, -depth * 0.08], core, { outline: true });
  addBox(building, [width * 0.45, 0.12, 1.1], [width * 0.16, roofHeight + 0.08, depth * 0.24], accent);
  return building;
}

function buildWorld(worksite: Worksite): WorldBuild {
  const seed = hashSeed(`${worksite.id}:${worksite.code}:${worksite.name}:${worksite.geofence_radius_meters}`);
  const random = createRandom(seed);
  const palette = palettes[seed % palettes.length];
  const variant = seed % 3;
  const root = new THREE.Group();
  root.name = `Mundo 3D de ${worksite.name}`;
  const interactables: THREE.Object3D[] = [];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 36),
    new THREE.MeshStandardMaterial({ color: 0xd1d2cd, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const sitePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(29, 23),
    new THREE.MeshStandardMaterial({ color: 0xe1dfd8, roughness: 0.98 }),
  );
  sitePlate.rotation.x = -Math.PI / 2;
  sitePlate.position.y = 0.015;
  sitePlate.receiveShadow = true;
  root.add(sitePlate);

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x747977, roughness: 0.94 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(46, 5.5), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.025, 15.1);
  road.receiveShadow = true;
  root.add(road);
  const curbMaterial = new THREE.MeshStandardMaterial({ color: 0xb5b6b1, roughness: 0.95 });
  addBox(root, [46, 0.13, 0.18], [0, 0.065, 12.35], curbMaterial, { cast: false });
  addBox(root, [46, 0.13, 0.18], [0, 0.065, 17.83], curbMaterial, { cast: false });

  const contextMaterial = new THREE.MeshStandardMaterial({
    color: 0xc2c6c4,
    transparent: true,
    opacity: 0.44,
    roughness: 0.92,
  });
  for (let index = 0; index < 7; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const contextWidth = 3.8 + random() * 3.2;
    const contextDepth = 3 + random() * 2;
    const contextHeight = 2.5 + random() * 4.5;
    addBox(
      root,
      [contextWidth, contextHeight, contextDepth],
      [side * (17 + random() * 2.4), contextHeight / 2, -11 + index * 3.7],
      contextMaterial,
      { cast: false, outline: true },
    );
  }

  const building = createBuilding(random, palette, worksite.name, variant);
  building.position.set(-0.6 + random() * 1.2, 0.02, -1.4 + random() * 0.8);
  building.rotation.y = (random() - 0.5) * 0.08;
  root.add(building);
  interactables.push(building);

  const office = new THREE.Group();
  office.userData.assetLabel = 'Escritório da obra';
  office.position.set(-9.2, 0, 5.6);
  const officeShell = new THREE.MeshStandardMaterial({ color: 0xb6bbb8, roughness: 0.78, metalness: 0.1 });
  const officeGlass = new THREE.MeshPhysicalMaterial({ color: 0x71898b, roughness: 0.16, metalness: 0.12 });
  addBox(office, [4.8, 1.82, 2.55], [0, 0.92, 0], officeShell, { name: 'Escritório da obra', outline: true });
  addBox(office, [2.7, 0.7, 0.07], [-0.48, 1.08, 1.31], officeGlass, { cast: false });
  addBox(office, [0.72, 1.5, 0.08], [1.6, 0.77, 1.31], new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.65 }));
  addBox(office, [5.2, 0.12, 3.05], [0, 1.95, 0.18], new THREE.MeshStandardMaterial({ color: 0x8b908d, roughness: 0.72 }), { outline: true });
  root.add(office);
  interactables.push(office);

  const materialsArea = new THREE.Group();
  materialsArea.userData.assetLabel = 'Área de materiais';
  materialsArea.position.set(9.3, 0, 5.8);
  const steel = new THREE.MeshStandardMaterial({ color: 0x626967, roughness: 0.48, metalness: 0.62 });
  addBox(materialsArea, [4.8, 0.14, 3.15], [0, 2.2, 0], steel, { name: 'Área de materiais', outline: true });
  ([-2.1, 2.1] as const).forEach((x) => {
    ([-1.25, 1.25] as const).forEach((z) => addBox(materialsArea, [0.14, 2.2, 0.14], [x, 1.1, z], steel));
  });
  for (let row = 0; row < 3; row += 1) {
    addBox(materialsArea, [3.6 - row * 0.35, 0.2, 0.42], [0, 0.18 + row * 0.22, 0.35], new THREE.MeshStandardMaterial({ color: 0xa69c89, roughness: 0.95 }));
  }
  root.add(materialsArea);
  interactables.push(materialsArea);

  const fenceMaterial = new THREE.MeshStandardMaterial({ color: 0x8c9290, roughness: 0.62, metalness: 0.42 });
  for (let x = -14; x <= 14; x += 2) {
    addBox(root, [0.04, 1.02, 0.04], [x, 0.51, -11.4], fenceMaterial, { cast: false });
  }
  addBox(root, [28.2, 0.03, 0.03], [0, 0.82, -11.4], fenceMaterial, { cast: false });
  addBox(root, [28.2, 0.03, 0.03], [0, 0.25, -11.4], fenceMaterial, { cast: false });

  const crane = new THREE.Group();
  crane.position.set(10.2, 0, -6.7);
  const craneMaterial = new THREE.MeshStandardMaterial({ color: 0x8c7959, roughness: 0.5, metalness: 0.42 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x4f5755, roughness: 0.42, metalness: 0.68 });
  addBox(crane, [0.34, 8.6, 0.34], [0, 4.3, 0], craneMaterial);
  const craneHead = new THREE.Group();
  craneHead.position.y = 8.55;
  addBox(craneHead, [10.6, 0.2, 0.2], [-2.65, 0, 0], craneMaterial);
  addBox(craneHead, [2.2, 0.28, 0.28], [1.35, 0, 0], darkMetal);
  addBox(craneHead, [0.055, 3.9, 0.055], [-7.55, -1.95, 0], darkMetal, { cast: false });
  addBox(craneHead, [0.55, 0.35, 0.55], [-7.55, -3.9, 0], darkMetal);
  crane.add(craneHead);
  root.add(crane);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 1 });
  const landscapeMaterial = new THREE.MeshStandardMaterial({ color: 0x75877a, roughness: 0.96 });
  for (let index = 0; index < 6; index += 1) {
    const tree = new THREE.Group();
    const side = index % 2 === 0 ? -1 : 1;
    tree.position.set(side * (15.2 + random() * 1.2), 0, -7 + index * 3.3);
    addBox(tree, [0.16, 1.25, 0.16], [0, 0.625, 0], trunkMaterial);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.82, 1.55, 16), landscapeMaterial);
    crown.position.y = 1.85;
    crown.castShadow = true;
    tree.add(crown);
    root.add(tree);
  }

  const boundaryRadius = 13.2 + Math.min(2.2, worksite.geofence_radius_meters / 190);
  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(boundaryRadius, boundaryRadius + 0.045, 160),
    new THREE.MeshBasicMaterial({
      color: worksite.active ? 0x4c8876 : 0x8c7b60,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    }),
  );
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.06;
  root.add(boundary);

  return { root, interactables };
}

export function WorksiteWorld3D({ worksite }: WorksiteWorld3DProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return undefined;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const compactViewport = window.matchMedia('(max-width: 767px)').matches;
    const ambientMotion = !reduceMotion && !compactViewport;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4e8e6);
    scene.fog = new THREE.Fog(0xe4e8e6, 34, 76);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    const homePosition = new THREE.Vector3(24, 18, 27);
    const homeTarget = new THREE.Vector3(0, 2.8, 0);
    camera.position.copy(homePosition);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const hemisphere = new THREE.HemisphereLight(0xf4f6f4, 0x7b7b75, 2.15);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff3df, 2.75);
    sun.position.set(-16, 23, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const world = buildWorld(worksite);
    world.root.position.y = reduceMotion ? 0 : -0.22;
    scene.add(world.root);
    const grid = new THREE.GridHelper(46, 46, 0x7f8b87, 0xaeb6b2);
    grid.position.y = 0.035;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.1; });
    scene.add(grid);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(homeTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 11;
    controls.maxDistance = 58;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.rotateSpeed = 0.68;
    controls.zoomSpeed = 0.82;
    controls.panSpeed = 0.62;
    controls.listenToKeyEvents(canvas);
    controls.update();

    const resize = () => {
      const width = Math.max(frame.clientWidth, 1);
      const height = Math.max(frame.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frame);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = { x: 0, y: 0 };
    const updatePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(world.interactables, true)[0]?.object ?? null;
    };
    const assetName = (object: THREE.Object3D | null) => {
      let current = object;
      while (current) {
        if (typeof current.userData.assetLabel === 'string') return current.userData.assetLabel as string;
        current = current.parent;
      }
      return null;
    };
    const onPointerMove = (event: PointerEvent) => {
      canvas.style.cursor = assetName(updatePointer(event)) ? 'pointer' : 'grab';
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
      canvas.focus({ preventScroll: true });
    };
    const onPointerUp = (event: PointerEvent) => {
      const movement = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      if (movement < 5) setSelectedAsset(assetName(updatePointer(event)));
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    let animationFrame = 0;
    let visible = true;
    let running = true;
    let interacting = false;
    let settleFrames = 0;
    const startedAt = performance.now();
    const animate = (time: number) => {
      if (!running || !visible || document.hidden) {
        animationFrame = 0;
        return;
      }
      const elapsed = time - startedAt;
      if (!reduceMotion) {
        const entrance = Math.min(1, elapsed / 520);
        world.root.position.y = -0.22 * (1 - (1 - Math.pow(1 - entrance, 3)));
      }
      if (ambientMotion && !interacting) {
        world.root.rotation.y = Math.sin(elapsed * 0.00012) * 0.012;
      }
      controls.update();
      renderer.render(scene, camera);
      if (settleFrames > 0) settleFrames -= 1;
      const entranceRunning = !reduceMotion && elapsed < 540;
      if (ambientMotion || entranceRunning || interacting || settleFrames > 0) {
        animationFrame = window.requestAnimationFrame(animate);
      }
      else animationFrame = 0;
    };
    const startAnimation = () => {
      if (!animationFrame && running && visible && !document.hidden) animationFrame = window.requestAnimationFrame(animate);
    };
    const onControlStart = () => {
      interacting = true;
      startAnimation();
    };
    const onControlEnd = () => {
      interacting = false;
      settleFrames = 42;
      startAnimation();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('end', onControlEnd);

    resetRef.current = () => {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      controls.update();
      settleFrames = 2;
      startAnimation();
      setSelectedAsset(null);
    };

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        settleFrames = Math.max(settleFrames, 1);
        startAnimation();
      }
    }, { threshold: 0.02 });
    intersectionObserver.observe(frame);
    const onVisibilityChange = () => startAnimation();
    document.addEventListener('visibilitychange', onVisibilityChange);
    startAnimation();
    setReady(true);
    setFailed(false);

    return () => {
      running = false;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('end', onControlEnd);
      controls.stopListenToKeyEvents();
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      resetRef.current = () => undefined;
    };
  }, [worksite]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!frameRef.current || !document.fullscreenEnabled) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await frameRef.current.requestFullscreen();
  };

  return (
    <div ref={frameRef} className="worksite-world-frame" data-ready={ready}>
      <canvas
        ref={canvasRef}
        className="worksite-world-canvas"
        tabIndex={0}
        aria-label={`Mundo tridimensional interativo da obra ${worksite.name}. Arraste para girar, use a roda para aproximar e as setas para navegar.`}
      />

      <div className="worksite-world-hud worksite-world-hud-top">
        <span className="world-live-pill"><i /> Modelo ativo</span>
        <span>{worksite.code}</span>
      </div>

      <div className="worksite-world-tools" aria-label="Controles da visualização">
        <button type="button" onClick={() => resetRef.current()} aria-label="Reposicionar visão" title="Reposicionar visão">
          <RefreshCcw size={17} />
        </button>
        {document.fullscreenEnabled && (
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Sair da tela cheia' : 'Abrir em tela cheia'} title="Tela cheia">
            <Maximize2 size={17} />
          </button>
        )}
      </div>

      <div className="worksite-world-guide" aria-hidden="true">
        <span><MousePointer2 size={14} /> Arraste para explorar</span>
        <span><ZoomIn size={14} /> Role para aproximar</span>
      </div>

      <div className="worksite-world-caption">
        <span className="worksite-world-icon"><Box size={18} /></span>
        <div>
          <small>{selectedAsset ? 'Elemento selecionado' : 'Gêmeo digital da obra'}</small>
          <strong>{selectedAsset ?? worksite.name}</strong>
        </div>
        <span className={`status-pill ${worksite.active ? 'status-pill-online' : 'status-pill-neutral'}`}>
          <span className="status-dot" /> {worksite.active ? 'Operacional' : 'Inativo'}
        </span>
      </div>

      {!ready && !failed && <div className="worksite-world-loading"><span /> Preparando ambiente 3D</div>}
      {failed && (
        <div className="worksite-world-fallback" role="status">
          <div className="fallback-building-scene" aria-hidden="true">
            <span className="fallback-building">
              {Array.from({ length: 12 }).map((_, index) => <i key={index} />)}
            </span>
            <span className="fallback-building-core" />
            <span className="fallback-crane"><i /><b /></span>
            <span className="fallback-ground" />
          </div>
          <div className="fallback-building-copy">
            <strong>Prévia arquitetônica simplificada</strong>
            <span>O modelo interativo requer WebGL disponível neste dispositivo.</span>
          </div>
        </div>
      )}
    </div>
  );
}
