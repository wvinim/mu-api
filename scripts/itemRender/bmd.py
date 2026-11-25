import struct, os, io, math
import numpy as np
from PIL import Image

ITEM_DIR = r"C:\projects\MuPRO\client\Bin\Data\Item"


def angle_quat(a):
    sy, cy = math.sin(a[2] * .5), math.cos(a[2] * .5)
    sp, cp = math.sin(a[1] * .5), math.cos(a[1] * .5)
    sr, cr = math.sin(a[0] * .5), math.cos(a[0] * .5)
    return (sr*cp*cy-cr*sp*sy, cr*sp*cy+sr*cp*sy, cr*cp*sy-sr*sp*cy, cr*cp*cy+sr*sp*sy)


def quat_mat(q, pos):
    x, y, z, w = q
    m = np.eye(4)
    m[0, 0] = 1-2*y*y-2*z*z; m[1, 0] = 2*x*y+2*w*z; m[2, 0] = 2*x*z-2*w*y
    m[0, 1] = 2*x*y-2*w*z; m[1, 1] = 1-2*x*x-2*z*z; m[2, 1] = 2*y*z+2*w*x
    m[0, 2] = 2*x*z+2*w*y; m[1, 2] = 2*y*z-2*w*x; m[2, 2] = 1-2*x*x-2*y*y
    m[:3, 3] = pos
    return m


def find_file(name):
    low = name.lower()
    for f in os.listdir(ITEM_DIR):
        if f.lower() == low:
            return os.path.join(ITEM_DIR, f)
    return None


def load_texture(fname):
    base = os.path.splitext(fname)[0]
    ext = os.path.splitext(fname)[1].lower()
    order = ['.ozt', '.ozj'] if ext == '.tga' else ['.ozj', '.ozt']
    for e in order:
        p = find_file(base + e)
        if p:
            data = open(p, 'rb').read()
            if e == '.ozj':
                im = Image.open(io.BytesIO(data[24:])).convert('RGBA')
            else:
                raw = data[4:]
                im = Image.open(io.BytesIO(raw)).convert('RGBA')
                # MU OZT is stored bottom-up like standard TGA; PIL handles orientation
            return np.asarray(im).astype(np.float32) / 255.0, p
    return None, None


def load_bmd(name):
    path = find_file(name + '.bmd')
    d = open(path, 'rb').read()
    assert d[:3] == b'BMD' and d[3] == 10, (name, d[:4])
    p = 4 + 32
    nm, nb, na = struct.unpack_from('<hhh', d, p); p += 6
    meshes = []
    for _ in range(nm):
        nv, nn, nt, ntri, tex = struct.unpack_from('<hhhhh', d, p); p += 10
        verts = []
        for i in range(nv):
            node, x, y, z = struct.unpack_from('<h2xfff', d, p); p += 16
            verts.append((node, x, y, z))
        norms = []
        for i in range(nn):
            node, x, y, z, bv = struct.unpack_from('<h2xfffh2x', d, p); p += 20
            norms.append((node, x, y, z))
        tcs = []
        for i in range(nt):
            tcs.append(struct.unpack_from('<ff', d, p)); p += 8
        tris = []
        for i in range(ntri):
            poly = d[p]
            vi = struct.unpack_from('<4h', d, p + 2)
            ni = struct.unpack_from('<4h', d, p + 10)
            ti = struct.unpack_from('<4h', d, p + 18)
            tris.append((poly, vi, ni, ti)); p += 64
        texname = d[p:p+32].split(b'\0')[0].decode('latin1'); p += 32
        meshes.append(dict(verts=verts, norms=norms, tcs=tcs, tris=tris, tex=texname))
    actions = []
    for _ in range(na):
        keys = struct.unpack_from('<h', d, p)[0]; p += 2
        lock = d[p]; p += 1
        if lock:
            p += keys * 12
        actions.append(keys)
    bones = []
    for _ in range(nb):
        dummy = d[p]; p += 1
        if dummy:
            bones.append(None); continue
        bname = d[p:p+32].split(b'\0')[0]; p += 32
        parent = struct.unpack_from('<h', d, p)[0]; p += 2
        first = None
        for keys in actions:
            pos = struct.unpack_from('<3f', d, p); p += keys * 12
            rot = struct.unpack_from('<3f', d, p); p += keys * 12
            if first is None:
                first = (pos, rot)
        bones.append(dict(parent=parent, pos=first[0], rot=first[1]))
    # bone transforms
    mats = []
    for b in bones:
        if b is None:
            mats.append(np.eye(4)); continue
        m = quat_mat(angle_quat(b['rot']), b['pos'])
        if b['parent'] >= 0:
            m = mats[b['parent']] @ m
        mats.append(m)
    out = []
    for m in meshes:
        V = np.array([(mats[n] @ np.array([x, y, z, 1]))[:3] for n, x, y, z in m['verts']]) if m['verts'] else np.zeros((0, 3))
        N = np.array([mats[n][:3, :3] @ np.array([x, y, z]) for n, x, y, z in m['norms']]) if m['norms'] else np.zeros((0, 3))
        T = np.array(m['tcs']) if m['tcs'] else np.zeros((0, 2))
        tris = []
        for poly, vi, ni, ti in m['tris']:
            tris.append((vi[0], vi[1], vi[2], ni[0], ni[1], ni[2], ti[0], ti[1], ti[2]))
            if poly == 4:
                tris.append((vi[0], vi[2], vi[3], ni[0], ni[2], ni[3], ti[0], ti[2], ti[3]))
        out.append(dict(V=V, N=N, T=T, tris=np.array(tris, dtype=int).reshape(-1, 9), tex=m['tex']))
    return out


if __name__ == '__main__':
    import sys
    for n in sys.argv[1:]:
        ms = load_bmd(n)
        allv = np.vstack([m['V'] for m in ms if len(m['V'])])
        print(n, len(ms), 'meshes', [m['tex'] for m in ms], 'min', allv.min(0).round(1), 'max', allv.max(0).round(1))
