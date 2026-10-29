#!/usr/bin/env python3
"""One-off asset pipeline: turns the raw DABSy layers + wallpapers into optimized web assets.
Run: python3 scripts/prepare-assets.py <wallpaper-dir>
Outputs to public/assets/{char,scenes}. Not part of the normal build (assets are committed)."""
import sys, json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src')
OUT = os.path.join(ROOT, 'public', 'assets')
os.makedirs(os.path.join(OUT, 'char'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'scenes'), exist_ok=True)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

# ---------- eyes: JPG on near-black -> two clean alpha cut-outs ----------
eyes = np.array(Image.open(os.path.join(SRC, 'eyes.jpg')).convert('RGB')).astype(float)
L = eyes.mean(axis=2)
binary = ndi.binary_fill_holes(L > 60)
lab, n = ndi.label(binary)
sizes = ndi.sum(binary, lab, range(1, n + 1))
keep = np.argsort(sizes)[::-1][:2] + 1
parts = []
for k in keep:
    m = lab == k
    ys, xs = np.where(m)
    parts.append((xs.min(), xs.max(), ys.min(), ys.max(), m))
parts.sort(key=lambda p: p[0])  # left, right
meta = {}
for name, (x0, x1, y0, y1, m) in zip(['eye-l', 'eye-r'], parts):
    pad = 8
    box = (max(x0 - pad, 0), max(y0 - pad, 0), x1 + pad, y1 + pad)
    sub = eyes[box[1]:box[3], box[0]:box[2]]
    mm = m[box[1]:box[3], box[0]:box[2]].astype(float)
    # clean antialiased edge from a smoothed mask (kills the JPEG speckle on the rim)
    sm = ndi.gaussian_filter(mm, 2.2)
    alpha = smoothstep(0.42, 0.58, sm)
    # colour: replace edge-band pixels with nearest interior colour (no dark fringe)
    interior = ndi.binary_erosion(mm > 0.5, iterations=10)
    idx = ndi.distance_transform_edt(~interior, return_distances=False, return_indices=True)
    col = sub[idx[0], idx[1]]
    edge = ndi.distance_transform_edt(mm > 0.5)
    blend = smoothstep(4, 14, edge)[..., None]
    col = col * (1 - blend) + sub * blend
    rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    bb = im.getbbox(); im = im.crop(bb)
    w = 170; h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    im.save(os.path.join(OUT, 'char', name + '.webp'), quality=92, method=6)
    meta[name] = {'w': w, 'h': h}

# ---------- body (already RGBA). Defringe: bleed colour outward so alpha edges don't go dark ----------
body = Image.open(os.path.join(SRC, 'body.png')).convert('RGBA')
a = np.array(body).astype(float)
alpha = a[..., 3]
solid = alpha > 200
idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
rgb = a[..., :3][idx[0], idx[1]]
out = np.dstack([rgb, alpha]).astype(np.uint8)
body = Image.fromarray(out, 'RGBA')
bb = body.getbbox(); body = body.crop(bb)
meta['body_bbox_in_src'] = list(bb)
w = 680; h = round(body.height * w / body.width)
body.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, 'char', 'body.webp'), quality=90, method=6)
meta['body'] = {'w': w, 'h': h}

# ---------- bow ----------
bow = Image.open(os.path.join(SRC, 'bow.png')).convert('RGBA')
bow = bow.crop(bow.getbbox())
w = 240; h = round(bow.height * w / bow.width)
bow.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, 'char', 'bow.webp'), quality=92, method=6)
meta['bow'] = {'w': w, 'h': h}

# ---------- wallpapers ----------
if len(sys.argv) > 1:
    wp = sys.argv[1]
    names = {  # file suffix -> scene/time
        '481': ('bedroom', 'day'), '482': ('bedroom', 'night'),
        '483': ('garden', 'day'), '484': ('garden', 'night'),
        '485': ('cabin', 'day'), '486': ('cabin', 'night'),
        '487': ('study', 'day'), '488': ('study', 'night'),
    }
    for f in sorted(os.listdir(wp)):
        for key, (scene, tod) in names.items():
            if f.endswith(key + '.png'):
                im = Image.open(os.path.join(wp, f)).convert('RGB')
                if im.width > 1080:
                    im = im.resize((1080, round(im.height * 1080 / im.width)), Image.LANCZOS)
                dest = os.path.join(OUT, 'scenes', f'{scene}-{tod}.webp')
                im.save(dest, quality=80, method=6)
                meta[f'{scene}-{tod}'] = list(im.size)
json.dump(meta, open(os.path.join(SRC, 'asset-meta.json'), 'w'), indent=1, default=int)
print(json.dumps(meta, indent=1, default=int))
