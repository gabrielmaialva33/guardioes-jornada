"""
Append glTF animation clips (node rotations, linear) to an already packed GLB, without Blender,
and the clips of the rigid props (the turtles of vida_marinha.py).

The packers (bake.py, gltfpack) re-export or compress the geometry and keep the named rig
nodes (-kn), but nothing upstream writes animations, so clips are added last, as plain float
accessors in the GLB's binary chunk (buffer 0; meshopt's compressed views stay as they are).
A clip only rotates named nodes whose rest rotation is the identity, as every Cube Pets and
props rig node is: each keyframe value is the node's whole rotation.

    add_clips(glb, {"perch": {"wing-left": ([0.0], [(x, y, z, w)]), ...}, ...})

Quaternions are glTF (x, y, z, w) in glTF axes (y up, the model facing +z).
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

FLOAT = 5126


def _pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * (-len(b) % 4)


def read_glb(path: Path) -> tuple[dict, bytearray]:
    buf = Path(path).read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    doc = json.loads(buf[20 : 20 + jlen])
    rest = buf[20 + jlen :]
    binc = bytearray()
    if len(rest) >= 8:
        blen, kind = struct.unpack_from("<II", rest, 0)
        assert kind == 0x004E4942, "second chunk is not BIN"
        binc = bytearray(rest[8 : 8 + blen])
    return doc, binc


def write_glb(path: Path, doc: dict, binc: bytes | bytearray) -> None:
    js = _pad(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
    bb = _pad(bytes(binc), b"\0")
    total = 12 + 8 + len(js) + 8 + len(bb)
    out = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bb), 0x004E4942) + bb
    Path(path).write_bytes(out)


def add_clips(path: Path, clips: dict) -> dict:
    """Adds (or replaces, by name) the clips; returns {clip: duration}."""
    doc, binc = read_glb(path)
    buffers = doc.get("buffers", [])
    assert buffers and "uri" not in buffers[0], "buffer 0 must be the GLB binary chunk"
    names = {n.get("name"): i for i, n in enumerate(doc.get("nodes", []))}
    for i in names.values():
        r = doc["nodes"][i].get("rotation")
        assert r is None or max(abs(r[0]), abs(r[1]), abs(r[2])) < 1e-6, f"node {i} has a rest rotation"
    doc.setdefault("bufferViews", [])
    doc.setdefault("accessors", [])
    anims = [a for a in doc.get("animations", []) if a.get("name") not in clips]

    def accessor(values: list[float], kind: str, count: int, minmax: bool) -> int:
        nonlocal binc
        binc += b"\0" * (-len(binc) % 4)
        data = struct.pack(f"<{len(values)}f", *values)
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binc), "byteLength": len(data)})
        binc += data
        acc = {"bufferView": len(doc["bufferViews"]) - 1, "componentType": FLOAT, "count": count, "type": kind}
        if minmax:
            acc["min"], acc["max"] = [min(values)], [max(values)]
        doc["accessors"].append(acc)
        return len(doc["accessors"]) - 1

    durations = {}
    for clip, tracks in clips.items():
        samplers, channels = [], []
        end = 0.0
        for node, (times, quats) in tracks.items():
            assert node in names, f"{path.name}: no node {node!r}"
            assert len(times) == len(quats) and times == sorted(times)
            q = []
            for x, y, z, w in quats:
                n = math.sqrt(x * x + y * y + z * z + w * w)
                q += [x / n, y / n, z / n, w / n]
            inp = accessor(list(times), "SCALAR", len(times), True)
            out = accessor(q, "VEC4", len(times), False)
            samplers.append({"input": inp, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": names[node], "path": "rotation"}})
            end = max(end, times[-1])
        anims.append({"name": clip, "samplers": samplers, "channels": channels})
        durations[clip] = end
    doc["animations"] = anims
    buffers[0]["byteLength"] = len(binc)
    write_glb(path, doc, binc)
    return durations


# --------------------------------------------------------------------------- quaternion helpers


def axis_angle(axis, deg: float) -> tuple[float, float, float, float]:
    x, y, z = axis
    n = math.sqrt(x * x + y * y + z * z)
    s = math.sin(math.radians(deg) / 2) / n
    return (x * s, y * s, z * s, math.cos(math.radians(deg) / 2))


def mul(a, b):
    """Hamilton product a * b (apply b, then a)."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def from_columns(cx, cy, cz) -> tuple[float, float, float, float]:
    """The rotation taking the x, y, z axes to the given (orthonormal, right-handed) columns."""
    m00, m10, m20 = cx
    m01, m11, m21 = cy
    m02, m12, m22 = cz
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        return ((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
    if m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        return (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    if m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        return ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    s = math.sqrt(1.0 + m22 - m00 - m11) * 2
    return ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)


def loop(period: float, steps: int, fn) -> tuple[list[float], list]:
    """A closed loop sampled `steps` times: fn(phase in [0, 1)) -> quaternion; the last key repeats the first."""
    times = [period * i / steps for i in range(steps + 1)]
    return times, [fn((i % steps) / steps) for i in range(steps + 1)]


# --------------------------------------------------------------------------- the props' clips


def turtle_swim() -> dict:
    """vida_marinha.py's green turtles: "swim", 2 s. The front flippers beat (a +-30 deg roll
    about z, tip up and down) and sweep (+-18 deg about y, a quarter cycle later: forward on
    the upstroke, back on the power stroke); the hind flippers steer a little (+-10 deg roll,
    half a cycle off); the head bobs 4 deg. Sea turtles swim with their front flippers and
    hold the hind ones as rudders (Wyneken 1997, The Biology of Sea Turtles, ch. 7: TODO-SOURCE
    for the exact page before this is quoted in a Guia entry)."""

    def front(s):
        def key(t):
            a = 30 * math.sin(2 * math.pi * t)
            b = 18 * math.cos(2 * math.pi * t)
            return mul(axis_angle((0, 1, 0), s * b), axis_angle((0, 0, 1), s * a))

        return loop(2.0, 12, key)

    def back(s):
        return loop(2.0, 12, lambda t: axis_angle((0, 0, 1), s * 10 * math.sin(2 * math.pi * t + math.pi)))

    return {"swim": {
        "flipper-front-left": front(1), "flipper-front-right": front(-1),
        "flipper-back-left": back(1), "flipper-back-right": back(-1),
        "head": loop(2.0, 12, lambda t: axis_angle((1, 0, 0), 4 * math.sin(2 * math.pi * t))),
    }}
