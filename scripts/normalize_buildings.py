# Headless Blender worker for blender-normalize.mjs — do not run directly.
#   blender --background --factory-startup --python scripts/normalize_buildings.py -- <placement.json>
#
# For each entry: import the Meshy GLB, join to one mesh, decimate to targetTris, then
# force-fit to the placement computed in node land: local X -> street-facing width,
# local Y -> depth, local Z -> floors height (the glTF importer maps the image-front
# +Z to Blender -Y), base snapped to ground, yaw = placement rotY (world-Y yaw == Blender-Z
# yaw under the importer's axis swap). Exports one GLB with all buildings.
import bpy, json, sys, math
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
plan = json.load(open(argv[0], encoding='utf-8'))
TARGET = plan.get('targetTris', 3000)

# factory startup still ships a default scene — start empty
bpy.ops.wm.read_homefile(use_empty=True)

def log(msg):
    print(f'[normalize] {msg}', flush=True)

for b in plan['buildings']:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=b['glb'])
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        log(f"{b['id']}: NO MESH in {b['glb']}, skipping")
        for o in imported: bpy.data.objects.remove(o, do_unlink=True)
        continue

    # bake world transforms (importer axis conversion, node hierarchy) into the mesh data
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in imported:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    # join into a single object
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = f"bld_{b['id']}"
    obj.data.name = obj.name

    # the glTF importer sets custom split normals; after Decimate they go stale and
    # crash the 4.1 exporter (EXCEPTION_ACCESS_VIOLATION) — drop them first
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mesh.customdata_custom_splitnormals_clear()

    # decimate to the tri budget
    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    if tris > TARGET * 1.2:
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = TARGET / tris
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # decimate can leave invalid loops that crash the 4.1 glTF exporter —
        # validate + retriangulate repairs the mesh (both are needed)
        obj.data.validate(verbose=False)
        tri_mod = obj.modifiers.new('tri', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=tri_mod.name)
        obj.data.calc_loop_triangles()
    tris_out = len(obj.data.loop_triangles)

    # normalize: center XY on origin, base on z=0, then force-fit to footprint + height
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    dim = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    if min(dim) < 1e-6:
        log(f"{b['id']}: degenerate mesh {dim}, skipping")
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    center = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs))
    # The pano bearing picks the front OBB axis, but it can be 90-deg wrong (corner panos,
    # row-houses). Try both pairings of mesh XY -> footprint axes and keep the one that
    # distorts the mesh's own proportions least; the swap turns the yaw by 90 deg.
    s_a = (b['width'] / dim[0], b['depth'] / dim[1])
    s_b = (b['depth'] / dim[0], b['width'] / dim[1])
    ratio = lambda s: max(s) / min(s)
    swap = ratio(s_b) < ratio(s_a)
    sx, sy = s_b if swap else s_a
    sz = b['height'] / dim[2]
    rot_z = b['rotYAlt'] if swap else b['rotY']
    M = (Matrix.Diagonal((sx, sy, sz, 1.0)) @
         Matrix.Translation((-center[0], -center[1], -center[2])))
    obj.data.transform(M)
    if swap:
        log(f"{b['id']}: front axis swapped 90deg (pairing distortion {ratio(s_a):.2f} -> {ratio(s_b):.2f})")
    aniso = max(sx, sy, sz) / min(sx, sy, sz)
    if aniso > 1.6:
        log(f"{b['id']}: WARN anisotropic fit x{aniso:.2f} (sx={sx:.2f} sy={sy:.2f} sz={sz:.2f})")

    obj.rotation_euler = (0, 0, rot_z)
    obj.location = (b['cx'], -b['cz'], 0)
    log(f"{b['id']}: {tris}->{tris_out} tris, fit {b['width']:.1f}x{b['depth']:.1f}x{b['height']:.1f}m")

bpy.ops.object.select_all(action='SELECT')
if not bpy.context.selected_objects:
    log('nothing survived, aborting export')
    sys.exit(2)
bpy.ops.export_scene.gltf(filepath=plan['out'], export_format='GLB')
log(f"exported {plan['out']}")
