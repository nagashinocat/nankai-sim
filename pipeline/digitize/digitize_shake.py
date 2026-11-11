"""Digitise 内閣府 揺れ被害率曲線 (raster charts, markers every 0.1 計測震度).

Usage: python3 digitize_shake.py <img_dir> <out_json> <overlay_dir>
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from calib import load, legend_colors, clusters, x_label_centers

I = np.round(np.arange(5.0, 7.0001, 0.1), 1)

def hgrid_rows(a):
    sat = a.max(2) - a.min(2); g = a.mean(2)
    light = (sat < 12) & (g > 150) & (g < 240)
    rows = np.isin(np.arange(a.shape[0]), np.flatnonzero(light.sum(1) > a.shape[1] * 0.4))
    return [(s + e) / 2 for s, e in clusters(rows)]

def vgrid_cols(a):
    sat = a.max(2) - a.min(2); g = a.mean(2)
    light = (sat < 12) & (g > 150) & (g < 240)
    cols = np.isin(np.arange(a.shape[1]), np.flatnonzero(light.sum(0) > a.shape[0] * 0.4))
    return [(s + e) / 2 for s, e in clusters(cols)]

def calib_wood(a):
    g = hgrid_rows(a)[1:-1]            # drop frame lines; 100%..10% (some charts also show 0%)
    assert len(g) in (10, 11), g
    pct = np.arange(100, 0 if len(g) == 10 else -1, -10)
    ky = np.polyfit(g, pct, 1)
    xs = [c for c, w in x_label_centers(a, (515, 545)) if w > 5]
    assert len(xs) == 5, xs
    kx = np.polyfit(xs, [5.0, 5.5, 6.0, 6.5, 7.0], 1)
    return ky, kx

def calib_grid(a):
    g = hgrid_rows(a)[1:-1]            # 11 lines = 100%..0%
    assert len(g) == 11, g
    ky = np.polyfit(g, np.arange(100, -1, -10), 1)
    v = vgrid_cols(a)[1:-1]
    assert len(v) == 5, v
    kx = np.polyfit(v, [5.0, 5.5, 6.0, 6.5, 7.0], 1)
    return ky, kx

def digitize(a, colors, ky, kx, legend_box, tol=48, win=4):
    """Marker centre per 0.1 step. A marker partly hidden by another series is
    re-centred from its visible edge using the series' typical marker height."""
    H, W, _ = a.shape
    inv_x = lambda xv: (xv - kx[1]) / kx[0]
    lx0, ly0, lx1, ly1 = legend_box
    masks = {}
    for name, col in colors:
        d = np.sqrt(((a - np.array(col)) ** 2).sum(2))
        m = d < tol
        m[ly0:ly1, lx0:lx1] = False
        masks[name] = m
    any_series = np.zeros(a.shape[:2], bool)
    for m in masks.values():
        any_series |= m
    # also count anti-aliased / non-white non-grid pixels as "something drawn on top"
    res, partial = {}, {}
    for name, m in masks.items():
        others = any_series & ~m
        runs = []
        for iv in I:
            cx = int(round(inv_x(iv)))
            sl = slice(max(cx - win, 0), cx + win + 1)
            ys = np.flatnonzero(m[:, sl].any(1))
            if ys.size == 0:
                runs.append(None); continue
            rr = clusters(np.isin(np.arange(H), ys), min_gap=1)
            runs.append((max(rr, key=lambda r: r[1] - r[0]), sl))
        lens = [r[0][1] - r[0][0] + 1 for r in runs if r]
        typical = float(np.median(lens))
        vals, part = [], []
        for r in runs:
            if r is None:
                vals.append(None); part.append(False); continue
            (s_, e_), sl = r
            y = (s_ + e_) / 2; p = False
            if e_ - s_ + 1 < 0.8 * typical:
                below = others[min(e_ + 1, H - 1):min(e_ + 4, H), sl].any()
                above = others[max(s_ - 3, 0):s_, sl].any()
                if below and not above:
                    y = s_ + (typical - 1) / 2; p = True
                elif above and not below:
                    y = e_ - (typical - 1) / 2; p = True
            vals.append(float(np.clip(np.polyval(ky, y), 0, 100))); part.append(p)
        res[name] = vals; partial[name] = part
    return res, partial

def fill_occluded(res, partial):
    """Fully hidden markers take the value of the series covering them (flagged).
    Partly hidden ones were re-centred in digitize(); flag them too."""
    flags = {k: list(partial[k]) for k in res}
    names = list(res)
    for k in names:
        for i, v in enumerate(res[k]):
            if v is None:
                prev = next((res[k][j] for j in range(i - 1, -1, -1) if res[k][j] is not None), 0.0)
                cands = [res[o][i] for o in names if o != k and res[o][i] is not None]
                res[k][i] = min(cands, key=lambda c: abs(c - prev)); flags[k][i] = True
    return flags

def isotonic(v):
    """Pool-adjacent-violators: curves are non-decreasing in intensity."""
    blocks = [[x, 1] for x in v]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] > blocks[i + 1][0] + 1e-9:
            a, b = blocks[i], blocks[i + 1]
            blocks[i:i + 2] = [[(a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1]), a[1] + b[1]]]
            i = max(i - 1, 0)
        else:
            i += 1
    out = []
    for val, n in blocks:
        out += [val] * n
    return out

def overlay(a, res, ky, kx, path):
    im = Image.fromarray(a.astype(np.uint8)); dr = ImageDraw.Draw(im)
    for k, vals in res.items():
        for iv, v in zip(I, vals):
            if v is None: continue
            x = (iv - kx[1]) / kx[0]; y = (v - ky[1]) / ky[0]
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(0, 0, 0))
            dr.line([x - 6, y, x + 6, y], fill=(0, 0, 0))
    im.save(path)

CHARTS = {
  # file: (family key, kind, series names in legend order, calib, legend_box)
  "p-006": ("wood", "collapse", ["~1962", "1963-71", "1972-80", "1981-89", "1990-2001", "2002-"], "wood", (130, 30, 190, 320)),
  "p-007": ("wood", "total",    ["~1962", "1963-71", "1972-80", "1981-89", "1990-2001", "2002-"], "wood", (95, 10, 155, 255)),
  "p-013": ("steel_~1980", "collapse", ["7-15F", "5-6F", "1-4F"], "grid", (200, 10, 280, 180)),
  "p-015": ("steel_~1980", "total",    ["7-15F", "5-6F", "1-4F"], "grid", (200, 10, 280, 180)),
  "p-014": ("steel_1981-", "collapse", ["7-15F", "5-6F", "1-4F"], "grid", (200, 10, 280, 180)),
  "p-016": ("steel_1981-", "total",    ["7-15F", "5-6F", "1-4F"], "grid", (200, 10, 280, 180)),
  "p-022": ("rc_~1971", "collapse", ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
  "p-023": ("rc_~1971", "total",    ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
  "p-024": ("rc_1972-80", "collapse", ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
  "p-025": ("rc_1972-80", "total",    ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
  "p-032": ("rc_1981-", "collapse", ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
  "p-031": ("rc_1981-", "total",    ["11-15F", "7-10F", "1-6F"], "grid", (200, 10, 280, 190)),
}

def main(img_dir, out_json, ov_dir):
    out = {}
    for f, (fam, kind, names, cal, lbox) in CHARTS.items():
        a = load(f"{img_dir}/{f}.png")
        ky, kx = calib_wood(a) if cal == "wood" else calib_grid(a)
        lxr = (lbox[0] + 5, lbox[0] + 55) if cal == "grid" else (lbox[0] + 35, lbox[0] + 85)
        cols = legend_colors(a, (lbox[0] + 5, lbox[0] + 55), (lbox[1], lbox[3]))
        assert len(cols) == len(names), (f, cols)
        res = digitize(a, list(zip(names, [c for c, _ in cols])), ky, kx, lbox)
        res, partial = res
        flags = fill_occluded(res, partial)
        for n in names:
            res[n] = isotonic(res[n])
        overlay(a, res, ky, kx, f"{ov_dir}/{f}_overlay.png")
        out.setdefault(fam, {})[kind] = {n: {"values_pct": [round(v, 1) if v is not None else None for v in res[n]],
                                             "occluded": flags[n]} for n in names}
        print(f, fam, kind, {n: sum(flags[n]) for n in names}, "missing", {n: res[n].count(None) for n in names})
    json.dump({"intensity": I.tolist(), "charts": out}, open(out_json, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main(*sys.argv[1:])
