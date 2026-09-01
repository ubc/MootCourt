"""Author a thumbs-up action into a copy of the landing-page judge GLB.

Run with Blender, not the system Python:

    Blender --background --python scripts/create_thumbs_up_glb.py -- \
      public/models/judge_avatar/judge_landing_page.glb \
      public/models/judge_avatar/judge_landing_page_thumbs_up.glb

The source asset is never modified. The exported copy contains one baked action
named ``thumbs_up`` that combines the original idle motion with the gesture.
"""

from pathlib import Path
import json
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


FPS = 24
NEUTRAL_FRAME = 1
FIST_FRAME = 28
RAISED_FRAME = 42
HOLD_FRAME = 82
LOWERED_FRAME = 99
OPEN_FRAME = 101
END_FRAME = 240

FINGER_CURL = (1.6, 1.8, 1.2)
FINGERS = ("Index", "Middle", "Ring", "Pinky")


def name_exported_action(path, name="thumbs_up"):
    """Give Blender's generic `Animation` GLB clip a stable useful name."""
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise RuntimeError("Blender did not produce a valid GLB 2.0 file")

    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError("GLB JSON chunk is missing")
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").rstrip())
    if not document.get("animations"):
        raise RuntimeError("Exported GLB contains no animation")
    document["animations"][0]["name"] = name

    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    remainder = data[20 + json_length :]
    total_length = 12 + 8 + len(encoded) + len(remainder)
    rebuilt = struct.pack("<4sII", b"glTF", 2, total_length)
    rebuilt += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + remainder
    path.write_bytes(rebuilt)


def arguments():
    try:
        separator = sys.argv.index("--")
        source, destination = sys.argv[separator + 1 : separator + 3]
    except (ValueError, IndexError):
        raise SystemExit("Expected source.glb and destination.glb after --")
    return Path(source).resolve(), Path(destination).resolve()


def require_bone(armature, name):
    bone = armature.pose.bones.get(name)
    if bone is None:
        raise RuntimeError(f"Required bone is missing: {name}")
    return bone


def set_world_rotation(pose_bone, rotation):
    """Set an armature-space rotation without moving the bone head."""
    matrix = pose_bone.matrix.copy()
    pose_bone.matrix = Matrix.LocRotScale(
        matrix.to_translation(), rotation.normalized(), matrix.to_scale()
    )
    bpy.context.view_layer.update()


def aim_bone(pose_bone, desired_direction):
    current = (pose_bone.tail - pose_bone.head).normalized()
    desired = desired_direction.normalized()
    delta = current.rotation_difference(desired)
    set_world_rotation(pose_bone, delta @ pose_bone.matrix.to_quaternion())


def basis_quaternion(primary, secondary):
    first = primary.normalized()
    second = (secondary - first * secondary.dot(first)).normalized()
    third = first.cross(second).normalized()
    return Matrix((first, second, third)).transposed().to_quaternion()


def orient_hand(hand, middle_knuckle, index_knuckle, pinky_knuckle,
                desired_primary, desired_secondary):
    current_primary = middle_knuckle.head - hand.head
    current_secondary = pinky_knuckle.head - index_knuckle.head
    current_basis = basis_quaternion(current_primary, current_secondary)
    desired_basis = basis_quaternion(desired_primary, desired_secondary)
    delta = desired_basis @ current_basis.inverted()
    set_world_rotation(hand, delta @ hand.matrix.to_quaternion())


def reset_pose(armature):
    for bone in armature.pose.bones:
        bone.matrix_basis.identity()
        bone.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()


def build_full_pose(armature):
    hips = require_bone(armature, "Hips")
    head = require_bone(armature, "Head")
    left_arm = require_bone(armature, "LeftArm")
    right_arm = require_bone(armature, "RightArm")
    forearm = require_bone(armature, "RightForeArm")
    hand = require_bone(armature, "RightHand")
    middle = require_bone(armature, "RightHandMiddle1")
    index = require_bone(armature, "RightHandIndex1")
    pinky = require_bone(armature, "RightHandPinky1")

    up = (head.head - hips.head).normalized()
    right = (right_arm.head - left_arm.head).normalized()
    forward = up.cross(right).normalized()
    right = forward.cross(up).normalized()

    upper_arm_direction = (
        -up + forward * 0.22 + right * 0.20
    ).normalized()
    aim_bone(right_arm, upper_arm_direction)

    # Bring the fist upward from the elbow instead of sweeping the forearm
    # across the chest. This vertical silhouette reads clearly at menu scale.
    forearm_direction = (
        forward * 0.35 + up * 0.92 + right * 0.02
    ).normalized()
    aim_bone(forearm, forearm_direction)

    hand_direction = (forward * 0.94 + up * 0.20).normalized()
    orient_hand(hand, middle, index, pinky, hand_direction, -up)

    # Blender's imported Ready Player Me bones extend along local +Y and flex
    # around local +X, matching the source glTF rig.
    for finger in FINGERS:
        for joint, angle in enumerate(FINGER_CURL, start=1):
            bone = require_bone(armature, f"RightHand{finger}{joint}")
            bone.rotation_quaternion = (
                bone.rotation_quaternion @ Quaternion((1.0, 0.0, 0.0), angle)
            )
    bpy.context.view_layer.update()

    thumb_direction = (up * 0.94 + forward * 0.22 + right * 0.12).normalized()
    for joint in range(1, 4):
        aim_bone(require_bone(armature, f"RightHandThumb{joint}"), thumb_direction)


def quaternion_snapshot(armature, names):
    return {
        name: require_bone(armature, name).rotation_quaternion.copy()
        for name in names
    }


def smoothstep(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def arm_weight(frame):
    if frame < FIST_FRAME + 1 or frame > LOWERED_FRAME:
        return 0.0
    if frame < RAISED_FRAME:
        return smoothstep(
            (frame - (FIST_FRAME + 1)) / (RAISED_FRAME - (FIST_FRAME + 1))
        )
    if frame <= HOLD_FRAME:
        return 1.0
    return 1.0 - smoothstep(
        (frame - HOLD_FRAME) / (LOWERED_FRAME - HOLD_FRAME)
    )


def sample_idle(armature, action):
    """Sample one looping idle cycle into the ten-second output timeline."""
    armature.animation_data.action = action
    start, end = action.frame_range
    start = int(round(start))
    duration = max(1, int(round(end - start)))
    samples = {}
    for frame in range(NEUTRAL_FRAME, END_FRAME + 1):
        source_frame = start + ((frame - NEUTRAL_FRAME) % duration)
        bpy.context.scene.frame_set(source_frame)
        samples[frame] = {
            bone.name: bone.matrix_basis.decompose()
            for bone in armature.pose.bones
        }
    return samples


def make_action(armature):
    affected = ["RightArm", "RightForeArm", "RightHand"]
    affected += [
        f"RightHand{finger}{joint}"
        for finger in FINGERS
        for joint in range(1, 4)
    ]
    affected += [f"RightHandThumb{joint}" for joint in range(1, 4)]

    idle_action = bpy.data.actions.get("idle")
    if idle_action is None:
        raise RuntimeError("Source GLB contains no idle action to bake")
    idle_samples = sample_idle(armature, idle_action)

    armature.animation_data.action = None
    reset_pose(armature)
    build_full_pose(armature)
    raised = quaternion_snapshot(armature, affected)

    finger_names = {
        f"RightHand{finger}{joint}"
        for finger in FINGERS
        for joint in range(1, 4)
    }

    reset_pose(armature)
    action = bpy.data.actions.new("thumbs_up")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action

    for frame in range(NEUTRAL_FRAME, END_FRAME + 1):
        bpy.context.scene.frame_set(frame)
        gesture_weight = arm_weight(frame)
        fist_weight = 1.0 if FIST_FRAME + 1 <= frame <= LOWERED_FRAME else 0.0

        for bone in armature.pose.bones:
            location, rotation, scale = idle_samples[frame][bone.name]
            if bone.name in raised:
                weight = fist_weight if bone.name in finger_names else gesture_weight
                rotation = rotation.slerp(raised[bone.name], weight)

            bone.rotation_mode = "QUATERNION"
            bone.location = location
            bone.rotation_quaternion = rotation
            bone.scale = scale
            bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
            bone.keyframe_insert(
                data_path="rotation_quaternion", frame=frame, group=bone.name
            )
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)

    return action


def main():
    source, destination = arguments()
    if source == destination:
        raise RuntimeError("Destination must differ from the source GLB")
    destination.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armature = next(
        (obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None
    )
    if armature is None:
        raise RuntimeError("Imported GLB contains no armature")

    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_start = NEUTRAL_FRAME
    bpy.context.scene.frame_end = END_FRAME
    action = make_action(armature)
    armature.animation_data.action = action

    # The single exported action already contains the looping idle motion and
    # the authored gesture, so the browser only has to play clip 0.
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_morph_animation=False,
        export_yup=True,
    )
    name_exported_action(destination)
    print(f"THUMBS_UP_EXPORTED {destination}")


if __name__ == "__main__":
    main()
