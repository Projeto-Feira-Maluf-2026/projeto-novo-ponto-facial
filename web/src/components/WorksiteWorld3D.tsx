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
  craneHead: THREE.Group;
  dust: THREE.Points;
  interactables: THREE.Object3D[];
}

const palettes = [
  { wall: 0xd8d4ca, side: 0xb9b2a5, accent: 0xc1842e, glass: 0x294247 },
  { wall: 0xd5d9d3, side: 0xaeb9b0, accent: 0x2e8068, glass: 0x203a45 },
  { wall: 0xd8d2c8, side: 0xaaa39a, accent: 0x496b7b, glass: 0x263c4a },
  { wall: 0xdacfc3, side: 0xb5a99d, accent: 0xa86135, glass: 0x263d42 },
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
  options: { cast?: boolean; receive?: boolean; name?: string } = {},
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

  const width = 5.8 + random() * 2.2;
  const depth = 4.6 + random() * 1.6;
  const floors = 4 + Math.floor(random() * 5);
  const floorHeight = 0.88;
  const completeFloors = Math.max(2, floors - 1 - Math.floor(random() * 2));
  const wall = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.88, metalness: 0.02 });
  const side = new THREE.MeshStandardMaterial({ color: palette.side, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.65, metalness: 0.08 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x99978f, roughness: 0.96 });
  const glass = new THREE.MeshStandardMaterial({
    color: palette.glass,
    emissive: palette.glass,
    emissiveIntensity: 0.13,
    roughness: 0.26,
    metalness: 0.18,
  });

  addBox(building, [width, completeFloors * floorHeight, depth], [0, (completeFloors * floorHeight) / 2, 0], wall, { name });
  addBox(building, [0.3, completeFloors * floorHeight + 0.08, depth + 0.04], [-width / 2 + 0.15, (completeFloors * floorHeight) / 2, 0], side);
  addBox(building, [width + 0.18, 0.22, depth + 0.18], [0, 0.11, 0], concrete);

  const windowColumns = 3 + variant;
  for (let floor = 0; floor < completeFloors; floor += 1) {
    for (let column = 0; column < windowColumns; column += 1) {
      const x = -width * 0.34 + (column * width * 0.68) / Math.max(windowColumns - 1, 1);
      const y = 0.46 + floor * floorHeight;
      addBox(building, [0.62, 0.38, 0.075], [x, y, depth / 2 + 0.042], glass, { cast: false, receive: false });
    }
  }

  if (variant === 1) {
    addBox(building, [0.56, completeFloors * floorHeight + 0.18, 0.22], [width * 0.29, (completeFloors * floorHeight) / 2, depth / 2 + 0.08], accent);
  } else if (variant === 2) {
    addBox(building, [width * 0.76, 0.28, 0.28], [0, completeFloors * floorHeight - 0.35, depth / 2 + 0.09], accent);
  } else {
    addBox(building, [0.25, completeFloors * floorHeight, depth + 0.15], [width / 2 - 0.4, (completeFloors * floorHeight) / 2, 0], accent);
  }

  const unfinishedStart = completeFloors;
  for (let floor = unfinishedStart; floor < floors; floor += 1) {
    const y = floor * floorHeight;
    addBox(building, [width + 0.22, 0.18, depth + 0.22], [0, y, 0], concrete);
    const columns: Array<[number, number]> = [
      [-width / 2 + 0.24, -depth / 2 + 0.24],
      [width / 2 - 0.24, -depth / 2 + 0.24],
      [-width / 2 + 0.24, depth / 2 - 0.24],
      [width / 2 - 0.24, depth / 2 - 0.24],
    ];
    columns.forEach(([x, z]) => addBox(building, [0.22, floorHeight, 0.22], [x, y + floorHeight / 2, z], concrete));
  }

  const roofHeight = floors * floorHeight;
  addBox(building, [1.9, 0.38, 1.35], [-width * 0.18, roofHeight + 0.18, -depth * 0.08], side);
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

  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x8d9686, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(38, 31), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const innerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 20),
    new THREE.MeshStandardMaterial({ color: 0xb7b19e, roughness: 1 }),
  );
  innerGround.rotation.x = -Math.PI / 2;
  innerGround.position.y = 0.012;
  innerGround.receiveShadow = true;
  root.add(innerGround);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(38, 5.3),
    new THREE.MeshStandardMaterial({ color: 0x555853, roughness: 0.92 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.025, 12.7);
  road.receiveShadow = true;
  root.add(road);
  for (let x = -16; x <= 16; x += 3.2) {
    addBox(root, [1.65, 0.025, 0.12], [x, 0.05, 12.7], new THREE.MeshBasicMaterial({ color: 0xe4d6a2 }), { cast: false });
  }

  const building = createBuilding(random, palette, worksite.name, variant);
  building.position.set(-0.8 + random() * 1.6, 0.05, -1.3 + random() * 1.2);
  building.rotation.y = (random() - 0.5) * 0.15;
  root.add(building);
  interactables.push(building);

  const utilityMaterial = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.7 });
  const containerMaterial = new THREE.MeshStandardMaterial({ color: 0x355c5d, roughness: 0.76, metalness: 0.08 });
  const office = new THREE.Group();
  office.userData.assetLabel = 'Escritório da obra';
  office.position.set(-8.7, 0, 5.3);
  addBox(office, [4.6, 1.85, 2.55], [0, 0.95, 0], containerMaterial, { name: 'Escritório da obra' });
  addBox(office, [1.25, 0.68, 0.06], [-0.92, 1.1, 1.31], new THREE.MeshStandardMaterial({ color: 0xbdd5d4, roughness: 0.25 }), { cast: false });
  addBox(office, [0.8, 1.45, 0.07], [1.25, 0.76, 1.31], utilityMaterial);
  root.add(office);
  interactables.push(office);

  const storage = new THREE.Group();
  storage.userData.assetLabel = 'Área de materiais';
  storage.position.set(8.4, 0, 5.6);
  addBox(storage, [4.15, 1.45, 2.25], [0, 0.75, 0], new THREE.MeshStandardMaterial({ color: 0xa86635, roughness: 0.82 }), { name: 'Área de materiais' });
  for (let line = -1; line <= 1; line += 1) {
    addBox(storage, [3.8, 0.055, 0.045], [0, 0.53 + line * 0.35, 1.145], new THREE.MeshBasicMaterial({ color: 0xd5ad72 }), { cast: false });
  }
  root.add(storage);
  interactables.push(storage);

  const fenceMaterial = new THREE.MeshStandardMaterial({ color: 0xc0b8a9, roughness: 0.78, metalness: 0.45 });
  for (let x = -12.2; x <= 12.2; x += 1.75) {
    addBox(root, [0.045, 1.05, 0.045], [x, 0.53, -9.7], fenceMaterial, { cast: false });
  }
  addBox(root, [24.6, 0.035, 0.035], [0, 0.85, -9.7], fenceMaterial, { cast: false });
  addBox(root, [24.6, 0.035, 0.035], [0, 0.25, -9.7], fenceMaterial, { cast: false });

  const crane = new THREE.Group();
  crane.position.set(8.9, 0, -5.6);
  const craneMaterial = new THREE.MeshStandardMaterial({ color: 0xe0a22d, roughness: 0.55, metalness: 0.28 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3f4543, roughness: 0.52, metalness: 0.62 });
  addBox(crane, [0.5, 8.3, 0.5], [0, 4.15, 0], craneMaterial);
  const craneHead = new THREE.Group();
  craneHead.position.y = 8.25;
  addBox(craneHead, [9.7, 0.28, 0.28], [-2.35, 0, 0], craneMaterial);
  addBox(craneHead, [2.1, 0.38, 0.38], [1.3, 0, 0], darkMetal);
  addBox(craneHead, [0.08, 4.1, 0.08], [-6.65, -2.05, 0], darkMetal, { cast: false });
  addBox(craneHead, [0.8, 0.55, 0.8], [-6.65, -4.1, 0], utilityMaterial);
  crane.add(craneHead);
  root.add(crane);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x69543d, roughness: 1 });
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x426c54, roughness: 0.95 });
  for (let index = 0; index < 9; index += 1) {
    const tree = new THREE.Group();
    const side = index % 2 === 0 ? -1 : 1;
    tree.position.set(side * (14 + random() * 2), 0, -7 + index * 2.1 + random());
    addBox(tree, [0.24, 1.4, 0.24], [0, 0.7, 0], trunkMaterial);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 + random() * 0.35, 1), leafMaterial);
    crown.position.y = 1.75;
    crown.castShadow = true;
    tree.add(crown);
    root.add(tree);
  }

  const boundaryRadius = 12.1 + Math.min(2.5, worksite.geofence_radius_meters / 160);
  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(boundaryRadius, boundaryRadius + 0.075, 128),
    new THREE.MeshBasicMaterial({ color: worksite.active ? 0x45c29a : 0xd19a39, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.065;
  root.add(boundary);

  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions: number[] = [];
  for (let index = 0; index < 90; index += 1) {
    dustPositions.push((random() - 0.5) * 28, 0.45 + random() * 7, (random() - 0.5) * 22);
  }
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({ color: 0xf1dfb7, size: 0.045, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  root.add(dust);

  return { root, craneHead, dust, interactables };
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
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcbd5cf);
    scene.fog = new THREE.Fog(0xcbd5cf, 27, 62);
    const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 100);
    const homePosition = new THREE.Vector3(21, 15, 23);
    const homeTarget = new THREE.Vector3(0, 2.35, 0);
    camera.position.copy(homePosition);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const hemisphere = new THREE.HemisphereLight(0xe8f2ef, 0x6b675b, 2.05);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff2d5, 3.1);
    sun.position.set(-13, 20, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const world = buildWorld(worksite);
    world.root.position.y = reduceMotion ? 0 : -0.45;
    scene.add(world.root);
    const grid = new THREE.GridHelper(38, 38, 0x71827a, 0x95a198);
    grid.position.y = 0.035;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.16; });
    scene.add(grid);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(homeTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 9;
    controls.maxDistance = 48;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.rotateSpeed = 0.68;
    controls.zoomSpeed = 0.82;
    controls.panSpeed = 0.62;
    controls.listenToKeyEvents(canvas);
    controls.update();

    resetRef.current = () => {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      controls.update();
      setSelectedAsset(null);
    };

    const resize = () => {
      const width = Math.max(frame.clientWidth, 1);
      const height = Math.max(frame.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
    const startedAt = performance.now();
    const animate = (time: number) => {
      if (!running || !visible || document.hidden) {
        animationFrame = 0;
        return;
      }
      const elapsed = time - startedAt;
      if (!reduceMotion) {
        world.craneHead.rotation.y += 0.0007;
        world.dust.rotation.y += 0.00012;
        const entrance = Math.min(1, elapsed / 900);
        world.root.position.y = -0.45 * (1 - (1 - Math.pow(1 - entrance, 3)));
      }
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    const startAnimation = () => {
      if (!animationFrame && running && visible && !document.hidden) animationFrame = window.requestAnimationFrame(animate);
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) startAnimation();
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
      {failed && <div className="worksite-world-fallback">Este dispositivo não conseguiu iniciar a visualização 3D.</div>}
    </div>
  );
}
