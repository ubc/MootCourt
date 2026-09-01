import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

/**
 * Night dressing for the courtroom, matching the university room on the
 * landing page: deep oak instead of orange pine, low cool ambient, and warm
 * practical fixtures doing the actual lighting.
 */

const oak = "#87613e";
const oakDark = "#593c26";
const brass = "#b8934f";
const leather = "#3d2530";

type Vec3 = [number, number, number];

// The GLB wood is a white-based textured material, so tinting the base colour
// multiplies the texture down into the landing page's oak family. Roughness and
// metalness are corrected at the same time — the export shipped rough 1 /
// metal 0.61 on the bench, which is why it never caught a highlight.
const MATERIAL_LOOK: Record<
  string,
  { color?: string; roughness?: number; metalness?: number }
> = {
  // Judge bench and counsel desks
  "Material.002": { color: "#966d45", roughness: 0.48, metalness: 0.06 },
  "Material.001": { color: "#8a6440", roughness: 0.5, metalness: 0.06 },
  _auto_: { color: "#7a583a", roughness: 0.58, metalness: 0.05 },
  // Wall panelling and joinery
  backwood: { color: "#79573a", roughness: 0.6, metalness: 0.02 },
  wood2: { color: "#87613e", roughness: 0.58, metalness: 0.02 },
  "Wood_Texture.001": { color: "#78563a", roughness: 0.58, metalness: 0.02 },
  door: { color: "#79573a", roughness: 0.66, metalness: 0.02 },
  "Wallpaper.001": { color: "#9d9587", roughness: 0.92, metalness: 0 },
  floor: { color: "#867d73", roughness: 0.86, metalness: 0 },
  ceiling_2: { color: "#96938c", roughness: 0.95, metalness: 0.05 },
  "M_12_High_Res_Red_Carpet_Textures.001": {
    color: "#584250",
    roughness: 0.96,
    metalness: 0,
  },
  // Trim, glazing and the coat of arms
  "_Metal_Aluminum_Anodized_1.001": {
    color: "#8d949a",
    roughness: 0.38,
    metalness: 0.6,
  },
  "Translucent_Glass_Blue.001": {
    color: "#14283e",
    roughness: 0.16,
    metalness: 0.1,
  },
  "Translucent_Glass_Gray": { color: "#243346", roughness: 0.2, metalness: 0.1 },
  FrontColor: { color: "#7f7f7f", roughness: 0.82, metalness: 0 },
};

// Retired dressing from the original set: the Canadian coat of arms on the back
// wall and the two flags flanking the gallery. The Allard sign replaces them.
// Matched by material rather than object name — the GLB re-exports have renamed
// the meshes before, and the material names have stayed put.
const HIDDEN_MATERIALS = new Set([
  "Coat_of_arm.001",
  "canada_stephen_harper_2012_02_16",
]);

/**
 * The courtroom GLBs stream in through their own loader, so the look pass has
 * to keep sweeping the scene until every material has shown up. Each material
 * is touched once and then remembered.
 */
export function CourtroomMaterialPass() {
  const scene = useThree((state) => state.scene);
  const seen = useRef(new Set<string>());
  const frame = useRef(0);
  const logged = useRef(false);

  useFrame(() => {
    // Sweeping every frame would be wasteful once the models have settled.
    frame.current += 1;
    if (frame.current % 12 !== 0) return;

    let visited = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!(mesh as any).isMesh && !(mesh as any).isSkinnedMesh) return;
      visited += 1;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      if (materials.some((material) => material && HIDDEN_MATERIALS.has(material.name))) {
        // A flag is split across cloth, pole and base meshes under one group,
        // so hide the group rather than leaving a bare pole standing.
        const parent = mesh.parent;
        const victim =
          parent && parent.type === "Group" && /Props/.test(parent.name) ? parent : mesh;
        victim.visible = false;
        return;
      }

      // Avatars cast; the room receives. Keeping the shadow casters down to the
      // people and the bench props keeps the shadow map affordable.
      if ((mesh as any).isSkinnedMesh) mesh.castShadow = true;
      else mesh.receiveShadow = true;

      materials.forEach((material) => {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard || seen.current.has(standard.uuid)) return;
        seen.current.add(standard.uuid);

        const look = MATERIAL_LOOK[standard.name];
        if (!look) return;
        if (look.color && standard.color) standard.color.set(look.color);
        if (look.roughness !== undefined) standard.roughness = look.roughness;
        if (look.metalness !== undefined) standard.metalness = look.metalness;
        standard.needsUpdate = true;
      });
    });

    if (!logged.current && visited > 0) {
      logged.current = true;
      console.log("[CourtroomNight] look pass swept", visited, "meshes");
    }
  });

  return null;
}


/**
 * UBC Allard sign on the back panelling, replacing the coat of arms. It sits
 * above the judges' heads so nothing occludes it, framed by a darker board and
 * washed by a pair of picture lights — the same treatment as the landing room.
 */
export function AllardWallSign() {
  const logo = useTexture("./textures/PALSOL-1.2b-Primary-UBC-Shield.png");

  useEffect(() => {
    const THREEAny = THREE as any;
    const texture = logo as THREE.Texture & { colorSpace?: string; encoding?: number };
    if ("colorSpace" in texture && THREEAny.SRGBColorSpace) {
      texture.colorSpace = THREEAny.SRGBColorSpace;
    } else if ("encoding" in texture) {
      texture.encoding = THREE.sRGBEncoding;
    }
    texture.needsUpdate = true;
  }, [logo]);

  // The back panelling sits at z = -11.48; everything here stacks in front of it.
  const y = 2.35;
  const signTarget = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(0, y, -11.35);
    return object;
  }, []);

  return (
    <group>
      <mesh position={[0, y, -11.45]}>
        <boxGeometry args={[6.1, 1.98, 0.08]} />
        <meshStandardMaterial color={oakDark} roughness={0.72} />
      </mesh>
      {[-2.75, -1.65, -0.55, 0.55, 1.65, 2.75].map((x) => (
        <mesh key={x} position={[x, y, -11.4]}>
          <boxGeometry args={[0.045, 1.98, 0.03]} />
          <meshStandardMaterial color="#3f2a1a" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, y, -11.38]}>
        <boxGeometry args={[5.2, 1.4, 0.1]} />
        <meshStandardMaterial color="#efeee9" roughness={0.58} />
      </mesh>
      <mesh position={[0, y, -11.32]}>
        <planeGeometry args={[4.44, 1.06]} />
        <meshStandardMaterial map={logo} transparent toneMapped={false} />
      </mesh>

      {/* Brass picture lights above the board */}
      {[-1.9, 1.9].map((x) => (
        <group key={x} position={[x, y + 1.16, -11.26]}>
          <mesh>
            <boxGeometry args={[0.66, 0.09, 0.16]} />
            <meshStandardMaterial color={brass} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.58, 0.12]} />
            <meshStandardMaterial
              color="#fff2d8"
              emissive="#ffbe78"
              emissiveIntensity={1.3}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      <primitive object={signTarget} />
      <spotLight
        position={[0, 4.25, -9.8]}
        target={signTarget}
        angle={Math.PI / 6.5}
        penumbra={0.8}
        intensity={5.2}
        color="#ffd6a4"
        distance={8}
        decay={1.4}
      />
    </group>
  );
}

function useTarget(position: Vec3) {
  return useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(...position);
    return object;
  }, [position[0], position[1], position[2]]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function CourtroomLighting() {
  const benchTarget = useTarget([0, -0.1, -2.7]);
  const rimTarget = useTarget([0, 0.1, -2.8]);
  const wallTargetLeft = useTarget([-4.6, 0.6, -11.4]);
  const wallTargetRight = useTarget([4.6, 0.6, -11.4]);
  const ceilingTargetFront = useTarget([0, -2.9, -5.5]);
  const ceilingTargetBack = useTarget([0, -2.9, -9.8]);

  return (
    <>
      <ambientLight intensity={0.19} color="#6d88ae" />
      <hemisphereLight
        intensity={0.62}
        color="#3b5b7d"
        groundColor="#241d16"
        position={[0, 5, 0]}
      />

      {/* House lights: two broad ceiling washes keep the gallery from going
          black behind the bench. */}
      <primitive object={ceilingTargetFront} />
      <spotLight
        position={[0, 4.45, -5.5]}
        target={ceilingTargetFront}
        angle={Math.PI / 3}
        penumbra={1}
        intensity={5}
        color="#ffd9ab"
        distance={15}
        decay={1.6}
      />
      <primitive object={ceilingTargetBack} />
      <spotLight
        position={[0, 4.45, -9.8]}
        target={ceilingTargetBack}
        angle={Math.PI / 3}
        penumbra={1}
        intensity={4.4}
        color="#ffd9ab"
        distance={15}
        decay={1.6}
      />

      <primitive object={benchTarget} />
      <spotLight // warm key on the judges, same colour as the landing fixtures
        position={[2.4, 2.8, 1.4]}
        target={benchTarget}
        angle={Math.PI / 6.5}
        penumbra={0.92}
        intensity={3.2}
        color="#ffd7a6"
        distance={14}
        decay={1.6}
        castShadow
        shadow-mapSize={[1536, 1536]}
        shadow-bias={-0.0015}
      />

      <primitive object={rimTarget} />
      <spotLight // cool rim from the gallery windows, separates the judges
        position={[-5.2, 3, 0.4]}
        target={rimTarget}
        angle={Math.PI / 4.4}
        penumbra={0.9}
        intensity={3}
        color="#7ea8d8"
        distance={16}
        decay={1.5}
      />

      {/* A single centre wash left the flanks black; one per side covers the
          full width of the panelling behind the bench. */}
      <primitive object={wallTargetLeft} />
      <spotLight
        position={[-3.6, 4.25, -8.4]}
        target={wallTargetLeft}
        angle={Math.PI / 3}
        penumbra={0.95}
        intensity={5}
        color="#f0c894"
        distance={11}
        decay={1.4}
      />
      <primitive object={wallTargetRight} />
      <spotLight
        position={[3.6, 4.25, -8.4]}
        target={wallTargetRight}
        angle={Math.PI / 3}
        penumbra={0.95}
        intensity={5}
        color="#f0c894"
        distance={11}
        decay={1.4}
      />

      <pointLight // soft warm bounce out of the well of the court
        position={[0, 0.6, 1.6]}
        intensity={1.4}
        color="#f4d4a8"
        distance={7}
        decay={2}
      />
    </>
  );
}

/** Brass reading lamp on the bench — the practical that sells the night look. */
function BenchLamp({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.075, 0.085, 0.025, 20]} />
        <meshStandardMaterial color={brass} metalness={0.82} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.13, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.24, 12]} />
        <meshStandardMaterial color={brass} metalness={0.82} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.27, 0]} rotation={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.115, 0.115, 0.12, 20, 1, true]} />
        <meshStandardMaterial
          color="#1f5136"
          metalness={0.35}
          roughness={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.215, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.11, 20]} />
        <meshStandardMaterial
          color="#fff2d8"
          emissive="#ffbe78"
          emissiveIntensity={1.2}
        />
      </mesh>
      <pointLight
        position={[0, 0.16, 0]}
        intensity={1.5}
        color="#ffc182"
        distance={2.4}
        decay={2}
      />
    </group>
  );
}

/**
 * Dressing that sits on the bench itself: a leather writing inlay, brass lamps,
 * papers and a gavel. Same idea as the landing room — small practical objects
 * give the surface scale and stop it reading as a bare wooden slab.
 */
export function JudgeBenchDressing() {
  const top = -0.28;

  return (
    <group>
      {/* Leather inlay along the writing surface */}
      <mesh position={[-0.3, top + 0.006, -1.82]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.6, 0.52]} />
        <meshStandardMaterial color={leather} roughness={0.72} metalness={0.04} />
      </mesh>
      <mesh position={[-0.3, top + 0.008, -1.82]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.001, 3]} />
        <meshStandardMaterial color={brass} />
      </mesh>
      {/* Brass edge banding catches the key light along the front lip */}
      <mesh position={[-0.3, top + 0.004, -1.55]}>
        <boxGeometry args={[6.8, 0.012, 0.03]} />
        <meshStandardMaterial color={brass} metalness={0.85} roughness={0.3} />
      </mesh>

      <BenchLamp position={[1.72, top + 0.012, -1.86]} />
      <BenchLamp position={[-2.05, top + 0.012, -1.86]} />

      {/* Papers in front of the centre judge */}
      <mesh position={[-0.16, top + 0.02, -1.8]} rotation={[-Math.PI / 2, 0.14, 0]} castShadow>
        <boxGeometry args={[0.34, 0.24, 0.02]} />
        <meshStandardMaterial color="#e6e0d2" roughness={0.92} />
      </mesh>
      <mesh position={[0.62, top + 0.018, -1.83]} rotation={[-Math.PI / 2, -0.2, 0]} castShadow>
        <boxGeometry args={[0.3, 0.22, 0.016]} />
        <meshStandardMaterial color="#ddd6c6" roughness={0.92} />
      </mesh>

      {/* Gavel and sound block */}
      <mesh position={[0.98, top + 0.022, -1.76]} castShadow>
        <cylinderGeometry args={[0.085, 0.095, 0.04, 18]} />
        <meshStandardMaterial color={oakDark} roughness={0.55} />
      </mesh>
      <group position={[0.98, top + 0.07, -1.76]} rotation={[0, 0.5, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.13, 14]} />
          <meshStandardMaterial color={oak} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.02, 0.14]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.2, 10]} />
          <meshStandardMaterial color={oak} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

export default function CourtroomNight() {
  return (
    <>
      <CourtroomMaterialPass />
      <CourtroomLighting />
      <JudgeBenchDressing />
      <Suspense fallback={null}>
        <AllardWallSign />
      </Suspense>
    </>
  );
}
