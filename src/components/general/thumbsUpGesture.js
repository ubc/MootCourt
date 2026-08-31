import * as THREE from "three";

/*
 * A procedural thumbs-up, layered on top of whatever clip the mixer is playing.
 *
 * None of the shipped .glb files contain a thumbs-up clip — judge_landing_page.glb
 * only has "idle" (plus "istock_9s", which drives the teeth mesh and nothing
 * else) — so the pose is built from the skeleton at runtime instead of being
 * authored in Blender. It is the same trick ModelNPC already uses for its
 * look-at: read the pose the mixer just wrote, slerp selected bones toward a
 * target, and let a weight decide how much of the gesture shows.
 *
 * Every direction below is derived from the rig itself rather than from world
 * axes, so the gesture survives the rotation the landing page applies to the
 * avatar and would survive a re-export with a different orientation.
 */

const scratch = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  up: new THREE.Vector3(),
  fwd: new THREE.Vector3(),
  right: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  cur: new THREE.Vector3(),
  des: new THREE.Vector3(),
  sec: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  b1: new THREE.Vector3(),
  b2: new THREE.Vector3(),
  b3: new THREE.Vector3(),
  mCur: new THREE.Matrix4(),
  mDes: new THREE.Matrix4(),
  qCur: new THREE.Quaternion(),
  qDes: new THREE.Quaternion(),
  qDelta: new THREE.Quaternion(),
  qWorld: new THREE.Quaternion(),
  qParent: new THREE.Quaternion(),
  qLocal: new THREE.Quaternion(),
};

// Ready Player Me exports these unprefixed; Mixamo prefixes them. Accept both so
// the gesture also works on the judge_model_main rigs.
function findBone(root, name) {
  let found = null;
  root.traverse((o) => {
    if (found || !o?.isBone) return;
    if (o.name === name || o.name === `mixamorig${name}`) found = o;
  });
  return found;
}

/**
 * Collects every bone the gesture touches. Returns null when the rig is missing
 * one the pose depends on — the caller's signal to skip the gesture rather than
 * half-apply it.
 */
export function collectThumbsUpBones(root, side = "Right") {
  const fingers = ["Index", "Middle", "Ring", "Pinky"].map((finger) =>
    [1, 2, 3].map((joint) => findBone(root, `${side}Hand${finger}${joint}`))
  );

  const bones = {
    hips: findBone(root, "Hips"),
    head: findBone(root, "Head"),
    // Both shoulders, always — the body's own left/right axis is what the
    // gesture directions are expressed in, whichever hand is doing the pointing.
    armLeft: findBone(root, "LeftArm"),
    armRight: findBone(root, "RightArm"),
    arm: findBone(root, `${side}Arm`),
    foreArm: findBone(root, `${side}ForeArm`),
    hand: findBone(root, `${side}Hand`),
    // Wrist -> knuckles. Middle1 is the straightest reference for "which way do
    // the fingers point", even once they are curled into a fist.
    knuckleRef: fingers[1][0],
    // Across the knuckles: the finger flexion axis. Reading it off the mesh
    // means the curl never has to assume a bone axis convention.
    index1: fingers[0][0],
    pinky1: fingers[3][0],
    fingers,
    fingerBase: fingers.map((phalanges) =>
      phalanges.map((bone) => bone?.quaternion.clone() || null)
    ),
    thumb: [1, 2, 3, 4].map((joint) =>
      findBone(root, `${side}HandThumb${joint}`)
    ),
    // +1 for the right hand, -1 for the left: mirrors the outward lean of the
    // arm and flips the direction the fingers curl.
    sign: side === "Right" ? 1 : -1,
  };

  bones.thumbBase = bones.thumb.map(
    (bone) => bone?.quaternion.clone() || null
  );
  bones.armBase = {
    arm: bones.arm?.quaternion.clone() || null,
    foreArm: bones.foreArm?.quaternion.clone() || null,
    hand: bones.hand?.quaternion.clone() || null,
  };

  const required = [
    bones.hips,
    bones.head,
    bones.armLeft,
    bones.armRight,
    bones.arm,
    bones.foreArm,
    bones.hand,
    bones.knuckleRef,
    bones.index1,
    bones.pinky1,
  ];
  return required.some((bone) => !bone) ? null : bones;
}

function worldDirection(from, to, out) {
  from.getWorldPosition(scratch.a);
  to.getWorldPosition(scratch.b);
  return out.copy(scratch.b).sub(scratch.a).normalize();
}

// Blend a bone toward a desired *world* orientation, starting from the pose the
// mixer just wrote. weight 0 leaves the clip untouched, weight 1 is the full
// gesture pose.
function blendToWorldQuat(bone, targetWorld, weight) {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(scratch.qParent);
    scratch.qLocal.copy(scratch.qParent).invert().multiply(targetWorld);
  } else {
    scratch.qLocal.copy(targetWorld);
  }
  bone.quaternion.slerp(scratch.qLocal, weight);
  // Bones further down the chain read world positions, so the subtree has to
  // catch up before the next one is posed.
  bone.updateMatrixWorld(true);
}

// Swing a bone so the segment running to `childBone` points along `desiredDir`.
// Leaves the bone's roll wherever the clip had it.
function aimSegment(bone, childBone, desiredDir, weight) {
  if (!bone || !childBone) return;
  worldDirection(bone, childBone, scratch.cur);
  bone.getWorldQuaternion(scratch.qWorld);
  scratch.qDelta
    .setFromUnitVectors(scratch.cur, desiredDir)
    .multiply(scratch.qWorld);
  blendToWorldQuat(bone, scratch.qDelta, weight);
}

// Orthonormal basis from a primary direction and a rough secondary one.
function basisFrom(primary, secondary, out) {
  scratch.b1.copy(primary).normalize();
  scratch.b2
    .copy(secondary)
    .addScaledVector(scratch.b1, -secondary.dot(scratch.b1))
    .normalize();
  scratch.b3.crossVectors(scratch.b1, scratch.b2);
  return out.makeBasis(scratch.b1, scratch.b2, scratch.b3);
}

// Pins both the direction a bone points *and* its roll. The hand needs this:
// aiming the wrist alone leaves the palm free to face anywhere, and a thumbs-up
// is entirely about which way the palm faces.
function orientSegment(bone, curPrimary, curSecondary, desPrimary, desSecondary, weight) {
  basisFrom(curPrimary, curSecondary, scratch.mCur);
  scratch.qCur.setFromRotationMatrix(scratch.mCur);
  basisFrom(desPrimary, desSecondary, scratch.mDes);
  scratch.qDes.setFromRotationMatrix(scratch.mDes);

  bone.getWorldQuaternion(scratch.qWorld);
  scratch.qDelta
    .copy(scratch.qDes)
    .multiply(scratch.qCur.invert())
    .multiply(scratch.qWorld);
  blendToWorldQuat(bone, scratch.qDelta, weight);
}

// Fold one finger into the fist around the rig's native hinge. These RPM finger
// bones extend along local +Y and flex around local +X. Using one world-space
// axis for every joint left the fingers splayed because each child already has
// its own bind rotation.
function curlFinger(phalanges, baseQuaternions, angles, sign, weight) {
  phalanges.forEach((bone, i) => {
    const base = baseQuaternions[i];
    if (!bone || !base) return;
    bone.quaternion.copy(base);
    scratch.qDelta.setFromAxisAngle(scratch.a.set(1, 0, 0), angles[i] * sign);
    scratch.qLocal.copy(base).multiply(scratch.qDelta);
    bone.quaternion.slerp(scratch.qLocal, weight);
    bone.updateMatrixWorld(true);
  });
}

// MCP, PIP, and DIP flexion for a closed fist.
const FINGER_CURL = [1.6, 1.8, 1.2];

/**
 * Poses the arm. `weight` is the 0..1 envelope from thumbsUpWeight; `time` is a
 * free-running seconds counter, used only for the small pump during the hold.
 */
export function applyThumbsUp(bones, weight, time) {
  if (!bones) return;

  // The landing-page idle clip does not contain arm or finger tracks. Reset the
  // entire affected chain explicitly so procedural rotations do not accumulate
  // and so weight 0 genuinely returns the avatar to its neutral pose.
  if (bones.armBase.arm) bones.arm.quaternion.copy(bones.armBase.arm);
  if (bones.armBase.foreArm) {
    bones.foreArm.quaternion.copy(bones.armBase.foreArm);
  }
  if (bones.armBase.hand) bones.hand.quaternion.copy(bones.armBase.hand);
  bones.arm.updateMatrixWorld(true);

  // A partially curled hand reads as a claw. Keep a complete fist for every
  // visible frame of the gesture and open it only once the arm is fully at rest.
  const fingerWeight = weight > 0.0005 ? 1 : 0;
  bones.fingers.forEach((phalanges, i) =>
    curlFinger(
      phalanges,
      bones.fingerBase[i],
      FINGER_CURL,
      bones.sign,
      fingerWeight
    )
  );
  bones.thumb.forEach((bone, i) => {
    const base = bones.thumbBase[i];
    if (bone && base) bone.quaternion.copy(base);
  });
  if (weight <= 0.0005) return;

  const s = bones.sign;

  // Rig-relative frame: up runs hips -> head, right runs shoulder -> shoulder,
  // forward falls out of the two.
  const up = worldDirection(bones.hips, bones.head, scratch.up);
  worldDirection(bones.armLeft, bones.armRight, scratch.right);
  // On this Ready Player Me rig, shoulder-left -> shoulder-right is +right and
  // the avatar faces -Z.  up x right therefore gives the body's forward
  // direction.  The opposite cross-product points behind the torso, which made
  // the forearm and hand disappear through the character in the first attempt.
  const forward = scratch.fwd.crossVectors(up, scratch.right).normalize();
  const right = scratch.right.crossVectors(forward, up).normalize();

  // A shallow pump while the thumb is held up, so it reads as a gesture rather
  // than a frozen pose.
  const bob = Math.sin(time * 5.5) * 0.06 * weight;

  // Upper arm hangs down, elbow carried a little forward and out.
  scratch.dir
    .copy(up)
    .multiplyScalar(-1)
    .addScaledVector(forward, 0.22)
    .addScaledVector(right, 0.2 * s)
    .normalize();
  aimSegment(bones.arm, bones.foreArm, scratch.dir, weight);

  // Forearm swings up and slightly across the body: elbow near a right angle,
  // fist in front of the chest.
  scratch.dir
    .copy(forward)
    .multiplyScalar(0.82)
    .addScaledVector(up, 0.46 + bob)
    .addScaledVector(right, -0.2 * s)
    .normalize();
  aimSegment(bones.foreArm, bones.hand, scratch.dir, weight);

  // Hand keeps that line, with the palm turned toward the body's midline so the
  // thumb ends up on top.
  worldDirection(bones.hand, bones.knuckleRef, scratch.cur);
  worldDirection(bones.index1, bones.pinky1, scratch.axis);
  scratch.des
    .copy(forward)
    .multiplyScalar(0.86)
    .addScaledVector(up, 0.24 + bob)
    .addScaledVector(right, -0.24 * s)
    .normalize();
  scratch.sec.copy(up).multiplyScalar(-1); // index knuckle on top, pinky below
  orientSegment(bones.hand, scratch.cur, scratch.axis, scratch.des, scratch.sec, weight);

  // Thumb straightens and points up.
  scratch.dir
    .copy(up)
    .multiplyScalar(0.94)
    .addScaledVector(forward, 0.22)
    .addScaledVector(right, 0.12 * s)
    .normalize();
  for (let i = 0; i < 3; i += 1) {
    aimSegment(bones.thumb[i], bones.thumb[i + 1], scratch.dir, weight);
  }
}

function smoothstep(x) {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Envelope for the gesture: wait, raise, hold, lower, rest, repeat.
 * `t` is seconds since the model mounted.
 */
export function thumbsUpWeight(t, options) {
  const {
    startDelay = 1.2,
    riseTime = 0.55,
    holdTime = 1.7,
    fallTime = 0.7,
    restTime = 6.5,
    repeat = true,
  } = options || {};

  if (t <= startDelay) return 0;

  const cycle = riseTime + holdTime + fallTime + restTime;
  let u = t - startDelay;
  if (repeat) u %= cycle;
  else if (u >= riseTime + holdTime + fallTime) return 0;

  if (u < riseTime) return smoothstep(u / riseTime);
  u -= riseTime;
  if (u < holdTime) return 1;
  u -= holdTime;
  if (u < fallTime) return 1 - smoothstep(u / fallTime);
  return 0;
}
