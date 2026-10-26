"""
trees_v2_atlas.py — Build all 10 Atlantic Forest v2 trees and 5 ground-cover v2 models
using the shared 512x512 painted foliage & bark atlas (`game/src/assets/skins/foliage-atlas.png`).

Implements the owner's course change (ART.md §5 "Painted colour on every tier"):
  1. `ginkgo-outono`      -> `custom-ipe-amarelo.glb` (~11.0 u, <= 450 tris + `flores-caidas`)
  2. `ginkgo-verao`       -> `custom-pau-brasil.glb` (~11.5 u, <= 450 tris, reddish-brown bark + green/yellow crown)
  3. `arvore-rosa`        -> `custom-ipe-rosa.glb` (~11.0 u, <= 450 tris + `flores-caidas`)
  4. `pacote-copa-camadas`-> `custom-jequitiba-rosa.glb` (~18.0 u emergent, <= 700 tris)
  5. `jeriva-queen-palm`  -> `custom-jeriva.glb` (~11.0 u Syagrus romanzoffiana, <= 450 tris)
  6. `palmeiras-psx`      -> `custom-palmeira-jucara.glb` (~8.0 u, <= 450 tris + `cacho-frutos`)
  7. `mangue-alto`+`mangue-a` -> `custom-mangue-vermelho.glb` (~8.5 u, <= 450 tris)
  8. `custom-araucaria.glb`, `custom-embauba.glb`, `custom-xaxim.glb` + 5 ground-cover v2 models
     (`custom-bromelia.glb`, `custom-bromelia-centro-vermelho.glb`, `custom-samambaia.glb`,
     `custom-flores-mata.glb`, `custom-serapilheira.glb`) UV-mapped onto the same 512x512 painted atlas.

Run:
  /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/trees_v2_atlas.py [-- --no-render]
"""

from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import _common as C  # noqa: E402

GAME_ROOT = C.GAME
MODELS_DIR = GAME_ROOT / "src" / "assets" / "models"
SKINS_DIR = GAME_ROOT / "src" / "assets" / "skins"
ATLAS_PATH = SKINS_DIR / "foliage-atlas.png"
ARV_DIR = Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "downloads-v2" / "arvores"


def tile_uv(col: int, row: int, u: float, v: float, pad: float = 0.012) -> tuple[float, float]:
    """Map local (u, v) in [0, 1] into tile (col, row) of the 4x4 512x512 atlas."""
    u_clamped = max(0.0, min(1.0, u))
    v_clamped = max(0.0, min(1.0, v))
    u0 = col * 0.25 + pad
    u1 = (col + 1) * 0.25 - pad
    v0 = row * 0.25 + pad
    v1 = (row + 1) * 0.25 - pad
    return (u0 + (u1 - u0) * u_clamped, v0 + (v1 - v0) * v_clamped)


def make_atlas_material(name: str = "FoliageAtlasMat", alpha_clip: bool = True) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    if alpha_clip:
        try:
            mat.blend_method = "CLIP"
            mat.alpha_threshold = 0.42
        except Exception:
            pass
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0

    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(str(ATLAS_PATH), check_existing=True)
    tex.image = img
    tex.interpolation = "Linear"

    vc = nt.nodes.new("ShaderNodeAttribute")
    vc.attribute_name = "Color"

    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0

    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(vc.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    if alpha_clip:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def import_glb_meshes(glb_path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    after = set(bpy.context.scene.objects) - before
    bpy.context.view_layer.update()
    meshes = []
    for o in after:
        if o.type == "MESH":
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
            meshes.append(o)
    for o in list(after):
        if o.type != "MESH" and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def bake_world_into_mesh(obj: bpy.types.Object) -> None:
    mw = obj.matrix_world.copy()
    rot_m = mw.to_3x3().normalized()
    for v in obj.data.vertices:
        v.co = mw @ v.co
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


def decimate_mesh_obj(obj: bpy.types.Object, target_tris: int, merge_dist: float = 0.002) -> None:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if merge_dist > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    cur_tris = len(obj.data.polygons)
    if cur_tris <= target_tris:
        return
    ratio = max(0.015, min(0.98, target_tris / cur_tris))
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.update()


def subsample_and_scale_leaf_cards(
    obj: bpy.types.Object,
    target_cards: int,
    card_scale: float,
    tile_col: int,
    tile_row: int,
    *,
    uv_mode: str = "unit",
    alt_top_tile: tuple[int, int] | None = None,
    alt_top_frac: float = 0.0,
    merge_dist: float = 0.0005,
) -> None:
    """
    Split `obj` into connected leaf-card components, select `target_cards` cards evenly
    stratified across the 3D crown volume (farthest-point sampling so the silhouette stays
    full), scale each kept card by `card_scale` around its centroid, and remap its UVs into
    `(tile_col, tile_row)` of `foliage-atlas.png`.
    """
    bake_world_into_mesh(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if merge_dist > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
    bm.faces.ensure_lookup_table()
    uv_lay = bm.loops.layers.uv.active or bm.loops.layers.uv.new("UVMap")

    visited = set()
    comps = []
    for f in bm.faces:
        if f.index in visited:
            continue
        st = [f]
        visited.add(f.index)
        faces = []
        verts = set()
        while st:
            cur = st.pop()
            faces.append(cur)
            for v in cur.verts:
                verts.add(v)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in visited:
                        visited.add(nf.index)
                        st.append(nf)
        v_list = list(verts)
        ctr = sum((v.co for v in v_list), Vector()) / len(v_list)
        tris = sum(len(f2.verts) - 2 for f2 in faces)
        comps.append((ctr, faces, v_list, tris))

    if len(comps) > target_cards:
        # Farthest-point sampling across component centroids for uniform 3D crown coverage
        chosen_indices = [0]
        # Start from topmost card
        top_idx = max(range(len(comps)), key=lambda i: comps[i][0].z)
        chosen_indices = [top_idx]
        min_d2 = [((comps[i][0] - comps[top_idx][0]).length_squared) for i in range(len(comps))]
        min_d2[top_idx] = -1.0
        while len(chosen_indices) < target_cards:
            best_i = max(range(len(comps)), key=lambda i: min_d2[i])
            if min_d2[best_i] <= 0:
                break
            chosen_indices.append(best_i)
            min_d2[best_i] = -1.0
            c_new = comps[best_i][0]
            for i in range(len(comps)):
                if min_d2[i] > 0:
                    d2 = (comps[i][0] - c_new).length_squared
                    if d2 < min_d2[i]:
                        min_d2[i] = d2
        keep_set = set(chosen_indices)
    else:
        keep_set = set(range(len(comps)))

    z_all = [comps[i][0].z for i in keep_set]
    z_min = min(z_all) if z_all else 0.0
    z_max = max(z_all) if z_all else 1.0

    faces_to_delete = []
    for idx, (ctr, faces, v_list, _tris) in enumerate(comps):
        if idx not in keep_set:
            faces_to_delete.extend(faces)
            continue
        for v in v_list:
            v.co = ctr + (v.co - ctr) * card_scale

        t_col, t_row = tile_col, tile_row
        if alt_top_tile and z_max > z_min and (ctr.z - z_min) / (z_max - z_min) > (1.0 - alt_top_frac) and (idx % 3 == 0):
            t_col, t_row = alt_top_tile

        for f in faces:
            for l in f.loops:
                uv = l[uv_lay].uv
                if uv_mode == "arvore_rosa":
                    u_loc = uv.x
                    v_loc = uv.y + 1.0
                elif uv_mode == "copa_camadas":
                    u_loc = (uv.x - 0.648) / 0.352
                    v_loc = uv.y / 0.521
                elif uv_mode == "psx_palm":
                    u_loc = (uv.x - 0.32) / 0.36
                    v_loc = uv.y
                else:
                    u_loc = uv.x
                    v_loc = uv.y
                l[uv_lay].uv = tile_uv(t_col, t_row, u_loc, v_loc)

    if faces_to_delete:
        bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def map_trunk_uvs(obj: bpy.types.Object, tile_col: int, tile_row: int, *, crownshaft_top_frac: float = 0.0) -> None:
    bake_world_into_mesh(obj)
    me = obj.data
    uv_lay = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    zs = [v.co.z for v in me.vertices]
    z0 = min(zs) if zs else 0.0
    z1 = max(zs) if zs else 1.0
    z_span = max(0.1, z1 - z0)
    for poly in me.polygons:
        avg_z = sum(me.vertices[vi].co.z for vi in poly.vertices) / len(poly.vertices)
        is_shaft = crownshaft_top_frac > 0 and (avg_z - z0) / z_span >= (1.0 - crownshaft_top_frac)
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            ang = (math.atan2(v.y, v.x) / (2 * math.pi)) + 0.5
            tz = ((v.z - z0) / z_span) % 1.0
            if is_shaft:
                # Green palmito crownshaft band in tile (3, 0) rows 24..63 (glTF v in 0.52..0.78 of tile)
                uv_lay.data[li].uv = tile_uv(3, 0, ang, 0.54 + 0.22 * tz)
            else:
                uv_lay.data[li].uv = tile_uv(tile_col, tile_row, ang, tz)
    me.update()


def join_and_finalize_tree(
    trunk_obj: bpy.types.Object,
    leaves_obj: bpy.types.Object,
    name: str,
    target_height: float,
) -> bpy.types.Object:
    """
    Mark trunk faces with material_index=0 and leaf faces with material_index=1 temporarily,
    join into a single object named `name`, scale uniformly to `target_height` with origin at
    bottom-centre `(0, 0, 0)`, compute flat normals on trunk and smooth volume normals on
    leaves, write 3-step lighting + AO into `Color`, and assign the single shared
    `FoliageAtlasMat`!
    """
    bake_world_into_mesh(trunk_obj)
    bake_world_into_mesh(leaves_obj)

    bm = bmesh.new()
    uv_lay = bm.loops.layers.uv.new("UVMap")
    tag_layer = bm.faces.layers.int.new("is_leaf")

    for is_leaf_val, src_obj in ((0, trunk_obj), (1, leaves_obj)):
        me = src_obj.data
        src_uv = me.uv_layers.active
        base_v = len(bm.verts)
        for v in me.vertices:
            bm.verts.new(v.co)
        bm.verts.ensure_lookup_table()
        for poly in me.polygons:
            try:
                f = bm.faces.new([bm.verts[base_v + vi] for vi in poly.vertices])
            except ValueError:
                continue
            f[tag_layer] = is_leaf_val
            if src_uv:
                for loop, li in zip(f.loops, poly.loop_indices):
                    loop[uv_lay].uv = src_uv.data[li].uv

    bpy.data.objects.remove(trunk_obj, do_unlink=True)
    bpy.data.objects.remove(leaves_obj, do_unlink=True)

    # Uniform scale to target_height and place base at (0, 0, 0)
    verts = list(bm.verts)
    lo = Vector((min(v.co.x for v in verts), min(v.co.y for v in verts), min(v.co.z for v in verts)))
    hi = Vector((max(v.co.x for v in verts), max(v.co.y for v in verts), max(v.co.z for v in verts)))
    cur_h = max(0.1, hi.z - lo.z)
    s = target_height / cur_h
    # Centre X/Y on the trunk base
    trunk_verts = [v for f in bm.faces if f[tag_layer] == 0 for v in f.verts]
    base_verts = [v for v in trunk_verts if v.co.z <= lo.z + 0.15 * cur_h] or trunk_verts or verts
    cx = sum(v.co.x for v in base_verts) / len(base_verts)
    cy = sum(v.co.y for v in base_verts) / len(base_verts)
    for v in verts:
        v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - lo.z) * s))

    out_me = bpy.data.meshes.new(name)
    bm.to_mesh(out_me)
    bm.free()
    out_me.validate(clean_customdata=False)
    out_me.update()

    ob = bpy.data.objects.new(name, out_me)
    bpy.context.collection.objects.link(ob)

    # Read back tag_layer from polygon count or re-evaluate leaf polygons by UV (v >= 0.25 in atlas!)
    col_attr = out_me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    out_me.color_attributes.active_color = col_attr
    uv_data = out_me.uv_layers[0].data

    fol_verts = []
    trunk_z = []
    is_leaf_poly = []
    for poly in out_me.polygons:
        v_avg = sum(uv_data[li].uv.y for li in poly.loop_indices) / poly.loop_total
        # Row 0 (v < 0.25) is bark (except palmito/fruit which is also trunk/fruit); rows 1..3 (v >= 0.25) are foliage!
        is_fol = v_avg >= 0.245
        is_leaf_poly.append(is_fol)
        for vi in poly.vertices:
            if is_fol:
                fol_verts.append(out_me.vertices[vi].co)
            else:
                trunk_z.append(out_me.vertices[vi].co.z)

    if fol_verts:
        flo = Vector((min(v.x for v in fol_verts), min(v.y for v in fol_verts), min(v.z for v in fol_verts)))
        fhi = Vector((max(v.x for v in fol_verts), max(v.y for v in fol_verts), max(v.z for v in fol_verts)))
        fc = (flo + fhi) * 0.5
        fr = Vector((max(0.4, (fhi.x - flo.x) * 0.5), max(0.4, (fhi.y - flo.y) * 0.5), max(0.4, (fhi.z - flo.z) * 0.5)))
        fc_norm = fc.copy()
        fc_norm.z -= fr.z * 0.32
    else:
        flo = Vector((0, 0, 0))
        fhi = Vector((1, 1, 1))
        fc = Vector((0, 0, 0.5))
        fc_norm = fc.copy()
        fr = Vector((1, 1, 1))

    tz0 = min(trunk_z) if trunk_z else 0.0
    tz1 = max(trunk_z) if trunk_z else 1.0

    normals = [None] * len(out_me.loops)
    for poly, is_fol in zip(out_me.polygons, is_leaf_poly):
        poly.use_smooth = is_fol
        for li in poly.loop_indices:
            v = out_me.vertices[out_me.loops[li].vertex_index].co
            if is_fol:
                g = Vector(((v.x - fc_norm.x) / (fr.x ** 2), (v.y - fc_norm.y) / (fr.y ** 2), (v.z - fc_norm.z) / (fr.z ** 2)))
                normals[li] = g.normalized() if g.length > 1e-4 else Vector((0, 0, 1))
                tz = max(0.0, min(1.0, (v.z - flo.z) / max(0.2, fhi.z - flo.z)))
                rad = max(0.0, min(1.0, math.hypot(v.x - fc.x, v.y - fc.y) / max(0.3, max(fr.x, fr.y))))
                u = max(0.0, min(1.0, 0.68 * tz + 0.32 * rad))
                # Neutral/tinted lighting multiplier in COLOR_0 (0.68 cool shadow -> 1.0 warm sunlit)
                r_c = max(0.14, min(0.89, 0.64 + 0.25 * u))
                g_c = max(0.14, min(0.89, 0.70 + 0.19 * u))
                b_c = max(0.14, min(0.89, 0.76 + 0.10 * u))
                col_attr.data[li].color_srgb = (r_c, g_c, b_c, 1.0)
            else:
                normals[li] = poly.normal.copy()
                t_tr = max(0.0, min(1.0, (v.z - tz0) / max(0.2, tz1 - tz0)))
                ao = 0.64 + 0.24 * min(1.0, t_tr * 2.5)
                if fol_verts and v.z > flo.z + 0.15 * (fhi.z - flo.z):
                    ao *= 0.86
                ao = max(0.15, min(0.88, ao))
                col_attr.data[li].color_srgb = (ao, ao, ao, 1.0)

    out_me.normals_split_custom_set(normals)
    mat = make_atlas_material(f"Atlas_{name}", alpha_clip=True)
    out_me.materials.append(mat)
    return ob


def add_fallen_blossom_child(root_obj: bpy.types.Object, tile_col: int, tile_row: int) -> None:
    m = C.Mesh("flores-caidas")
    spots = [(1.1, -0.5, 0.52, 0.1), (-0.95, 0.75, 0.46, 0.9), (0.35, 1.25, 0.42, 1.7), (-1.2, -0.8, 0.48, 2.4)]
    uv_quad = [
        tile_uv(tile_col, tile_row, 0.15, 0.15),
        tile_uv(tile_col, tile_row, 0.85, 0.15),
        tile_uv(tile_col, tile_row, 0.85, 0.85),
        tile_uv(tile_col, tile_row, 0.15, 0.85),
    ]
    for x, y, r, rot in spots:
        pts = [
            (
                x + math.cos(rot + k * math.pi / 2) * r,
                y + math.sin(rot + k * math.pi / 2) * r,
                0.03,
            )
            for k in range(4)
        ]
        m.add(pts, "#d8dad6", uv=uv_quad)
    child = C.build_object(m, "flores-caidas", parent=root_obj, pivot=(0, 0, 0), material=root_obj.data.materials[0])
    me = child.data
    normals = [Vector((0.0, 0.0, 1.0))] * len(me.loops)
    for p in me.polygons:
        p.use_smooth = True
    me.normals_split_custom_set(normals)


# --------------------------------------------------------------------------- 1. Ipê-amarelo (from ginkgo-outono)
def build_ipe_amarelo():
    meshes = import_glb_meshes(ARV_DIR / "ginkgo-outono" / "ginkgo-outono.glb")
    leaves = next(o for o in meshes if "Leaves" in o.name)
    trunk = next(o for o in meshes if "Tree" in o.name)
    decimate_mesh_obj(trunk, target_tris=108)
    map_trunk_uvs(trunk, 0, 0)
    subsample_and_scale_leaf_cards(leaves, target_cards=162, card_scale=2.35, tile_col=0, tile_row=3)
    root = join_and_finalize_tree(trunk, leaves, "ipe-amarelo", target_height=11.0)
    add_fallen_blossom_child(root, 0, 3)
    return root


# --------------------------------------------------------------------------- 2. Pau-brasil (from ginkgo-verao)
def build_pau_brasil():
    meshes = import_glb_meshes(ARV_DIR / "ginkgo-verao" / "ginkgo-verao.glb")
    leaves = next(o for o in meshes if "Leaves" in o.name)
    trunk = next(o for o in meshes if "Tree" in o.name)
    decimate_mesh_obj(trunk, target_tris=110)
    map_trunk_uvs(trunk, 1, 0)
    subsample_and_scale_leaf_cards(
        leaves,
        target_cards=166,
        card_scale=2.35,
        tile_col=1,
        tile_row=3,
        alt_top_tile=(0, 3),
        alt_top_frac=0.35,
    )
    return join_and_finalize_tree(trunk, leaves, "pau-brasil", target_height=11.5)


# --------------------------------------------------------------------------- 3. Ipê-rosa (from arvore-rosa)
def build_ipe_rosa():
    meshes = import_glb_meshes(ARV_DIR / "arvore-rosa" / "arvore-rosa.glb")
    trunk = next(o for o in meshes if o.data.materials and "Trunk" in o.data.materials[0].name)
    leaves = next(o for o in meshes if o != trunk)
    decimate_mesh_obj(trunk, target_tris=106)
    map_trunk_uvs(trunk, 0, 0)
    subsample_and_scale_leaf_cards(
        leaves,
        target_cards=80,
        card_scale=1.95,
        tile_col=2,
        tile_row=3,
        uv_mode="arvore_rosa",
    )
    root = join_and_finalize_tree(trunk, leaves, "ipe-rosa", target_height=11.0)
    add_fallen_blossom_child(root, 2, 3)
    return root


# --------------------------------------------------------------------------- 4. Jequitibá-rosa (from pacote-copa-camadas main.010)
def build_jequitiba_rosa():
    meshes = import_glb_meshes(ARV_DIR / "pacote-copa-camadas" / "pacote-copa-camadas.glb")
    trunk = next(o for o in meshes if "main.010_tronco" in o.name)
    leaves = next(o for o in meshes if "main.010_folhas" in o.name)
    for o in list(meshes):
        if o not in (trunk, leaves):
            bpy.data.objects.remove(o, do_unlink=True)
    decimate_mesh_obj(trunk, target_tris=190)
    map_trunk_uvs(trunk, 0, 0)
    subsample_and_scale_leaf_cards(
        leaves,
        target_cards=20,
        card_scale=1.28,
        tile_col=3,
        tile_row=3,
        uv_mode="copa_camadas",
        merge_dist=0.002,
    )
    return join_and_finalize_tree(trunk, leaves, "jequitiba-rosa", target_height=18.0)


# --------------------------------------------------------------------------- 5. Palmeira-juçara (from palmeiras-psx + cacho-frutos)
def build_palmeira_jucara():
    meshes = import_glb_meshes(ARV_DIR / "palmeiras-psx" / "palmeiras-psx.glb")
    trunk = next(o for o in meshes if o.name.startswith("trunk_bark"))
    leaves = next(o for o in meshes if o.name.startswith("leaves_leaf"))
    for o in list(meshes):
        if o not in (trunk, leaves):
            bpy.data.objects.remove(o, do_unlink=True)

    decimate_mesh_obj(trunk, target_tris=96)
    map_trunk_uvs(trunk, 2, 0, crownshaft_top_frac=0.22)
    subsample_and_scale_leaf_cards(
        leaves,
        target_cards=9,
        card_scale=1.12,
        tile_col=0,
        tile_row=2,
        uv_mode="psx_palm",
        merge_dist=0.002,
    )
    root = join_and_finalize_tree(trunk, leaves, "palmeira-jucara", target_height=8.0)

    # Add purple juçara fruit bunch child node (`cacho-frutos`) at the base of the green crownshaft (z = 5.1 u)
    anchor = Vector((-0.0063, -0.10, 5.10))
    cm = C.Mesh("cacho-frutos")
    stem_uv = [tile_uv(0, 0, 0.2, 0.2), tile_uv(0, 0, 0.8, 0.2), tile_uv(0, 0, 0.8, 0.8), tile_uv(0, 0, 0.2, 0.8)]
    berry_uv = [tile_uv(3, 0, 0.1, 0.88), tile_uv(3, 0, 0.4, 0.88), tile_uv(3, 0, 0.4, 0.96), tile_uv(3, 0, 0.1, 0.96)]
    out_dir = Vector((-0.55, -0.83, 0)).normalized()
    end = anchor + out_dir * 0.45 + Vector((0, 0, -0.22))
    cm.prism(anchor, end, 0.07, 0.05, 4, "#d8dad6", cap0=False, uv=stem_uv)
    for k, (dx, dy, drop, r) in enumerate([(-0.18, -0.28, 0.55, 0.14), (0.05, -0.36, 0.62, 0.14), (-0.08, -0.20, 0.48, 0.13)]):
        p = anchor + Vector((dx, dy, -drop))
        rot = Euler((0.2 * k, 0.3 * k, 0.5 * k), "XYZ").to_matrix()
        cm.box(p, (r, r, r * 1.15), "#d8dad6", rot=rot, uv=berry_uv)
    c_obj = C.build_object(cm, "cacho-frutos", parent=root, pivot=anchor, material=root.data.materials[0])
    for poly in c_obj.data.polygons:
        poly.use_smooth = False
    return root


# --------------------------------------------------------------------------- 6. Jerivá (from jeriva-queen-palm Syagrus romanzoffiana)
def build_jeriva():
    meshes = import_glb_meshes(ARV_DIR / "jeriva-queen-palm" / "jeriva-queen-palm.glb")
    src = meshes[0]
    bake_world_into_mesh(src)

    # Separate trunk + persistent leaf bases from the 11 fronds
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bm.faces.ensure_lookup_table()

    visited = set()
    trunk_faces = []
    frond_spines = []
    for f in bm.faces:
        if f.index in visited:
            continue
        st = [f]
        visited.add(f.index)
        comp = []
        verts = set()
        while st:
            cur = st.pop()
            comp.append(cur)
            for v in cur.verts:
                verts.add(v)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in visited:
                        visited.add(nf.index)
                        st.append(nf)
        tris = sum(len(f2.verts) - 2 for f2 in comp)
        v_list = list(verts)
        if tris == 208 or tris == 10:
            trunk_faces.extend(comp)
        elif tris >= 200:
            # Extract the 3D frond spine from the Queen Palm frond geometry!
            v_sorted = sorted(v_list, key=lambda v: math.hypot(v.co.x, v.co.y))
            n = len(v_sorted)
            p0 = sum((v.co for v in v_sorted[: max(1, n // 8)]), Vector()) / max(1, n // 8)
            p1 = sum((v.co for v in v_sorted[n // 4 : n // 2]), Vector()) / max(1, (n // 2 - n // 4))
            p2 = sum((v.co for v in v_sorted[n // 2 : 3 * n // 4]), Vector()) / max(1, (3 * n // 4 - n // 2))
            p3 = sum((v.co for v in v_sorted[7 * n // 8 :]), Vector()) / max(1, (n - 7 * n // 8))
            frond_spines.append((p0, p1, p2, p3))

    # Keep only trunk + sheath faces on `src`
    keep_f = set(trunk_faces)
    del_f = [f for f in bm.faces if f not in keep_f]
    if del_f:
        bmesh.ops.delete(bm, geom=del_f, context="FACES")
    bm.to_mesh(src.data)
    bm.free()
    src.data.update()
    decimate_mesh_obj(src, target_tris=126, merge_dist=0.001)
    map_trunk_uvs(src, 2, 0)

    # Build painted plumose fronds along the exact Queen Palm frond spines + golden fruit clusters
    fm = C.Mesh("jeriva-fronds")
    frond_uv0 = [tile_uv(0, 2, 0.35, 0.04), tile_uv(0, 2, 0.88, 0.25), tile_uv(0, 2, 0.88, 0.65), tile_uv(0, 2, 0.50, 0.52)]
    frond_uv1 = [tile_uv(0, 2, 0.50, 0.52), tile_uv(0, 2, 0.88, 0.65), tile_uv(0, 2, 0.75, 0.94), tile_uv(0, 2, 0.50, 0.97)]
    frond_uvL0 = [tile_uv(0, 2, 0.65, 0.04), tile_uv(0, 2, 0.50, 0.52), tile_uv(0, 2, 0.12, 0.65), tile_uv(0, 2, 0.12, 0.25)]
    frond_uvL1 = [tile_uv(0, 2, 0.50, 0.52), tile_uv(0, 2, 0.50, 0.97), tile_uv(0, 2, 0.25, 0.94), tile_uv(0, 2, 0.12, 0.65)]
    cluster_uv = [tile_uv(3, 2, 0.08, 0.08), tile_uv(3, 2, 0.92, 0.08), tile_uv(3, 2, 0.92, 0.92), tile_uv(3, 2, 0.08, 0.92)]
    fruit_uv = [tile_uv(3, 0, 0.58, 0.88), tile_uv(3, 0, 0.92, 0.88), tile_uv(3, 0, 0.92, 0.96), tile_uv(3, 0, 0.58, 0.96)]

    for idx, (p0, p1, p2, p3) in enumerate(frond_spines):
        d = Vector((p3.x - p0.x, p3.y - p0.y, 0.0))
        d = d.normalized() if d.length > 1e-4 else Vector((1, 0, 0))
        side = Vector((-d.y, d.x, 0.0))
        w1 = 0.95
        w2 = 0.82
        up1 = Vector((0, 0, 0.35))
        # V-keeled two-segment painted pinnate frond (8 tris per frond)
        fm.add([p0, p1 + side * w1 - up1, p2 + side * w2 - up1, p1], "#d8dad6", uv=frond_uv0)
        fm.add([p1, p2 + side * w2 - up1, p3, p2], "#d8dad6", uv=frond_uv1)
        fm.add([p0, p1, p2 - side * w2 - up1, p1 - side * w1 - up1], "#d8dad6", uv=frond_uvL0)
        fm.add([p1, p2, p3, p2 - side * w2 - up1], "#d8dad6", uv=frond_uvL1)
        # Cross-plane ruffled plumose leaflet card along the mid-frond so Syagrus romanzoffiana reads feathery
        c_mid = (p1 + p2) * 0.5
        fm.add(
            [
                c_mid - d * 0.85 - Vector((0, 0, 0.55)),
                c_mid + d * 0.85 - Vector((0, 0, 0.45)),
                c_mid + d * 0.75 + Vector((0, 0, 0.65)),
                c_mid - d * 0.75 + Vector((0, 0, 0.55)),
            ],
            "#d8dad6",
            uv=cluster_uv,
        )

    # Golden-orange jerivá fruit bunches hanging below the crown collar
    for az in (0.7, 3.8):
        fd = Vector((math.cos(az), math.sin(az), 0))
        for drop, r in ((0.45, 0.34), (0.85, 0.30)):
            fm.box(Vector((0, 0, 8.6 - drop)) + fd * 0.58, (r, r, r * 1.2), "#d8dad6", uv=fruit_uv)

    leaves_obj = C.build_object(fm, "jeriva-leaves")
    return join_and_finalize_tree(src, leaves_obj, "jeriva", target_height=11.0)


# --------------------------------------------------------------------------- 7. Mangue-vermelho (from mangue-alto + mangue-a)
def build_mangue_vermelho():
    m_alto = import_glb_meshes(ARV_DIR / "mangue-alto" / "mangue-alto.glb")
    trunk = next(o for o in m_alto if "Bark" in o.name)
    leaves_alto = next(o for o in m_alto if "Leaves" in o.name)
    bake_world_into_mesh(trunk)
    bake_world_into_mesh(leaves_alto)

    # Widen the prop roots base of mangue-alto so the stilt roots read boldly at 8.5 u scale
    zs = [v.co.z for v in trunk.data.vertices]
    z0, z1 = min(zs), max(zs)
    for v in trunk.data.vertices:
        t = (v.co.z - z0) / max(0.1, z1 - z0)
        if t < 0.38:
            flare = 1.0 + 0.55 * (1.0 - t / 0.38)
            v.co.x *= flare
            v.co.y *= flare
    trunk.data.update()
    decimate_mesh_obj(trunk, target_tris=142)
    map_trunk_uvs(trunk, 1, 0)

    # Also import mangue-a leaf cards to enrich the mangrove canopy volume
    m_a = import_glb_meshes(ARV_DIR / "mangue-a" / "mangue-a.glb")
    leaves_a = next(o for o in m_a if o.data.materials and "Leaves" in o.data.materials[0].name)
    for o in list(m_a):
        if o != leaves_a:
            bpy.data.objects.remove(o, do_unlink=True)
    bake_world_into_mesh(leaves_a)

    # Fit leaves_a into leaves_alto's crown bounding box and merge before stratified subsampling
    pts_alto = [v.co for v in leaves_alto.data.vertices]
    alo = Vector((min(v.x for v in pts_alto), min(v.y for v in pts_alto), min(v.z for v in pts_alto)))
    ahi = Vector((max(v.x for v in pts_alto), max(v.y for v in pts_alto), max(v.z for v in pts_alto)))
    ac = (alo + ahi) * 0.5

    pts_a = [v.co for v in leaves_a.data.vertices]
    blo = Vector((min(v.x for v in pts_a), min(v.y for v in pts_a), min(v.z for v in pts_a)))
    bhi = Vector((max(v.x for v in pts_a), max(v.y for v in pts_a), max(v.z for v in pts_a)))
    bc = (blo + bhi) * 0.5
    scale_a = (ahi - alo).length / max(0.1, (bhi - blo).length) * 0.85
    for v in leaves_a.data.vertices:
        v.co = ac + (v.co - bc) * scale_a
    # Reset leaves_a UVs to unit quad per face so they map cleanly to tile (1, 2)
    uv_a = leaves_a.data.uv_layers.active or leaves_a.data.uv_layers.new(name="UVMap")
    unit_q = [(0.05, 0.05), (0.95, 0.05), (0.95, 0.95), (0.05, 0.95)]
    for poly in leaves_a.data.polygons:
        for idx_l, li in enumerate(poly.loop_indices):
            uv_a.data[li].uv = unit_q[idx_l % 4]

    bpy.ops.object.select_all(action="DESELECT")
    leaves_alto.select_set(True)
    leaves_a.select_set(True)
    bpy.context.view_layer.objects.active = leaves_alto
    bpy.ops.object.join()

    subsample_and_scale_leaf_cards(leaves_alto, target_cards=148, card_scale=1.55, tile_col=1, tile_row=2)
    return join_and_finalize_tree(trunk, leaves_alto, "mangue-vermelho", target_height=8.5)


# --------------------------------------------------------------------------- 8. Custom trees & ground cover UV-mapped to foliage-atlas.png
def apply_atlas_uvs_to_custom_object(ob: bpy.types.Object, kind: str) -> bpy.types.Object:
    """
    UV-map our custom models (`araucaria`, `embauba`, `xaxim`, and the 5 ground-cover v2
    models `bromelia`, `bromelia-centro-vermelho`, `samambaia`, `flores-mata`, `serapilheira`)
    onto the shared 512x512 `foliage-atlas.png` and neutralize `COLOR_0` to the lighting/AO
    multiplier so `foliage-atlas * COLOR_0` displays rich hand-painted leaves, fronds, and litter!
    """
    import colorsys

    bpy.context.view_layer.update()
    mat = make_atlas_material(f"Atlas_{kind}", alpha_clip=True)
    foliage_hexes = {h.lower() for h in (*C.RAMPS["leaf"], *C.RAMPS["grass"], C.ACCENT["ipeAmarelo"], C.ACCENT["ipeRosa"], C.RAMPS["rock"][3])}

    for m_obj in [o for o in [ob, *ob.children_recursive] if o.type == "MESH"]:
        me = m_obj.data
        uv_lay = me.uv_layers.active or me.uv_layers.new(name="UVMap")
        col_attr = me.color_attributes.active_color or me.color_attributes[0]
        co = [m_obj.matrix_world @ v.co for v in me.vertices]
        lo = Vector((min(v.x for v in co), min(v.y for v in co), min(v.z for v in co)))
        hi = Vector((max(v.x for v in co), max(v.y for v in co), max(v.z for v in co)))
        ctr = (lo + hi) * 0.5
        z_span = max(0.05, hi.z - lo.z)
        r_xy = max(0.15, math.hypot(hi.x - lo.x, hi.y - lo.y) * 0.5)

        for poly in me.polygons:
            li0 = poly.loop_indices[0]
            sr, sg, sb, _ = col_attr.data[li0].color_srgb
            h_val, l_val, s_val = colorsys.rgb_to_hls(sr, sg, sb)
            h_hex = "#%02x%02x%02x" % (int(round(sr * 255)), int(round(sg * 255)), int(round(sb * 255)))
            avg_z = sum(co[me.loops[li].vertex_index].z for li in poly.loop_indices) / poly.loop_total

            # Pick atlas tile based on asset kind & polygon role
            if kind == "serapilheira":
                t_col, t_row = (3, 1)
                planar = True
            elif kind in ("bromelia", "bromelia-centro-vermelho"):
                if h_val < 0.08 or h_val > 0.90:
                    t_col, t_row = (2, 1)  # crimson bract
                else:
                    t_col, t_row = (1, 1)  # channelled green bromeliad leaf
                planar = False
            elif kind == "samambaia":
                t_col, t_row = (0, 1)  # FabinhoSC bigfernleaf with alpha!
                planar = False
            elif kind == "flores-mata":
                if 0.18 <= h_val <= 0.48:
                    t_col, t_row = (1, 1)  # tropical leaf
                elif 0.09 <= h_val < 0.18:
                    t_col, t_row = (0, 3)  # yellow flower
                else:
                    t_col, t_row = (2, 3)  # pink/red flower
                planar = False
            elif kind == "xaxim":
                if 0.18 <= h_val <= 0.48 and s_val > 0.16:
                    t_col, t_row = (0, 1)  # FabinhoSC bigfernleaf with alpha!
                    planar = False
                else:
                    t_col, t_row = (3, 0)  # fibrous dark xaxim caudex
                    planar = False
            elif kind == "embauba":
                if (h_hex in foliage_hexes or (0.18 <= h_val <= 0.48 and s_val > 0.16)) and avg_z > 5.2:
                    t_col, t_row = (3, 2) if poly.loop_total == 4 and poly.area < 1.2 else (2, 2)
                    planar = poly.loop_total > 4
                else:
                    t_col, t_row = (2, 0)  # ringed grey stipe
                    planar = False
            else:  # araucaria
                if (h_hex in foliage_hexes or (0.18 <= h_val <= 0.48 and s_val > 0.16)) and avg_z > 6.5:
                    t_col, t_row = (3, 2) if poly.loop_total == 4 and poly.area < 1.1 else (2, 2)
                    planar = True
                else:
                    t_col, t_row = (0, 0)  # brown bark
                    planar = False

            # Assign UV coordinates inside (t_col, t_row)
            quad_uvs = [(0.12, 0.08), (0.88, 0.08), (0.88, 0.92), (0.12, 0.92)]
            for idx_l, li in enumerate(poly.loop_indices):
                v = co[me.loops[li].vertex_index]
                if planar:
                    u_loc = 0.5 + (v.x - ctr.x) / max(0.3, hi.x - lo.x)
                    v_loc = 0.5 + (v.y - ctr.y) / max(0.3, hi.y - lo.y)
                elif (t_col, t_row) in ((0, 1), (1, 1), (2, 1), (3, 2)) and poly.loop_total == 4:
                    u_loc, v_loc = quad_uvs[idx_l % 4]
                elif t_row == 0:
                    ang = (math.atan2(v.y - ctr.y, v.x - ctr.x) / (2 * math.pi)) + 0.5
                    tz = ((v.z - lo.z) / z_span) % 0.48
                    u_loc, v_loc = ang, tz
                else:
                    u_loc, v_loc = quad_uvs[idx_l % 4]
                uv_lay.data[li].uv = tile_uv(t_col, t_row, u_loc, v_loc)

                # Set COLOR_0 to neutral lighting + AO multiplier (0.68..1.0) so texture colour shines through
                tz_v = max(0.0, min(1.0, (v.z - lo.z) / z_span))
                tr_v = max(0.0, min(1.0, math.hypot(v.x - ctr.x, v.y - ctr.y) / r_xy))
                u_g = 0.65 * tz_v + 0.35 * tr_v
                r_c = max(0.15, min(0.89, 0.66 + 0.23 * u_g))
                g_c = max(0.15, min(0.89, 0.72 + 0.17 * u_g))
                b_c = max(0.15, min(0.89, 0.78 + 0.09 * u_g))
                col_attr.data[li].color_srgb = (r_c, g_c, b_c, 1.0)

        me.materials.clear()
        me.materials.append(mat)
        me.update()
    return ob


def main() -> None:
    import araucaria
    import bromelia
    import embauba
    import ground_cover_v2
    import xaxim

    # 1. 7 CC BY adapted trees
    cc_by_trees = [
        (build_ipe_amarelo, "ipe-amarelo", 450, "~11.0 u (canopy)"),
        (build_pau_brasil, "pau-brasil", 450, "~11.5 u (canopy)"),
        (build_ipe_rosa, "ipe-rosa", 450, "~11.0 u (canopy)"),
        (build_jequitiba_rosa, "jequitiba-rosa", 700, "~18.0 u (emergent)"),
        (build_palmeira_jucara, "palmeira-jucara", 450, "~8.0 u (understorey palm)"),
        (build_jeriva, "jeriva", 450, "~11.0 u (Syagrus romanzoffiana)"),
        (build_mangue_vermelho, "mangue-vermelho", 450, "~8.5 u (mangrove with prop roots)"),
    ]
    for fn, name, budget, target in cc_by_trees:
        C.run(fn, name=name, budget=budget, target=target, preview_kw=C.TREE_VIEW)

    # 2. 3 custom trees with painted foliage-atlas UVs
    custom_trees = [
        (lambda: apply_atlas_uvs_to_custom_object(araucaria.build(), "araucaria"), "araucaria", 450, "12-14 u (canopy)"),
        (lambda: apply_atlas_uvs_to_custom_object(embauba.build(), "embauba"), "embauba", 450, "~10 u (canopy)"),
        (lambda: apply_atlas_uvs_to_custom_object(xaxim.build(), "xaxim"), "xaxim", 450, "~6 u (understorey)"),
    ]
    for fn, name, budget, target in custom_trees:
        C.run(fn, name=name, budget=budget, target=target, preview_kw=C.TREE_VIEW)

    # 3. 5 ground-cover v2 models with painted foliage-atlas UVs
    small = {"elevation_deg": 24.0, "closeup": True, "res": (900, 900)}
    covers = [
        (lambda: apply_atlas_uvs_to_custom_object(bromelia.build_variant(False, "bromelia")(), "bromelia"), "bromelia", 150, "~1 u bromeliad"),
        (lambda: apply_atlas_uvs_to_custom_object(bromelia.build_variant(True, "bromelia-centro-vermelho")(), "bromelia-centro-vermelho"), "bromelia-centro-vermelho", 150, "~1 u red bromeliad"),
        (lambda: apply_atlas_uvs_to_custom_object(ground_cover_v2.build_samambaia(), "samambaia"), "samambaia", 150, "~0.85 u fern"),
        (lambda: apply_atlas_uvs_to_custom_object(ground_cover_v2.build_flores_mata(), "flores-mata"), "flores-mata", 150, "~0.75 u wildflowers"),
        (lambda: apply_atlas_uvs_to_custom_object(ground_cover_v2.build_serapilheira(), "serapilheira"), "serapilheira", 150, "~2.2 u leaf-litter"),
    ]
    for fn, name, budget, target in covers:
        C.run(fn, name=name, budget=budget, target=target, preview_kw=small)


if __name__ == "__main__":
    main()
