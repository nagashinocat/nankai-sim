"""Extract vector curves (liquefaction p11-12, tsunami p13) from 内閣府 sanko_gaiyo.pdf.

Solid lines are filled outline polygons -> centre line = mean of the two edges.
Dashed lines are many short thin polygons -> centroids (markers are filtered out
by shape: dashes are elongated, markers are not).
Usage: python3 extract_vector.py <pdf> <out_json>
"""
import json, sys
import numpy as np
import pdfplumber

def col(c):
    return tuple(round(v, 2) for v in (c.get("non_stroking_color") or ()))

def centerline(polys, step=0.5):
    """Centre of a stroked line drawn as filled outline polygon(s): densify every
    edge, then per x-bin take the midpoint of the lowest and highest outline y.
    Valid because each curve is a function of x."""
    dense = []
    for poly in polys:
        p = np.array(poly)
        for a, b in zip(p, np.roll(p, -1, axis=0)):
            n = max(int(np.hypot(*(b - a)) / 0.2), 1)
            t = np.linspace(0, 1, n, endpoint=False)[:, None]
            dense.append(a + t * (b - a))
    d = np.vstack(dense)
    xs = np.arange(d[:, 0].min() + step, d[:, 0].max() - step, step)
    ys = []
    for x in xs:
        sel = d[np.abs(d[:, 0] - x) < step / 2, 1]
        ys.append((sel.min() + sel.max()) / 2 if sel.size else np.nan)
    ys = np.array(ys); ok = ~np.isnan(ys)
    return xs[ok], ys[ok]

def flatten(path, n=24):
    """pdfplumber path (m/l/c/h commands) -> dense polyline, evaluating cubic Béziers."""
    out, cur = [], None
    for cmd in path:
        op = cmd[0]
        if op == "m" or op == "l":
            cur = np.array(cmd[1]); out.append(cur)
        elif op == "c":
            p1, p2, p3 = (np.array(q) for q in cmd[1:4])
            t = np.linspace(0, 1, n)[1:, None]
            out.extend(((1 - t) ** 3) * cur + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3)
            cur = p3
    return [tuple(q) for q in out]

def elongation(pts):
    p = np.array(pts); p = p - p.mean(0)
    s = np.linalg.svd(p, compute_uv=False)
    return s[0] / max(s[1], 1e-6)

def axis_fit(words, gridlines_y, xlabels):
    ky = np.polyfit(gridlines_y, np.linspace(100, 0, len(gridlines_y)), 1)
    xs = [w["x0"] + (w["x1"] - w["x0"]) / 2 for w in xlabels]
    kx = np.polyfit(xs, [float(w["text"]) for w in xlabels], 1)
    return kx, ky

def label_grid(words, x_left, y_top, y_bot, x_row_top, x_row_bot):
    """y tick labels (numbers) left of the plot and x tick labels under it."""
    num = lambda t: t.replace(".", "", 1).replace("%", "").isdigit()
    ys = sorted([w for w in words if num(w["text"]) and w["x1"] < x_left and y_top <= w["top"] <= y_bot
                 and w["top"] < x_row_top - 3],
                key=lambda w: w["top"])
    xl = [w for w in words if num(w["text"]) and x_row_top <= w["top"] <= x_row_bot]
    yv = [float(w["text"].replace("%", "")) for w in ys]
    yc = [(w["top"] + w["bottom"]) / 2 for w in ys]
    ky = np.polyfit(yc, yv, 1)
    xc = [(w["x0"] + w["x1"]) / 2 for w in xl]
    kx = np.polyfit(xc, [float(w["text"]) for w in xl], 1)
    return kx, ky, len(ys), len(xl)

def chart(page, bbox, ylab_xmax, xrow, exclude=None):
    pg = page.crop(bbox)
    words = pg.extract_words(keep_blank_chars=False)
    kx, ky, ny, nx = label_grid(words, ylab_xmax, bbox[1], bbox[3], *xrow)
    solid, dashes = {}, {}
    for c in pg.curves:
        p = c["pts"]; xs = [x for x, _ in p]; ys = [y for _, y in p]
        k = col(c)
        if k in ((0.53, 0.53, 0.53), (0.0, 0.0, 0.0), (0.0,), (1.0, 1.0, 1.0)) or not c.get("fill"):
            continue
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if exclude and exclude[0] <= min(xs) and max(xs) <= exclude[2] and exclude[1] <= min(ys) and max(ys) <= exclude[3]:
            continue
        if w > 40 and len(p) > 8:
            solid.setdefault(k, []).append(flatten(c["path"]) if c.get("path") else p)
        elif max(w, h) < 4.5 and 5 <= len(p) <= 10 and elongation(p) > 2.2 and min(w, h) > 0.85:
            dashes.setdefault(k, []).append((np.mean(xs), np.mean(ys)))
    return kx, ky, ny, nx, solid, dashes

def to_data(kx, ky, x, y):
    return np.polyval(kx, x), np.polyval(ky, y)

def main(pdf_path, out):
    res = {}
    with pdfplumber.open(pdf_path) as pdf:
        # --- liquefaction, wood (p11): x settlement cm 0..35, y 全壊率 %
        kx, ky, ny, nx, solid, _ = chart(pdf.pages[10], (460, 355, 770, 520), 497, (505, 516))
        res["liquefaction_wood"] = {"x": "settlement_cm", "y": "collapse_pct", "calib_labels": [ny, nx], "series": {}}
        names = {(0.74, 0.29, 0.28): "~1980(S55以前)", (0.75, 0.29, 0.28): "~1980(S55以前)", (0.31, 0.51, 0.74): "1981-(S56以降)"}
        for k, polys in solid.items():
            xs, ys = centerline(polys)
            X, Y = to_data(kx, ky, xs, ys)
            res["liquefaction_wood"]["series"][names.get(k, str(k))] = {"x": X.round(3).tolist(), "y": Y.round(3).tolist()}
        # --- liquefaction, non-wood no piles (p12 left) and piled small high-aspect (p12 right)
        for key, bbox, ylx, xrow, nm in [
            ("liquefaction_nonwood_nopile", (80, 195, 372, 378), 112, (355, 362),
             {(0.75, 0.31, 0.3): "all"}),
            ("liquefaction_nonwood_pile_small", (460, 195, 750, 374), 493, (351, 358),
             {(0.75, 0.31, 0.3): "~1974(S49以前)", (0.61, 0.73, 0.35): "1975-1983(S50-58)", (0.31, 0.51, 0.74): "1984-(S59以降)"}),
        ]:
            kx, ky, ny, nx, solid, _ = chart(pdf.pages[11], bbox, ylx, xrow)
            res[key] = {"x": "settlement_cm", "y": "collapse_pct", "calib_labels": [ny, nx], "series": {}}
            for k, polys in solid.items():
                xs, ys = centerline(polys)
                X, Y = to_data(kx, ky, xs, ys)
                res[key]["series"][nm.get(k, str(k))] = {"x": X.round(3).tolist(), "y": Y.round(3).tolist()}
        # --- tsunami (p13): top = DID, bottom = non-DID; solid = wood, dashed = non-wood
        cmap = {(0.75, 0.0, 0.0): "collapse", (0.47, 0.58, 0.24): "total", (0.33, 0.56, 0.84): "half"}
        for key, bbox, xrow in [("tsunami_DID", (440, 183, 800, 352), (346, 352)),
                                ("tsunami_nonDID", (440, 378, 800, 548), (541, 548))]:
            legend = (bbox[0] + 280, bbox[1] + 60, bbox[2], bbox[1] + 140)
            kx, ky, ny, nx, solid, dashes = chart(pdf.pages[12], bbox, 470, xrow, exclude=legend)
            entry = {"x": "depth_m", "y": "pct", "calib_labels": [ny, nx], "series": {}}
            for k, polys in solid.items():
                if k not in cmap: continue
                xs, ys = centerline(polys)
                X, Y = to_data(kx, ky, xs, ys)
                entry["series"][f"wood_{cmap[k]}"] = {"x": X.round(3).tolist(), "y": Y.round(3).tolist()}
            for k, pts in dashes.items():
                if k not in cmap: continue
                pts = sorted(pts)
                X, Y = to_data(kx, ky, np.array([p[0] for p in pts]), np.array([p[1] for p in pts]))
                keep = ~((X > 6.3) & (X < 7.3) & (Y > 2) & (Y < 60))   # legend samples
                X, Y = X[keep], Y[keep]
                entry["series"][f"nonwood_{cmap[k]}"] = {"x": X.round(3).tolist(), "y": Y.round(3).tolist()}
            res[key] = entry
    json.dump(res, open(out, "w"), ensure_ascii=False)
    for k, v in res.items():
        print(k, v["calib_labels"], {n: len(s["x"]) for n, s in v["series"].items()})

if __name__ == "__main__":
    main(*sys.argv[1:])
