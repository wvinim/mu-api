import math, sys, json
import numpy as np
from PIL import Image
from bmd import load_bmd, load_texture

W, H = 92, 119
SS = 4


def rot(axis, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    if axis == 'x': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def background():
    y = np.arange(H, dtype=np.float32)
    v = np.where(y < 27, 32.0, 32.0 + (y - 27) * (122 - 32) / (H - 1 - 27))
    bg = np.repeat(v[:, None], W, axis=1)
    return np.stack([bg] * 3, -1) / 255.0


def render(model, steps, out, margin=6, box=None, yoff=0, light=(-0.4, 0.6, 0.7), bright=1.0, flipv_tga=False, hide=()):
    meshes = load_bmd(model)
    R = np.eye(3)
    for axis, deg in steps:
        R = rot(axis, deg) @ R
    # screen: x right, y up, z toward viewer
    allv = np.vstack([(R @ m['V'].T).T for i, m in enumerate(meshes) if len(m['V']) and i not in hide])
    mn, mx = allv.min(0), allv.max(0)
    cw, ch = ((W - 2 * margin) * SS, (H - 2 * margin) * SS) if box is None else (box[0] * SS, box[1] * SS)
    scale = min(cw / (mx[0] - mn[0]), ch / (mx[1] - mn[1]))
    cx, cy = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
    BW, BH = W * SS, H * SS
    color = np.zeros((BH, BW, 3), np.float32)
    alpha = np.zeros((BH, BW), np.float32)
    zbuf = np.full((BH, BW), -1e9, np.float32)
    L = np.array(light, float); L /= np.linalg.norm(L)
    Vdir = np.array([0, 0, 1.0])
    Hh = (L + Vdir); Hh /= np.linalg.norm(Hh)
    for mi, m in enumerate(meshes):
        if mi in hide or not len(m['tris']):
            continue
        tex, tpath = load_texture(m['tex'])
        if tex is None:
            tex = np.ones((2, 2, 4), np.float32) * 0.6
        is_tga = m['tex'].lower().endswith('.tga')
        if is_tga and flipv_tga:
            tex = tex[::-1]
        th, tw = tex.shape[:2]
        P = (R @ m['V'].T).T
        sx = (P[:, 0] - cx) * scale + BW / 2
        sy = BH / 2 + yoff * SS - (P[:, 1] - cy) * scale
        sz = P[:, 2]
        N = (R @ m['N'].T).T
        N = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-9)
        T = m['T']
        for t in m['tris']:
            v0, v1, v2, n0, n1, n2, t0, t1, t2 = t
            xs = np.array([sx[v0], sx[v1], sx[v2]]); ys = np.array([sy[v0], sy[v1], sy[v2]])
            x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, BW - 1)
            y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, BH - 1)
            if x0 > x1 or y0 > y1: continue
            den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
            if abs(den) < 1e-9: continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
            a = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
            b = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
            c = 1 - a - b
            inside = (a >= 0) & (b >= 0) & (c >= 0)
            if not inside.any(): continue
            z = a * sz[v0] + b * sz[v1] + c * sz[v2]
            zb = zbuf[y0:y1 + 1, x0:x1 + 1]
            vis = inside & (z > zb)
            if not vis.any(): continue
            u = a * T[t0, 0] + b * T[t1, 0] + c * T[t2, 0]
            v = a * T[t0, 1] + b * T[t1, 1] + c * T[t2, 1]
            tx = (np.floor(u * tw).astype(int)) % tw
            ty = (np.floor(v * th).astype(int)) % th
            texel = tex[ty, tx]
            vis = vis & (texel[..., 3] > 0.35)
            if not vis.any(): continue
            n = a[..., None] * N[n0] + b[..., None] * N[n1] + c[..., None] * N[n2]
            n = n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)
            n = np.where((n[..., 2:3] < 0), -n, n)  # two-sided
            diff = np.clip(n @ L, 0, 1)
            spec = np.clip(n @ Hh, 0, 1) ** 16
            col = texel[..., :3] * (0.55 + 0.8 * diff[..., None]) * bright + 0.35 * spec[..., None]
            cb = color[y0:y1 + 1, x0:x1 + 1]
            cb[vis] = col[vis]
            zb[vis] = z[vis]
            alpha[y0:y1 + 1, x0:x1 + 1][vis] = 1
    # downsample
    col = color.reshape(H, SS, W, SS, 3).mean((1, 3))
    al = alpha.reshape(H, SS, W, SS).mean((1, 3))[..., None]
    img = background() * (1 - al) + np.clip(col, 0, 1) * al  # col is premultiplied by coverage
    img = background() * (1 - al) + np.clip(col / np.maximum(al, 1e-6), 0, 1) * al
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out, quality=92)


if __name__ == '__main__':
    model, out = sys.argv[1], sys.argv[2]
    steps = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
    render(model, steps, out)
