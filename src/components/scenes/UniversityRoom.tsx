import React, { useEffect, useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

// Night palette. Albedos stay muted so the pools of light from the ceiling
// fixtures do the work instead of the surfaces reading as daylit paper.
const wallPaint = "#bdb8ad";
const wallTrim = "#8d8779";
const ceilingPaint = "#a8a59d";
const floorStone = "#66615a";
const oak = "#87613e";
const oakDark = "#593c26";
const nightGlass = "#0a1a2e";
const upholstery = "#22334a";
const metal = "#6b7176";

type Vec3 = [number, number, number];

/**
 * Recessed ceiling panel: an emissive housing so the fixture reads as "on",
 * plus a real downward spot so it actually pools light on the floor.
 * rectAreaLight is deliberately avoided here — it needs
 * RectAreaLightUniformsLib.init() to contribute anything at all.
 */
function CeilingLight({
  x,
  z = -1.8,
  intensity = 4.6,
  castShadow = false,
}: {
  x: number;
  z?: number;
  intensity?: number;
  castShadow?: boolean;
}) {
  const target = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(x, -3, z);
    return object;
  }, [x, z]);

  return (
    <>
      <group position={[x, 4.28, z]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[2.34, 0.98, 0.1]} />
          <meshStandardMaterial color="#8d949a" metalness={0.45} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[2.1, 0.76, 0.06]} />
          <meshStandardMaterial
            color="#fff3dd"
            emissive="#ffd49a"
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
      </group>
      <primitive object={target} />
      <spotLight
        position={[x, 4.2, z]}
        target={target}
        angle={Math.PI / 3.1}
        penumbra={1}
        intensity={intensity}
        color="#ffd9ab"
        distance={12}
        decay={2}
        castShadow={castShadow}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0016}
      />
    </>
  );
}

function WallSconce({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.12, 0.6, 0.22]} />
        <meshStandardMaterial color="#7c8288" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0.075, 0, 0]}>
        <boxGeometry args={[0.03, 0.46, 0.16]} />
        <meshStandardMaterial
          color="#fff0d4"
          emissive="#ffbf7a"
          emissiveIntensity={1.7}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        position={[0.35, 0.1, 0]}
        intensity={2.6}
        color="#ffc98d"
        distance={4.4}
        decay={2}
      />
    </group>
  );
}

function SeminarChair({
  position,
  rotation = 0,
}: {
  position: Vec3;
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.12, 0.72]} />
        <meshStandardMaterial color={upholstery} roughness={0.78} />
      </mesh>
      <mesh position={[0, 1.12, 0.3]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.72, 0.9, 0.12]} />
        <meshStandardMaterial color={upholstery} roughness={0.78} />
      </mesh>
      {[-0.27, 0.27].map((x) =>
        [-0.25, 0.25].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.24, z]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 0.55, 10]} />
            <meshStandardMaterial color={metal} metalness={0.55} roughness={0.4} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Moot-court lectern that sits beside the avatar to give her a mid-ground anchor. */
function Lectern({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.98, 0.1, 0.72]} />
        <meshStandardMaterial color={oakDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.74, 1.05, 0.5]} />
        <meshStandardMaterial color={oak} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[0.92, 0.12, 0.64]} />
        <meshStandardMaterial color={oakDark} roughness={0.66} />
      </mesh>
      <mesh position={[0, 1.29, 0.02]} rotation={[-0.28, 0, 0]} castShadow>
        <boxGeometry args={[0.86, 0.05, 0.56]} />
        <meshStandardMaterial color={oak} roughness={0.6} />
      </mesh>
      {/* A small stack of papers catches the ceiling light and reads as "in use". */}
      <mesh position={[0, 1.33, 0.03]} rotation={[-0.28, 0.06, 0]}>
        <boxGeometry args={[0.34, 0.02, 0.42]} />
        <meshStandardMaterial color="#e8e3d6" roughness={0.9} />
      </mesh>
    </group>
  );
}

function BookRow({
  position,
  count = 9,
  seed = 0,
}: {
  position: Vec3;
  count?: number;
  seed?: number;
}) {
  const palette = ["#123f68", "#8c3c3c", "#d2aa55", "#2f5b45", "#5b3f6b", "#a35a2c"];
  return (
    <group position={position}>
      {Array.from({ length: count }).map((_, index) => {
        const height = 0.3 + ((index * 7 + seed * 3) % 5) * 0.035;
        return (
          <mesh
            key={index}
            position={[index * 0.075, height / 2, 0]}
            rotation={[0, 0, index === count - 2 ? 0.22 : 0]}
            castShadow
          >
            <boxGeometry args={[0.06, height, 0.24]} />
            <meshStandardMaterial
              color={palette[(index + seed) % palette.length]}
              roughness={0.85}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function UniversityRoom() {
  const ubcLogo = useTexture("./textures/PALSOL-1.2b-Primary-UBC-Shield.png");

  useEffect(() => {
    const THREEAny = THREE as any;
    const texture = ubcLogo as THREE.Texture & { colorSpace?: string; encoding?: number };
    if ("colorSpace" in texture && THREEAny.SRGBColorSpace) {
      texture.colorSpace = THREEAny.SRGBColorSpace;
    } else if ("encoding" in texture) {
      texture.encoding = THREE.sRGBEncoding;
    }
    texture.needsUpdate = true;
  }, [ubcLogo]);

  // Warm accent aimed at the Allard sign so the back wall has a focal point.
  const signTarget = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(-0.65, 1.35, -5.3);
    return object;
  }, []);

  return (
    <group>
      {/* ---------------- Architectural shell ---------------- */}
      <mesh position={[0, -3.12, -0.45]} receiveShadow>
        <boxGeometry args={[16, 0.24, 12]} />
        <meshStandardMaterial color={floorStone} roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.65, -5.72]} receiveShadow>
        <boxGeometry args={[16, 7.55, 0.25]} />
        <meshStandardMaterial color={wallPaint} roughness={0.95} />
      </mesh>
      <mesh position={[-7.88, 0.65, -0.45]} receiveShadow>
        <boxGeometry args={[0.25, 7.55, 12]} />
        <meshStandardMaterial color={wallPaint} roughness={0.95} />
      </mesh>
      {/* The right wall was missing, which left a bright void in frame. */}
      <mesh position={[7.88, 0.65, -0.45]} receiveShadow>
        <boxGeometry args={[0.25, 7.55, 12]} />
        <meshStandardMaterial color={wallPaint} roughness={0.95} />
      </mesh>
      <mesh position={[0, 4.46, -0.45]} receiveShadow>
        <boxGeometry args={[16, 0.18, 12]} />
        <meshStandardMaterial color={ceilingPaint} roughness={0.98} />
      </mesh>

      {/* Baseboard and a ceiling soffit line give the shell some edge definition. */}
      <mesh position={[0, -2.87, -5.57]}>
        <boxGeometry args={[15.8, 0.26, 0.06]} />
        <meshStandardMaterial color={wallTrim} roughness={0.85} />
      </mesh>
      <mesh position={[7.73, -2.87, -0.45]}>
        <boxGeometry args={[0.06, 0.26, 11.8]} />
        <meshStandardMaterial color={wallTrim} roughness={0.85} />
      </mesh>
      <mesh position={[0, 3.92, -5.55]}>
        <boxGeometry args={[15.8, 0.1, 0.1]} />
        <meshStandardMaterial color={wallTrim} roughness={0.8} />
      </mesh>

      {/* ---------------- Wood feature panel + Allard wall sign ---------------- */}
      <mesh position={[-0.65, 0.78, -5.54]} receiveShadow>
        <boxGeometry args={[4.85, 4.15, 0.16]} />
        <meshStandardMaterial color={oak} roughness={0.74} />
      </mesh>
      {[-2.85, -2.3, -1.75, -1.2, -0.65, -0.1, 0.45, 1].map((x) => (
        <mesh key={x} position={[x, 0.78, -5.43]}>
          <boxGeometry args={[0.035, 4.15, 0.035]} />
          <meshStandardMaterial color={oakDark} roughness={0.82} />
        </mesh>
      ))}
      <mesh position={[-0.65, 1.35, -5.32]} castShadow>
        <boxGeometry args={[3.72, 1.08, 0.13]} />
        <meshStandardMaterial color="#efeee9" roughness={0.6} />
      </mesh>
      <mesh position={[-0.65, 1.35, -5.245]}>
        <planeGeometry args={[3.42, 0.815]} />
        <meshStandardMaterial map={ubcLogo} transparent toneMapped={false} />
      </mesh>
      <primitive object={signTarget} />
      <spotLight
        position={[-0.65, 3.7, -3.9]}
        target={signTarget}
        angle={Math.PI / 6}
        penumbra={0.85}
        intensity={3.4}
        color="#ffcf95"
        distance={7.5}
        decay={2}
      />

      {/* ---------------- Night glazing ---------------- */}
      <group position={[-5.05, 0.55, -5.49]}>
        <mesh>
          <planeGeometry args={[5.15, 5.45]} />
          <meshStandardMaterial
            color={nightGlass}
            emissive="#071426"
            emissiveIntensity={0.5}
            roughness={0.14}
            metalness={0.06}
          />
        </mesh>
        {/* Soft, abstract campus silhouettes keep the view believable but quiet. */}
        <mesh position={[-1.65, -1.58, 0.025]}>
          <planeGeometry args={[1.05, 1.15]} />
          <meshBasicMaterial color="#0c1c22" toneMapped={false} />
        </mesh>
        <mesh position={[0.2, -1.78, 0.025]}>
          <planeGeometry args={[1.5, 0.75]} />
          <meshBasicMaterial color="#0e2126" toneMapped={false} />
        </mesh>
        {[
          [-1.9, -1.3],
          [-1.45, -1.72],
          [0.0, -1.85],
          [0.62, -1.62],
        ].map(([x, y], index) => (
          <mesh key={index} position={[x, y, 0.04]}>
            <planeGeometry args={[0.11, 0.15]} />
            <meshBasicMaterial color="#e0aa63" toneMapped={false} />
          </mesh>
        ))}
        {[-2.58, -0.86, 0.86, 2.58].map((x) => (
          <mesh key={x} position={[x, 0, 0.065]}>
            <boxGeometry args={[0.085, 5.55, 0.085]} />
            <meshStandardMaterial color="#9aa4a8" metalness={0.5} roughness={0.38} />
          </mesh>
        ))}
        {[-2.74, 0, 2.74].map((y) => (
          <mesh key={y} position={[0, y, 0.07]}>
            <boxGeometry args={[5.25, 0.085, 0.085]} />
            <meshStandardMaterial color="#9aa4a8" metalness={0.5} roughness={0.38} />
          </mesh>
        ))}
      </group>

      {/* Glazing continues around the left wall to give the room depth. */}
      {[-3.85, -1.25, 1.35].map((z) => (
        <group key={z} position={[-7.74, 0.55, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <planeGeometry args={[2.35, 5.45]} />
            <meshStandardMaterial
              color={nightGlass}
              emissive="#071426"
              emissiveIntensity={0.5}
              roughness={0.15}
            />
          </mesh>
          {[-1.2, 1.2].map((y) => (
            <mesh key={y} position={[0, y, 0.06]}>
              <boxGeometry args={[2.42, 0.085, 0.085]} />
              <meshStandardMaterial color="#9aa4a8" metalness={0.5} roughness={0.38} />
            </mesh>
          ))}
          {[-1.2, 1.2].map((x) => (
            <mesh key={x} position={[x, 0, 0.06]}>
              <boxGeometry args={[0.085, 5.55, 0.085]} />
              <meshStandardMaterial color="#9aa4a8" metalness={0.5} roughness={0.38} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Warm campus windows beyond the glass establish the night setting. */}
      {[
        [-7.69, -0.15, -4.4],
        [-7.69, 1.25, -3.2],
        [-7.69, -1.05, -1.7],
        [-7.69, 0.75, 0.1],
        [-7.69, -0.55, 1.6],
      ].map(([x, y, z], index) => (
        <mesh key={index} position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.42, 0.56]} />
          <meshBasicMaterial color="#d9a961" toneMapped={false} />
        </mesh>
      ))}

      {/* ---------------- Floor covering ---------------- */}
      {/* The rug now reaches forward under the avatar so she is standing on
          something rather than hovering in front of the furniture. */}
      <mesh position={[-1.2, -2.985, 0.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8.4, 7.4]} />
        <meshStandardMaterial color="#1e3450" roughness={0.97} />
      </mesh>
      <mesh position={[-1.2, -2.978, 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.55, 3.72, 4, 1]} />
        <meshStandardMaterial color="#2f4a6b" roughness={0.95} />
      </mesh>

      {/* ---------------- Mid-ground: lectern beside the avatar ---------------- */}
      <Lectern position={[2.15, -3, 1.35]} rotation={-0.42} />

      {/* ---------------- Seminar grouping ---------------- */}
      <mesh position={[-4.45, -2.15, -2.35]} castShadow receiveShadow>
        <boxGeometry args={[3.1, 0.14, 1.35]} />
        <meshStandardMaterial color="#a97f57" roughness={0.7} />
      </mesh>
      {[-5.6, -3.3].map((x) =>
        [-2.85, -1.85].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, -2.6, z]} castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.85, 12]} />
            <meshStandardMaterial color={metal} metalness={0.6} roughness={0.38} />
          </mesh>
        )),
      )}
      {/* Open laptop and a water glass — small signs the room is in use. */}
      <mesh position={[-4.9, -2.05, -2.3]} rotation={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.52, 0.03, 0.36]} />
        <meshStandardMaterial color="#3b4147" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[-4.78, -1.88, -2.48]} rotation={[-1.15, 0.35, 0]}>
        <boxGeometry args={[0.52, 0.34, 0.02]} />
        <meshStandardMaterial
          color="#20303f"
          emissive="#5d86b5"
          emissiveIntensity={0.75}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[-3.85, -1.95, -2.1]}>
        <cylinderGeometry args={[0.07, 0.06, 0.22, 14]} />
        <meshStandardMaterial
          color="#cfe3ef"
          transparent
          opacity={0.45}
          roughness={0.05}
          metalness={0.1}
        />
      </mesh>
      <SeminarChair position={[-5.35, -3, -3.55]} rotation={0.16} />
      <SeminarChair position={[-3.7, -3, -3.6]} rotation={-0.12} />
      {/* One chair pulled out into the mid-ground breaks the empty floor gap. */}
      <SeminarChair position={[-4.35, -3, -0.55]} rotation={2.5} />

      {/* ---------------- Back-wall credenza, plant, shelving ---------------- */}
      <mesh position={[2.6, -2.48, -5.05]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 1.05, 0.62]} />
        <meshStandardMaterial color="#7d5c40" roughness={0.78} />
      </mesh>
      <mesh position={[2.6, -1.93, -5.04]} castShadow>
        <boxGeometry args={[2.72, 0.09, 0.72]} />
        <meshStandardMaterial color="#c2ae94" roughness={0.72} />
      </mesh>
      {[1.75, 3.45].map((x) => (
        <mesh key={x} position={[x, -2.48, -4.73]}>
          <boxGeometry args={[0.9, 0.72, 0.03]} />
          <meshStandardMaterial color={oakDark} roughness={0.7} />
        </mesh>
      ))}
      <BookRow position={[1.95, -1.88, -5.02]} count={8} seed={1} />
      <BookRow position={[3.15, -1.88, -5.02]} count={6} seed={4} />

      <group position={[4.85, -2.05, -4.75]}>
        <mesh position={[0, -0.62, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.38, 0.28, 0.78, 18]} />
          <meshStandardMaterial color="#a98757" roughness={0.85} />
        </mesh>
        {[
          [-0.22, 0.28, 0],
          [0.24, 0.52, 0.06],
          [0, 0.86, -0.1],
          [-0.14, 1.12, 0.06],
        ].map(([x, y, z], index) => (
          <mesh key={index} position={[x, y, z]} rotation={[0, 0, x * 1.5]} castShadow>
            <sphereGeometry args={[0.3, 12, 8]} />
            <meshStandardMaterial color={index % 2 ? "#2c4b37" : "#3a6143" } roughness={0.92} />
          </mesh>
        ))}
      </group>

      {/* Framed plaques and a pinboard so the walls are not blank. */}
      {[
        [4.6, 0.9, -5.56, 0.85, 1.1],
        [5.75, 0.9, -5.56, 0.85, 1.1],
        [5.18, -0.45, -5.56, 2.0, 0.9],
      ].map(([x, y, z, w, h], index) => (
        <group key={index} position={[x, y, z]}>
          <mesh castShadow>
            <boxGeometry args={[w, h, 0.06]} />
            <meshStandardMaterial color={oakDark} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <planeGeometry args={[w - 0.12, h - 0.12]} />
            <meshStandardMaterial
              color={index === 2 ? "#8f9a7d" : "#cfd6dc"}
              roughness={0.9}
            />
          </mesh>
        </group>
      ))}

      {/* Door on the right wall reads as a way out of the room. */}
      <group position={[7.72, -1.55, -2.6]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh>
          <boxGeometry args={[1.35, 2.9, 0.08]} />
          <meshStandardMaterial color={oak} roughness={0.74} />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[1.5, 3.05, 0.06]} />
          <meshStandardMaterial color={wallTrim} roughness={0.8} />
        </mesh>
        <mesh position={[0.5, -0.1, -0.07]}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshStandardMaterial color="#b8a06a" metalness={0.75} roughness={0.3} />
        </mesh>
      </group>

      <WallSconce position={[7.6, 0.9, -4.3]} />
      <WallSconce position={[7.6, 0.9, -0.9]} />

      {/* ---------------- Fixtures ---------------- */}
      <CeilingLight x={-4.4} z={-2.2} intensity={4.4} />
      <CeilingLight x={-0.7} z={-2.2} intensity={4.4} castShadow />
      <CeilingLight x={3} z={-2.2} intensity={4.0} />
      <CeilingLight x={-2.6} z={1.6} intensity={3.6} />
      <CeilingLight x={1.2} z={1.6} intensity={3.6} />
    </group>
  );
}
