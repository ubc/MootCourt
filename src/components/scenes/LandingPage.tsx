// import * as THREE from 'three'
// import React, {useRef, useState } from 'react'
// import { Canvas, useFrame, ThreeElements } from '@react-three/fiber'
// import {Html, PerspectiveCamera, useTexture} from "@react-three/drei"
// import LandingPageJudgeAvatar from '../avatars/LandingPageJudgeAvatar'
// import LandingPageMenu from '../ui/LandingPageMenu'
// import { Vector3 } from 'three'; // Import Vector3 from three.js

// import { PlaneGeometry, MeshBasicMaterial, Mesh, TextureLoader } from 'three';

// let appPaused = false

// const lou = []

// const cameraPosition = new Vector3(0, 0, 5); // [x, y, z] coordinates of the camera
// const cameraFov = 75; // Field of view in degrees

// export default function LandingPage({updateAppState, updateConfig, config}) {
//     return (<Canvas
//                 camera={{
//                     position: cameraPosition,
//                     fov: cameraFov,
//                 }}>
//                 <ambientLight intensity={0.3}/>

//                 <rectAreaLight
//                         intensity={0.3}
//                         position={[0, 0, 10]}
//                         width={30}
//                         height={20}
//                         color="white"
//                     />

//                 <pointLight
//                     position={[-6, 4, -2]} // Adjust the position of the light
//                     intensity={2} // Adjust the intensity of the light (default is 1)
//                     color="white" // Adjust the color of the light
//                     distance={12} // Maximum distance the light will shine
//                     decay={5}
//                 />
//                 <pointLight
//                     position={[0, 4, -2]} // Adjust the position of the light
//                     intensity={1.5} // Adjust the intensity of the light (default is 1)
//                     color="white" // Adjust the color of the light
//                     distance={15} // Maximum distance the light will shine
//                     decay={3}
//                 />

//                 <spotLight
//                     position={[0, 5, 10]} // Adjust the position of the light
//                     angle={Math.PI / 8}
//                     penumbra={1} // Smoothness of the spotlight edge
//                     intensity={1.5} // Adjust the intensity of the light (default is 1)
//                     color="white" // Adjust the color of the light
//                     distance={100} // Maximum distance the light will shine

//                 />

//                 <LandingPageJudgeAvatar listOfUtterances={lou}></LandingPageJudgeAvatar>
//                 {/* <Model modelUrl="./models/courtroom_props_updated.glb"
//                     pos={[0, -3, 3]}
//                     rot={[0, 0, 0]}
//                     sca={[0.06, 0.06, 0.06]} />
//                 <Model modelUrl="./models/courtroom_walls_updated.glb"
//                     pos={[0, -3, 3.5]}
//                     rot={[0, 0, 0]}
//                     sca={[0.06, 0.06, 0.06]} />
// <Model modelUrl="./models/courtroom_tables_updated_landing.glb"
//     pos={[0, -3.25, 4.5]}
//     rot={[0, 0, 0]}
//     sca={[0.055, 0.055, 0.055]} /> */}

//         <Html fullscreen>
//             <LandingPageMenu updateAppState={updateAppState} updateConfig={updateConfig} config={config} ></LandingPageMenu>
//         </Html>
//         </Canvas>
//     );
// }

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html } from "@react-three/drei";
import LandingPageJudgeAvatar from "../avatars/LandingPageJudgeAvatar";
import LandingPageMenu from "../ui/LandingPageMenu";
import UniversityRoom from "./UniversityRoom";
import { Vector3 } from "three";
import * as THREE from "three";

const lou = [];

const cameraPosition = new Vector3(0, 0, 5);
const cameraFov = 75;

// The avatar stands here inside ResponsiveLandingAvatar (see
// LandingPageJudgeAvatar), so her key light, rim light and contact shadow all
// live in the same group and stay attached when the group shifts on narrow
// screens.
const avatarLocalPosition: [number, number, number] = [-1.5, -3, 2.5];

/**
 * The judge GLB ships without castShadow set on its meshes, and it streams in
 * through Suspense, so the flag has to be applied once the meshes actually
 * exist. Without this she takes light but drops no shadow, which is most of
 * why she read as pasted on top of the room.
 */
function useCastShadows() {
  const group = useRef<THREE.Group>(null);
  const done = useRef(false);

  useFrame(() => {
    if (done.current || !group.current) return;
    let meshes = 0;
    group.current.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!(mesh as any).isMesh && !(mesh as any).isSkinnedMesh) return;
      meshes += 1;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    if (meshes > 0) done.current = true;
  });

  return group;
}

function ResponsiveLandingAvatar() {
  const width = useThree((state) => state.size.width);
  const narrowScreenOffset = width < 600 ? 1.05 : 0;
  const avatarGroup = useCastShadows();

  const [ax, , az] = avatarLocalPosition;
  // Real Object3Ds rather than refs: a spotLight reads target on the first
  // render, and a ref is still null at that point.
  const keyTarget = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(ax, -1.5, az);
    return object;
  }, [ax, az]);
  const rimTarget = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(ax, -1.2, az);
    return object;
  }, [ax, az]);

  return (
    <group position={[narrowScreenOffset, 0, 0]}>
      <group ref={avatarGroup}>
        <LandingPageJudgeAvatar listOfUtterances={lou} />
      </group>

      {/* Soft contact shadow sits just above the rug — the previous pass put it
          below the rug plane, so it was never visible. */}
      <ContactShadows
        position={[ax, -2.965, az]}
        opacity={0.62}
        scale={5.2}
        blur={2.6}
        far={4}
        resolution={1024}
        color="#050a12"
      />

      <primitive object={keyTarget} />
      <primitive object={rimTarget} />

      <spotLight // warm key, consistent with the ceiling fixtures
        position={[ax + 3.1, 2.5, az + 2.9]}
        target={keyTarget}
        angle={Math.PI / 7}
        penumbra={0.92}
        intensity={2.4}
        color="#ffd7a6"
        distance={16}
        decay={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0012}
      />
      <spotLight // cool rim from the window wall, separates her from the room
        position={[ax - 5, 2.4, az - 4.2]}
        target={rimTarget}
        angle={Math.PI / 6}
        penumbra={0.9}
        intensity={2.8}
        color="#7ea8d8"
        distance={18}
        decay={1.5}
      />
      <pointLight // low bounce off the rug so her legs do not sink into black
        position={[ax + 0.4, -2.2, az + 1.4]}
        intensity={1.1}
        color="#4d6b8f"
        distance={5}
        decay={2}
      />
    </group>
  );
}

export default function LandingPage({
  setPaused,
  updateAppState,
  updateConfig,
  config,
}) {
  // Force unpaused as default
  setPaused(false);
  return (
    <Canvas
      camera={{ position: cameraPosition, fov: cameraFov }}
      shadows
      onCreated={({ gl }) => {
        const glAny = gl as any;
        const THREEAny = THREE as any;

        if (
          glAny.outputColorSpace !== undefined &&
          THREEAny.SRGBColorSpace !== undefined
        ) {
          glAny.outputColorSpace = THREEAny.SRGBColorSpace;
        } else if (
          glAny.outputEncoding !== undefined &&
          THREEAny.sRGBEncoding !== undefined
        ) {
          glAny.outputEncoding = THREEAny.sRGBEncoding;
        }

        // ACES rolls the warm fixture highlights off instead of flattening them
        // the way Reinhard did, which is what made the old pass look washed out.
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      {/* Dark ground and depth haze: the room falls away behind the avatar
          instead of ending in a flat white void. */}
      <color attach="background" args={["#080e19"]} />
      <fog attach="fog" args={["#0b1220", 6.5, 24]} />

      {/* Night ambient only — everything else is a practical fixture. */}
      <ambientLight intensity={0.09} color="#5f7ba3" />
      <hemisphereLight
        intensity={0.34}
        color="#33506f"
        groundColor="#1a1512"
        position={[0, 5, 0]}
      />

      {/* Moonlight raking in through the window wall. */}
      <spotLight
        position={[-9.5, 3.4, 0.5]}
        angle={Math.PI / 5}
        penumbra={0.9}
        intensity={2.2}
        color="#7d9fce"
        distance={26}
        decay={1.4}
      />
      <pointLight // cool spill along the glazing itself
        position={[-6.6, 0.9, -2.4]}
        intensity={1.6}
        color="#5f86b4"
        distance={9}
        decay={2}
      />

      <UniversityRoom />

      <ResponsiveLandingAvatar />

      <Html fullscreen>
        <LandingPageMenu
          updateAppState={updateAppState}
          updateConfig={updateConfig}
          config={config}
        />
      </Html>
    </Canvas>
  );
}
