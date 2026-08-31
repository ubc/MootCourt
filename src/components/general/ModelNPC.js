import React, { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import PropTypes from "prop-types";
import * as THREE from "three";
import {
  collectThumbsUpBones,
  applyThumbsUp,
  thumbsUpWeight,
} from "./thumbsUpGesture";

console.log("[ModelNPC] FILE LOADED");

const _boneWorldPos = new THREE.Vector3();
const _targetWorldPos = new THREE.Vector3();
const _parentWorldQuat = new THREE.Quaternion();
const _invParentWorldQuat = new THREE.Quaternion();
const _lookAtMat = new THREE.Matrix4();
const _worldQuat = new THREE.Quaternion();
const _desiredLocalQuat = new THREE.Quaternion();
const _qCur = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _qDeltaClamped = new THREE.Quaternion();
const _qDeltaApplied = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _qIdentity = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

// set forwardFixYaw = 0 (or pass per-model) if rig faces are not backwards
function makeForwardFixQuat(yaw) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// bone name matching
function pickBonesByNames(root, names) {
  const out = [];
  root.traverse((o) => {
    if (!o?.isBone) return;
    if (names.includes(o.name)) out.push(o);
  });
  return out;
}

// layered look-at with the animated pose. Influence is the final blend factor
function aimBoneAt({
  bone,
  targetWorld,
  influence = 0.0,
  yawLimit = Math.PI / 6,
  pitchLimit = Math.PI / 10,
  forwardFixQuat,
}) {
  if (!bone || influence <= 0) return;

  bone.getWorldPosition(_boneWorldPos);

  // world-space "look at" quaternion
  _lookAtMat.lookAt(_boneWorldPos, targetWorld, _up);
  _worldQuat.setFromRotationMatrix(_lookAtMat);
  if (forwardFixQuat) _worldQuat.multiply(forwardFixQuat);

  // convert desired WORLD rotation to LOCAL rotation (relative to parent)
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_parentWorldQuat);
    _invParentWorldQuat.copy(_parentWorldQuat).invert();
    _desiredLocalQuat.copy(_invParentWorldQuat).multiply(_worldQuat);
  } else {
    _desiredLocalQuat.copy(_worldQuat);
  }

  // current (animated) local rotation
  _qCur.copy(bone.quaternion);

  // delta from current to desired in local space
  _qDelta.copy(_qCur).invert().multiply(_desiredLocalQuat);

  // clamp the delta (not the absolute), to preserve the animated pose style
  _euler.setFromQuaternion(_qDelta, "YXZ");
  _euler.y = THREE.MathUtils.clamp(_euler.y, -yawLimit, yawLimit);
  _euler.x = THREE.MathUtils.clamp(_euler.x, -pitchLimit, pitchLimit);
  _euler.z = 0;
  _qDeltaClamped.setFromEuler(_euler);

  // apply only a fraction of the delta based on final influence
  const alpha = THREE.MathUtils.clamp(influence, 0, 1);
  _qDeltaApplied.copy(_qIdentity).slerp(_qDeltaClamped, alpha);

  // start from animated pose, then apply partial delta
  _qOut.copy(_qCur).multiply(_qDeltaApplied);
  bone.quaternion.copy(_qOut);
}

function ModelNPC({
  modelUrl,
  pos,
  rot,
  sca,

  // animation control
  pauseAnimation = false,
  animated = true,

  // gesture layered on top of the clip: "none" or "thumbsUp"
  gesture = "none",
  gestureSide = "Right",
  gestureOptions = null,

  // look-at control
  lookAtEnabled = true,
  lookAtTarget = null, // [x,y,z] world space OR null => camera
  lookAtRandom = true,

  // random loop tuning (seconds)
  lookMinInterval = 1.0,
  lookMaxInterval = 4.0,
  lookMinHold = 0.6,
  lookMaxHold = 1.6,

  // how fast we blend in/out influence (bigger = snappier)
  lookBlendSpeed = 5.0,

  // caps so animation still shows while looking (0 to 1 recommended)
  neckMax = 0.2,
  headMax = 0.3,
  eyesMax = 0.6,

  // clamp limits
  neckYawLimit = Math.PI / 3,
  headYawLimit = Math.PI / 2,
  eyesYawLimit = Math.PI / 1.5,
  neckPitchLimit = Math.PI / 6,
  headPitchLimit = Math.PI / 5,
  eyesPitchLimit = Math.PI / 4,

  // forward fix (per-model override)
  forwardFixYaw = Math.PI, // set to 0 if rig already faces correct direction

  // debug logs
  debugLook = false,
}) {
  const [gltf, setGltf] = useState(null);

  const mixerRef = useRef(null);
  const actionRef = useRef(null);

  const bonesRef = useRef({ neck: [], head: [], eyeL: [], eyeR: [] });

  const gestureBonesRef = useRef(null);
  const gestureClockRef = useRef(0);

  const forwardFixQuatRef = useRef(makeForwardFixQuat(forwardFixYaw));

  const lookCtrlRef = useRef({
    phase: "WAIT",
    t: 0,
    nextWait: randRange(lookMinInterval, lookMaxInterval),
    holdFor: randRange(lookMinHold, lookMaxHold),
    influence: 0, // smoothed
    targetInfluence: 0, // 0 or 1
    lastLoggedPhase: null,
  });

  const debugRef = useRef({ t: 0 });

  useEffect(() => {
    forwardFixQuatRef.current = makeForwardFixQuat(forwardFixYaw);
  }, [forwardFixYaw]);

  useEffect(() => {
    console.log("[ModelNPC] MOUNT", modelUrl);
    return () => console.log("[ModelNPC] UNMOUNT", modelUrl);
  }, [modelUrl]);

  useEffect(() => {
    const c = lookCtrlRef.current;
    c.nextWait = randRange(lookMinInterval, lookMaxInterval);
    c.holdFor = randRange(lookMinHold, lookMaxHold);
  }, [lookMinInterval, lookMaxInterval, lookMinHold, lookMaxHold]);

  // Kept out of the loader effect so switching the gesture on or off does not
  // re-download the model.
  useEffect(() => {
    gestureClockRef.current = 0;
    if (!gltf || gesture !== "thumbsUp") {
      gestureBonesRef.current = null;
      return;
    }
    const bones = collectThumbsUpBones(gltf.scene, gestureSide);
    gestureBonesRef.current = bones;
    if (!bones) {
      console.warn(
        "[ModelNPC] thumbsUp gesture skipped: rig is missing arm or hand bones",
        modelUrl
      );
    }
  }, [gltf, gesture, gestureSide, modelUrl]);

  useEffect(() => {
    let cancelled = false;

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (loaded) => {
        if (cancelled) return;

        setGltf(loaded);

        // Bone collection
        // adjust if your skeleton uses different names
        const neckBones = pickBonesByNames(loaded.scene, [
          "Neck",
          "Neck1",
          "mixamorigNeck",
        ]);
        const headBones = pickBonesByNames(loaded.scene, [
          "Head",
          "Head1",
          "mixamorigHead",
        ]);
        const leftEyeBones = pickBonesByNames(loaded.scene, [
          "LeftEye",
          "Eye_L",
          "mixamorigLeftEye",
        ]);
        const rightEyeBones = pickBonesByNames(loaded.scene, [
          "RightEye",
          "Eye_R",
          "mixamorigRightEye",
        ]);

        bonesRef.current = {
          neck: neckBones,
          head: headBones,
          eyeL: leftEyeBones,
          eyeR: rightEyeBones,
        };

        if (debugLook) {
          console.log("[ModelNPC] bones found:", modelUrl, {
            neck: neckBones.length,
            head: headBones.length,
            eyeL: leftEyeBones.length,
            eyeR: rightEyeBones.length,
          });
          console.log(
            "[ModelNPC] clips:",
            loaded.animations?.map((a) => a.name) ?? []
          );
        }

        // animation
        if (loaded.animations && loaded.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(loaded.scene);
          mixerRef.current = mixer;

          const action = mixer.clipAction(loaded.animations[0]);
          actionRef.current = action;

          action.setLoop(THREE.LoopRepeat);
          action.clampWhenFinished = true;
          action.play();

          // freeze via timeScale
          action.paused = false;
          action.setEffectiveTimeScale(pauseAnimation ? 0 : 1);

          mixer.update(0);
        }
      },
      undefined,
      (err) => console.error("[ModelNPC] GLTF load error:", err)
    );

    return () => {
      cancelled = true;
      if (mixerRef.current) mixerRef.current.stopAllAction();
      mixerRef.current = null;
      actionRef.current = null;
      setGltf(null);
    };
  }, [modelUrl, debugLook, pauseAnimation]);

  useEffect(() => {
    const action = actionRef.current;
    if (!action) return;
    action.paused = false;
    action.setEffectiveTimeScale(pauseAnimation ? 0 : 1);
    if (debugLook) console.log("[ModelNPC] pauseAnimation ->", pauseAnimation);
  }, [pauseAnimation, debugLook]);

  useFrame((state, delta) => {
    if (!gltf) return;

    // update animation
    const mixer = mixerRef.current;
    if (animated && mixer) mixer.update(delta);

    // update matrices so bone.getWorldPosition is correct
    gltf.scene.updateMatrixWorld(true);

    // layer the gesture over the clip the mixer just wrote. The clock is frozen
    // while the app is paused so the pose holds instead of jumping on resume.
    if (gestureBonesRef.current) {
      if (!pauseAnimation) gestureClockRef.current += delta;
      applyThumbsUp(
        gestureBonesRef.current,
        thumbsUpWeight(gestureClockRef.current, gestureOptions),
        gestureClockRef.current
      );
    }

    // update gaze state machine
    const c = lookCtrlRef.current;

    if (!lookAtEnabled) {
      c.targetInfluence = 0;
    } else if (!lookAtRandom) {
      c.targetInfluence = 1;
    } else {
      c.t += delta;
      if (c.phase === "WAIT") {
        c.targetInfluence = 0;
        if (c.t >= c.nextWait) {
          c.phase = "LOOK";
          c.t = 0;
          c.holdFor = randRange(lookMinHold, lookMaxHold);
        }
      } else {
        c.targetInfluence = 1;
        if (c.t >= c.holdFor) {
          c.phase = "WAIT";
          c.t = 0;
          c.nextWait = randRange(lookMinInterval, lookMaxInterval);
        }
      }
    }

    if (debugLook && c.phase !== c.lastLoggedPhase) {
      c.lastLoggedPhase = c.phase;
      if (c.phase === "LOOK")
        console.log("[ModelNPC] -> LOOK (holdFor:", c.holdFor.toFixed(2), "s)");
      else
        console.log(
          "[ModelNPC] -> WAIT (nextWait:",
          c.nextWait.toFixed(2),
          "s)"
        );
    }

    // smoothen influence
    const k = 1 - Math.exp(-lookBlendSpeed * delta);
    c.influence = THREE.MathUtils.lerp(c.influence, c.targetInfluence, k);

    const w = c.influence;
    if (w < 0.0005) return;

    // get target position
    if (
      lookAtTarget &&
      Array.isArray(lookAtTarget) &&
      lookAtTarget.length === 3
    ) {
      _targetWorldPos.set(lookAtTarget[0], lookAtTarget[1], lookAtTarget[2]);
    } else {
      state.camera.getWorldPosition(_targetWorldPos);
      // look slightly down toward "face" instead of camera origin
      _targetWorldPos.y -= 0.35; // comment out if not needed
    }

    // apply look-at layering
    const { neck, head, eyeL, eyeR } = bonesRef.current;

    const forwardFixQuat = forwardFixQuatRef.current;

    const neckW = w * neckMax;
    const headW = w * headMax;
    const eyesW = w * eyesMax;

    for (const b of neck) {
      aimBoneAt({
        bone: b,
        targetWorld: _targetWorldPos,
        influence: neckW,
        yawLimit: neckYawLimit,
        pitchLimit: neckPitchLimit,
        forwardFixQuat,
      });
    }
    for (const b of head) {
      aimBoneAt({
        bone: b,
        targetWorld: _targetWorldPos,
        influence: headW,
        yawLimit: headYawLimit,
        pitchLimit: headPitchLimit,
        forwardFixQuat,
      });
    }
    for (const b of eyeL) {
      aimBoneAt({
        bone: b,
        targetWorld: _targetWorldPos,
        influence: eyesW,
        yawLimit: eyesYawLimit,
        pitchLimit: eyesPitchLimit,
        forwardFixQuat,
      });
    }
    for (const b of eyeR) {
      aimBoneAt({
        bone: b,
        targetWorld: _targetWorldPos,
        influence: eyesW,
        yawLimit: eyesYawLimit,
        pitchLimit: eyesPitchLimit,
        forwardFixQuat,
      });
    }

    if (debugLook) {
      debugRef.current.t += delta;
      if (debugRef.current.t >= 1.0) {
        debugRef.current.t = 0;
        console.log("[ModelNPC] LOOK applying", {
          w: Number(w.toFixed(3)),
          target: _targetWorldPos.toArray().map((n) => Number(n.toFixed(3))),
          camType: state.camera?.type,
        });
      }
    }
  });

  return gltf ? (
    <group position={pos} rotation={rot} scale={sca}>
      <primitive object={gltf.scene} />
    </group>
  ) : null;
}

ModelNPC.propTypes = {
  modelUrl: PropTypes.string,
  pos: PropTypes.any,
  rot: PropTypes.any,
  sca: PropTypes.any,

  pauseAnimation: PropTypes.bool,
  animated: PropTypes.bool,

  gesture: PropTypes.oneOf(["none", "thumbsUp"]),
  gestureSide: PropTypes.oneOf(["Left", "Right"]),
  gestureOptions: PropTypes.object,

  lookAtEnabled: PropTypes.bool,
  lookAtTarget: PropTypes.any,
  lookAtRandom: PropTypes.bool,

  lookMinInterval: PropTypes.number,
  lookMaxInterval: PropTypes.number,
  lookMinHold: PropTypes.number,
  lookMaxHold: PropTypes.number,
  lookBlendSpeed: PropTypes.number,

  neckMax: PropTypes.number,
  headMax: PropTypes.number,
  eyesMax: PropTypes.number,

  neckYawLimit: PropTypes.number,
  headYawLimit: PropTypes.number,
  eyesYawLimit: PropTypes.number,
  neckPitchLimit: PropTypes.number,
  headPitchLimit: PropTypes.number,
  eyesPitchLimit: PropTypes.number,

  forwardFixYaw: PropTypes.number,

  debugLook: PropTypes.bool,
};

export default ModelNPC;
