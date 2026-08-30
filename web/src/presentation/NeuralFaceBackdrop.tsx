import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface NeuralFaceBackdropProps {
  paused?: boolean;
}

function createFaceGeometry(detail = 64) {
  const geometry = new THREE.SphereGeometry(1.72, detail, detail);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const originalX = positions.getX(index);
    const originalY = positions.getY(index);
    const originalZ = positions.getZ(index);
    const jaw = originalY < -0.32 ? 1 - Math.min(0.28, (-originalY - 0.32) * 0.16) : 1;
    const forehead = originalY > 0.68 ? 1 + Math.min(0.08, (originalY - 0.68) * 0.07) : 1;
    const nose = originalZ > 0
      ? Math.exp(-((originalX / 0.27) ** 2) - (((originalY - 0.02) / 0.42) ** 2)) * 0.42
      : 0;
    const eyeSocket = originalZ > 0
      ? Math.exp(-((((Math.abs(originalX) - 0.48) / 0.2) ** 2)) - (((originalY - 0.34) / 0.17) ** 2)) * 0.12
      : 0;
    positions.setXYZ(
      index,
      originalX * 0.76 * jaw * forehead,
      originalY * 1.12,
      originalZ * 0.7 + nose - eyeSocket,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points) && !(child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function NeuralFaceBackdrop({ paused = false }: NeuralFaceBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.45));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    camera.position.set(0, 0.05, 8.6);
    const faceGeometry = createFaceGeometry();
    const faceMaterial = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uLeaf: { value: new THREE.Color('#a3b18a') },
        uForest: { value: new THREE.Color('#3a5a40') },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          float signal = sin(position.y * 9.0 - uTime * 1.4) * 0.012;
          vec3 displaced = position + normal * signal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uLeaf;
        uniform vec3 uForest;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float fresnel = pow(1.0 - abs(vNormal.z), 2.35);
          float horizontal = smoothstep(0.94, 1.0, sin((vPosition.y + uTime * 0.16) * 38.0));
          float vertical = smoothstep(0.965, 1.0, sin(vPosition.x * 44.0));
          float scan = smoothstep(0.0, 0.08, abs(fract(vPosition.y * 0.18 - uTime * 0.11) - 0.5));
          vec3 color = mix(uForest, uLeaf, fresnel + horizontal * 0.28 + vertical * 0.12);
          float alpha = 0.13 + fresnel * 0.52 + horizontal * 0.18 + vertical * 0.1 + scan * 0.03;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.rotation.x = -0.02;
    scene.add(face);

    const wire = new THREE.Mesh(
      faceGeometry.clone(),
      new THREE.MeshBasicMaterial({ color: 0xdad7cd, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    wire.scale.setScalar(1.012);
    face.add(wire);

    const points = new THREE.Points(
      faceGeometry.clone(),
      new THREE.PointsMaterial({ color: 0xb9cfb5, size: 0.018, transparent: true, opacity: 0.34, sizeAttenuation: true }),
    );
    points.scale.setScalar(1.018);
    face.add(points);

    const ghosts = [-1, 1].map((direction) => {
      const ghost = new THREE.Mesh(
        faceGeometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x588157, wireframe: true, transparent: true, opacity: 0.075 }),
      );
      ghost.position.set(direction * 2.45, 0.05, -1.5);
      ghost.rotation.y = direction * -0.42;
      ghost.scale.setScalar(0.78);
      scene.add(ghost);
      return ghost;
    });

    const scanPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.8, 0.018),
      new THREE.MeshBasicMaterial({ color: 0xb9efbf, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending }),
    );
    scanPlane.position.z = 1.72;
    scene.add(scanPlane);

    const grid = new THREE.GridHelper(18, 36, 0x588157, 0x344e41);
    grid.position.set(0, -2.25, -2.4);
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    scene.add(grid);

    const pointer = new THREE.Vector2();
    const targetPointer = new THREE.Vector2();
    let frame = 0;
    let visible = true;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const onPointerMove = (event: PointerEvent) => {
      targetPointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.01 });
    const resizeObserver = new ResizeObserver(resize);
    observer.observe(canvas);
    resizeObserver.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    resize();
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    const render = (now: number) => {
      frame = window.requestAnimationFrame(render);
      if (!visible || document.hidden || pausedRef.current) return;
      pointer.lerp(targetPointer, reduced ? 0.02 : 0.055);
      faceMaterial.uniforms.uTime.value = now / 1000;
      face.rotation.y = pointer.x * 0.2 + Math.sin(now * 0.00022) * (reduced ? 0 : 0.08);
      face.rotation.x = -0.03 - pointer.y * 0.12;
      face.position.y = Math.sin(now * 0.0005) * (reduced ? 0 : 0.07);
      ghosts.forEach((ghost, index) => {
        ghost.position.y = Math.sin(now * 0.00035 + index * 1.7) * (reduced ? 0 : 0.12);
      });
      scanPlane.position.y = reduced ? 0 : Math.sin(now * 0.00105) * 1.8;
      camera.position.x = pointer.x * 0.22;
      camera.position.y = pointer.y * 0.1;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
      observer.disconnect();
      resizeObserver.disconnect();
      disposeObject(scene);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="neural-face-backdrop" aria-hidden="true" />;
}
