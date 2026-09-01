import React, { useEffect } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

const warmWhite = "#f1f0eb";
const oak = "#9a704b";
const nightGlass = "#142b47";

function CeilingLight({ x }: { x: number }) {
  return (
    <group position={[x, 4.32, -1.8]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <boxGeometry args={[2.2, 0.82, 0.08]} />
        <meshStandardMaterial color="#f8ead1" emissive="#ffd69d" emissiveIntensity={1.1} />
      </mesh>
      <rectAreaLight
        color="#fffaf0"
        intensity={2.1}
        width={2.2}
        height={0.82}
        rotation={[-Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

function SeminarChair({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.72, 0.12, 0.72]} />
        <meshStandardMaterial color="#27384b" roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.12, 0.3]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.72, 0.9, 0.12]} />
        <meshStandardMaterial color="#27384b" roughness={0.72} />
      </mesh>
      {[-0.27, 0.27].map((x) =>
        [-0.25, 0.25].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.24, z]}>
            <cylinderGeometry args={[0.025, 0.025, 0.55, 10]} />
            <meshStandardMaterial color="#70777b" metalness={0.55} roughness={0.35} />
          </mesh>
        )),
      )}
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

  return (
    <group>
      {/* Architectural shell */}
      <mesh position={[0, -3.12, -0.45]} receiveShadow>
        <boxGeometry args={[16, 0.24, 11]} />
        <meshStandardMaterial color="#b7b0a5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.65, -5.72]} receiveShadow>
        <boxGeometry args={[16, 7.55, 0.25]} />
        <meshStandardMaterial color={warmWhite} roughness={0.94} />
      </mesh>
      <mesh position={[-7.88, 0.65, -0.45]} receiveShadow>
        <boxGeometry args={[0.25, 7.55, 11]} />
        <meshStandardMaterial color={warmWhite} roughness={0.94} />
      </mesh>
      <mesh position={[0, 4.46, -0.45]}>
        <boxGeometry args={[16, 0.18, 11]} />
        <meshStandardMaterial color="#f7f7f3" roughness={0.98} />
      </mesh>

      {/* Wood feature panel and naturally mounted UBC/Allard wall sign */}
      <mesh position={[-0.65, 0.78, -5.54]} receiveShadow>
        <boxGeometry args={[4.85, 4.15, 0.16]} />
        <meshStandardMaterial color={oak} roughness={0.72} />
      </mesh>
      {[-2.85, -2.3, -1.75, -1.2, -0.65, -0.1, 0.45, 1].map((x) => (
        <mesh key={x} position={[x, 0.78, -5.43]}>
          <boxGeometry args={[0.035, 4.15, 0.035]} />
          <meshStandardMaterial color="#6f4b31" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[-0.65, 1.35, -5.32]} castShadow>
        <boxGeometry args={[3.72, 1.08, 0.13]} />
        <meshStandardMaterial color="#ffffff" roughness={0.58} />
      </mesh>
      <mesh position={[-0.65, 1.35, -5.245]}>
        <planeGeometry args={[3.42, 0.815]} />
        <meshStandardMaterial map={ubcLogo} transparent toneMapped={false} />
      </mesh>

      {/* Floor-to-ceiling window wall across the left bay */}
      <group position={[-5.05, 0.55, -5.49]}>
        <mesh>
          <planeGeometry args={[5.15, 5.45]} />
          <meshStandardMaterial
            color={nightGlass}
            emissive="#0b1c33"
            emissiveIntensity={0.35}
            roughness={0.16}
            metalness={0.04}
          />
        </mesh>
        {/* Soft, abstract campus silhouettes keep the view believable but quiet. */}
        <mesh position={[-1.65, -1.58, 0.025]}>
          <planeGeometry args={[1.05, 1.15]} />
          <meshStandardMaterial color="#162f32" roughness={0.9} />
        </mesh>
        <mesh position={[0.2, -1.78, 0.025]}>
          <planeGeometry args={[1.5, 0.75]} />
          <meshStandardMaterial color="#1a3436" roughness={0.9} />
        </mesh>
        {[-2.58, -0.86, 0.86, 2.58].map((x) => (
          <mesh key={x} position={[x, 0, 0.065]}>
            <boxGeometry args={[0.085, 5.55, 0.085]} />
            <meshStandardMaterial color="#d9dfe1" metalness={0.48} roughness={0.34} />
          </mesh>
        ))}
        {[-2.74, 0, 2.74].map((y) => (
          <mesh key={y} position={[0, y, 0.07]}>
            <boxGeometry args={[5.25, 0.085, 0.085]} />
            <meshStandardMaterial color="#d9dfe1" metalness={0.48} roughness={0.34} />
          </mesh>
        ))}
      </group>

      {/* Glazing continues around the actual left wall to give the room depth. */}
      {[-3.85, -1.25, 1.35].map((z) => (
        <group key={z} position={[-7.74, 0.55, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <planeGeometry args={[2.35, 5.45]} />
            <meshStandardMaterial
              color={nightGlass}
              emissive="#0b1c33"
              emissiveIntensity={0.35}
              roughness={0.15}
            />
          </mesh>
          {[-1.2, 1.2].map((y) => (
            <mesh key={y} position={[0, y, 0.06]}>
              <boxGeometry args={[2.42, 0.085, 0.085]} />
              <meshStandardMaterial color="#d9dfe1" metalness={0.48} roughness={0.34} />
            </mesh>
          ))}
          {[-1.2, 1.2].map((x) => (
            <mesh key={x} position={[x, 0, 0.06]}>
              <boxGeometry args={[0.085, 5.55, 0.085]} />
              <meshStandardMaterial color="#d9dfe1" metalness={0.48} roughness={0.34} />
            </mesh>
          ))}
        </group>
      ))}

      {/* A few warm campus windows beyond the glass establish the night setting. */}
      {[
        [-7.69, -0.15, -4.4],
        [-7.69, 1.25, -3.2],
        [-7.69, -1.05, -1.7],
        [-7.69, 0.75, 0.1],
      ].map(([x, y, z], index) => (
        <mesh key={index} position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.42, 0.56]} />
          <meshBasicMaterial color="#e9b86f" toneMapped={false} />
        </mesh>
      ))}

      {/* Rug and seminar grouping place the avatar within the room's depth. */}
      <mesh position={[-1.4, -2.965, 0.15]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.7, 4.5]} />
        <meshStandardMaterial color="#243e58" roughness={0.96} />
      </mesh>
      <mesh position={[-4.45, -2.15, -2.55]} castShadow receiveShadow>
        <boxGeometry args={[2.85, 0.14, 1.2]} />
        <meshStandardMaterial color="#b1845c" roughness={0.68} />
      </mesh>
      {[-5.45, -3.45].map((x) =>
        [-2.95, -2.15].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, -2.57, z]}>
            <cylinderGeometry args={[0.045, 0.045, 0.82, 12]} />
            <meshStandardMaterial color="#606a70" metalness={0.62} roughness={0.35} />
          </mesh>
        )),
      )}
      <SeminarChair position={[-5.25, -3, -3.75]} rotation={0.15} />
      <SeminarChair position={[-3.65, -3, -3.75]} rotation={-0.12} />

      {/* Plant, books and pottery add university-room character without visual noise. */}
      <group position={[2.85, -2.05, -4.55]}>
        <mesh position={[0, -0.35, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.25, 0.65, 18]} />
          <meshStandardMaterial color="#c6a16d" roughness={0.82} />
        </mesh>
        {[[-0.2, 0.28, 0], [0.2, 0.5, 0.05], [0, 0.82, -0.08], [-0.12, 1.05, 0.05]].map(
          ([x, y, z], index) => (
            <mesh key={index} position={[x, y, z]} rotation={[0, 0, x * 1.5]} castShadow>
              <sphereGeometry args={[0.28, 12, 8]} />
              <meshStandardMaterial color={index % 2 ? "#365c43" : "#477451"} roughness={0.9} />
            </mesh>
          ),
        )}
      </group>
      {[0, 0.13, 0.26].map((y, index) => (
        <mesh key={y} position={[1.65, -1.82 + y, -4.61]} castShadow>
          <boxGeometry args={[0.72 - index * 0.05, 0.1, 0.34]} />
          <meshStandardMaterial color={["#123f68", "#d2aa55", "#8c3c3c"][index]} roughness={0.8} />
        </mesh>
      ))}

      {/* Low, uncluttered seminar-room furniture */}
      <mesh position={[2.25, -2.48, -4.95]} castShadow receiveShadow>
        <boxGeometry args={[2.35, 0.95, 0.58]} />
        <meshStandardMaterial color="#8b6545" roughness={0.76} />
      </mesh>
      <mesh position={[2.25, -1.96, -4.94]}>
        <boxGeometry args={[2.45, 0.09, 0.68]} />
        <meshStandardMaterial color="#d5c2a8" roughness={0.72} />
      </mesh>
      <mesh position={[-4.7, -2.25, -2.4]} castShadow>
        <boxGeometry args={[2.2, 0.12, 1.05]} />
        <meshStandardMaterial color="#b58a61" roughness={0.7} />
      </mesh>
      {[-5.45, -3.95].map((x) => (
        <mesh key={x} position={[x, -2.68, -2.4]}>
          <cylinderGeometry args={[0.045, 0.045, 0.82, 12]} />
          <meshStandardMaterial color="#6b7377" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      <SeminarChair position={[-5.4, -3, -3.45]} rotation={0.18} />

      <CeilingLight x={-4.4} />
      <CeilingLight x={-0.7} />
      <CeilingLight x={3} />
      <rectAreaLight
        position={[-5.1, 0.8, -5.0]}
        rotation={[0, 0, 0]}
        color="#d8efff"
        intensity={2.2}
        width={3.4}
        height={4.4}
      />
    </group>
  );
}
