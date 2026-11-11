"""Axis calibration for raster Excel charts from 内閣府 sanko_gaiyo.pdf."""
import numpy as np
from PIL import Image

def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(int)

def clusters(mask1d, min_gap=2):
    idx = np.flatnonzero(mask1d)
    if idx.size == 0:
        return []
    groups, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev > min_gap:
            groups.append((start, prev)); start = i
        prev = i
    groups.append((start, prev))
    return groups

def dark(a, thr=110):
    return (a.max(2) < thr)

def y_label_centers(a, xmax_frac=0.13):
    d = dark(a)[:, : int(a.shape[1] * xmax_frac)]
    rows = d.sum(1) > 0
    return [((s + e) / 2, e - s) for s, e in clusters(rows)]

def x_label_centers(a, band):
    y0, y1 = band
    d = dark(a)[y0:y1, :]
    cols = d.sum(0) > 0
    return [((s + e) / 2, e - s) for s, e in clusters(cols, min_gap=6)]

def legend_colors(a, xr, yr, sat_thr=60):
    """Median color of each legend entry (rows of saturated pixels) in region."""
    x0, x1 = xr; y0, y1 = yr
    sub = a[y0:y1, x0:x1]
    sat = sub.max(2) - sub.min(2)
    m = sat > sat_thr
    out = []
    for s, e in clusters(m.sum(1) > 3, min_gap=3):
        px = sub[s:e + 1][m[s:e + 1]]
        out.append((tuple(int(v) for v in np.median(px, 0)), y0 + (s + e) / 2))
    return out
