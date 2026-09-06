import os, json

OUT = "/Users/mujeeb/ledge/design/logo/refine"
os.makedirs(OUT, exist_ok=True)

INK_L, BONE_L = "#16140E", "#EDE9E0"   # light surface
INK_D, BONE_D = "#131210", "#E9E5D9"   # dark surface

# finals/logo.svg geometry: 100 viewBox, box origin (4,4), s = 92
def rects(cand, x0, y0, s):
    """return list of (x,y,w,h) in viewBox units, bottom-aligned at y0+s"""
    B = y0 + s
    hw = 0.11 * s      # vertical (margin rule) width
    hh = 0.22 * s      # heavy total rule height
    lh = 0.045 * s     # hairline height
    r = []
    if cand == "A":    # tight total: gaps 0.035, vertical full height
        g = 0.035 * s
        y2 = B - lh
        y1 = y2 - g - lh
        yh = y1 - g - hh
        r += [(x0, y0, hw, s)]
        r += [(x0, yh, s, hh), (x0, y1, s, lh), (x0, y2, s, lh)]
    elif cand == "B":  # stub vertical + heavy rule overshoots left + tight gaps
        g = 0.035 * s
        ov = 0.06 * s
        y2 = B - lh
        y1 = y2 - g - lh
        yh = y1 - g - hh
        r += [(x0 + ov, y0 + 0.35 * s, hw, s - 0.35 * s)]
        r += [(x0, yh, s, hh), (x0, y1, s, lh), (x0, y2, s, lh)]
    elif cand == "C":  # accountant's convention: hairline above, double below
        g = 0.035 * s
        ga = 0.075 * s          # open gap above the total, snug double beneath
        hh = 0.20 * s
        y2 = B - lh
        y1 = y2 - g - lh
        yh = y1 - g - hh
        yt = yh - ga - lh
        r += [(x0, y0 + 0.18 * s, hw, s - 0.18 * s)]
        r += [(x0, yt, s, lh), (x0, yh, s, hh), (x0, y1, s, lh), (x0, y2, s, lh)]
    elif cand == "D":  # no margin rule: tick at left end only, rule above/heavy/double below
        g = 0.035 * s
        ga = 0.05 * s
        y2 = B - lh
        y1 = y2 - g - lh
        yh = y1 - g - hh
        yt = yh - ga - lh
        tick_top = yt - 0.16 * s
        r += [(x0, tick_top, hw, B - tick_top)]
        r += [(x0, yt, s, lh), (x0, yh, s, hh), (x0, y1, s, lh), (x0, y2, s, lh)]
    return r

def svg(cand, ink, bone=None, vb=100, x0=4.0, y0=4.0, s=92.0):
    body = ""
    if bone:
        body += f'<rect width="{vb}" height="{vb}" fill="{bone}"/>'
    for (x, y, w, h) in rects(cand, x0, y0, s):
        body += f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{ink}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" '
            f'width="{vb}" height="{vb}">{body}</svg>')

NAMES = {
 "A": ("a-tight-total",   "Tight Total"),
 "B": ("b-stub-overshoot","Stub + Overshoot"),
 "C": ("c-rule-above",    "Rule Above / Double Below"),
 "D": ("d-tick-only",     "Tick Only"),
}

for c, (slug, label) in NAMES.items():
    open(f"{OUT}/{slug}.svg", "w").write(svg(c, INK_L))
    open(f"{OUT}/{slug}-dark.svg", "w").write(svg(c, BONE_D))
    # token: bone square, ink mark, token padding (21.875% margin, 56.25% box)
    open(f"{OUT}/{slug}-token.svg", "w").write(
        svg(c, INK_L, bone=BONE_L, x0=21.875, y0=21.875, s=56.25))

print(json.dumps({k: v[0] for k, v in NAMES.items()}, indent=1))
