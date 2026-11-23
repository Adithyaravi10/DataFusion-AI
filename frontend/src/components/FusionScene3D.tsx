import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useTheme } from "../lib/theme";

const NODE_COUNT = 150;
const SHELL_RADIUS = 2.15;

function buildShell(count: number, radius: number) {
  const points: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push(new THREE.Vector3(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius));
  }
  return points;
}

function buildLinks(points: THREE.Vector3[], maxDistance: number) {
  const segments: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (points[i].distanceTo(points[j]) <= maxDistance) {
        segments.push(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z);
      }
    }
  }
  return new Float32Array(segments);
}

/** Soft radial sprite used for node bloom and the warm core halo. */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.22, "rgba(255,255,255,0.72)");
    gradient.addColorStop(0.52, "rgba(255,255,255,0.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface SceneProps {
  accent: string;
  node: string;
  muted: string;
  reduced: boolean;
  dark: boolean;
}

function FusionCore({ accent, node, muted, reduced, dark }: SceneProps) {
  const orbit = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);

  const points = useMemo(() => buildShell(NODE_COUNT, SHELL_RADIUS), []);
  const linkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(buildLinks(points, 0.68), 3));
    return geometry;
  }, [points]);
  const glow = useMemo(() => makeGlowTexture(), []);

  const dots = useMemo(() => {
    const geometry = new THREE.SphereGeometry(0.055, 12, 12);
    const material = new THREE.MeshBasicMaterial({ color: node, transparent: true, opacity: 0.98 });
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    const matrix = new THREE.Matrix4();
    points.forEach((point, index) => {
      matrix.makeTranslation(point.x, point.y, point.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [points, node]);

  const nodeGlow = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: node,
        transparent: true,
        opacity: dark ? 0.72 : 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [glow, node, dark],
  );

  useFrame((state, delta) => {
    const step = Math.min(delta, 0.05);
    const time = state.clock.elapsedTime;

    if (orbit.current) {
      // Continuous 360° spin, independent of the pointer.
      if (!reduced) orbit.current.rotation.y += step * 0.24;
      orbit.current.rotation.x = THREE.MathUtils.lerp(
        orbit.current.rotation.x,
        -0.18 + state.pointer.y * 0.2,
        0.045,
      );
      orbit.current.rotation.z = THREE.MathUtils.lerp(orbit.current.rotation.z, state.pointer.x * 0.1, 0.045);
      // Hover: two layered waves so the float never feels mechanical.
      const hover = reduced ? 0 : Math.sin(time * 0.85) * 0.13 + Math.sin(time * 0.41 + 1.2) * 0.05;
      orbit.current.position.y = hover;
      // Depth drift towards and away from the camera.
      orbit.current.position.z = reduced ? 0 : Math.sin(time * 0.53 + 0.4) * 0.18;
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.37) * 0.012;
      orbit.current.scale.setScalar(breathe);
    }

    if (core.current) {
      const pulse = reduced ? 1 : 1 + Math.sin(time * 1.4) * 0.03;
      core.current.scale.setScalar(pulse);
      core.current.rotation.y -= step * 0.14;
      core.current.rotation.x = Math.sin(time * 0.45) * 0.06;
      core.current.position.y = reduced ? 0 : Math.sin(time * 0.85 - 0.6) * 0.05;
    }
  });

  return (
    <group ref={orbit}>
      {/* warm halo sitting behind the fusion core */}
      <sprite position={[0, 0, -0.9]} scale={[6.4, 6.4, 1]}>
        <spriteMaterial
          map={glow}
          color={accent}
          transparent
          opacity={dark ? 0.34 : 0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      <group ref={core}>
        <mesh>
          <icosahedronGeometry args={[1.42, 2]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.9} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[1.2, 1]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.5} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[1.28, 0]} />
          <meshBasicMaterial color={accent} transparent opacity={0.07} />
        </mesh>
        {points.slice(0, 26).map((point, index) => (
          <mesh key={`core-node-${index}`} position={point.clone().multiplyScalar(0.3)}>
            <sphereGeometry args={[0.026, 8, 8]} />
            <meshBasicMaterial color={accent} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>

      <mesh>
        <icosahedronGeometry args={[2.4, 2]} />
        <meshBasicMaterial color={muted} wireframe transparent opacity={dark ? 0.26 : 0.12} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[2.62, 1]} />
        <meshBasicMaterial color={muted} wireframe transparent opacity={dark ? 0.1 : 0.08} />
      </mesh>

      <lineSegments geometry={linkGeometry}>
        <lineBasicMaterial color={node} transparent opacity={dark ? 0.3 : 0.2} />
      </lineSegments>

      <primitive object={dots} />

      {points.map((point, index) => (
        <sprite key={`glow-${index}`} position={point} scale={[0.4, 0.4, 1]} material={nodeGlow} />
      ))}

      <mesh rotation={[Math.PI / 2.1, 0.16, 0]}>
        <torusGeometry args={[2.78, 0.009, 8, 200]} />
        <meshBasicMaterial color={accent} transparent opacity={dark ? 0.7 : 0.5} />
      </mesh>
      <mesh rotation={[Math.PI / 1.65, -0.5, 0.35]}>
        <torusGeometry args={[3.02, 0.007, 8, 200]} />
        <meshBasicMaterial color={accent} transparent opacity={dark ? 0.45 : 0.32} />
      </mesh>
      <mesh rotation={[Math.PI / 1.9, 0.7, -0.5]}>
        <torusGeometry args={[3.18, 0.005, 8, 200]} />
        <meshBasicMaterial color={muted} transparent opacity={dark ? 0.28 : 0.2} />
      </mesh>
    </group>
  );
}

export function FusionScene3D({ className = "" }: { className?: string }) {
  const { isDark } = useTheme();
  const accent = isDark ? "#ec8f45" : "#aa592f";
  const node = isDark ? "#f7f3ec" : "#0b0a09";
  const muted = isDark ? "#c3b7a8" : "#908779";
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  return (
    <div className={`h-full w-full ${className}`} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 7.6], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <FusionCore accent={accent} node={node} muted={muted} reduced={reduced} dark={isDark} />
      </Canvas>
    </div>
  );
}
