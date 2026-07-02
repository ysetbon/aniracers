#!/usr/bin/env python3
"""
Street View harvester  --  Elemental Tag / Sarcelles circuit
============================================================
Walks the 5-waypoint loop AND the points in between, finds the real Google
Street View panorama nearest each step, downloads 8 directional views
(yaw 0..315), builds a labelled contact-sheet per panorama, and writes a
manifest tying EVERY image to its exact GPS / pano_id / capture date.

Hand the resulting folder to another agent as world-build reference: each
contact sheet = one ground position; the 8 tiles share that GPS and differ
only by heading (true-north compass degrees), so the agent can reconstruct
building placement and orientation.

REQUIREMENTS
------------
  * Google Maps Platform API key with **Street View Static API** enabled
    (billing on; metadata calls are free, image calls ~ $7 / 1000).
  * pip install requests pillow
  * export GOOGLE_MAPS_API_KEY="your_key"
    (optional) export GOOGLE_MAPS_SIGNING_SECRET="your_url_signing_secret"

RUN
---
  python harvest_streetview.py
"""
import os, csv, json, math, time, io, sys, hashlib, hmac
import base64 as b64, urllib.parse as up
import requests
from PIL import Image, ImageDraw, ImageFont

# ----------------------------- config --------------------------------------
API_KEY        = os.environ.get("GOOGLE_MAPS_API_KEY", "")
SIGNING_SECRET = os.environ.get("GOOGLE_MAPS_SIGNING_SECRET", "")  # optional
STEP_M  = 20                                   # spacing when walking legs (m)
YAWS    = [0, 45, 90, 135, 180, 225, 270, 315] # headings to capture (deg)
FOV     = 90                                   # horizontal FOV per tile (deg)
PITCH   = 0
TILE    = (640, 400)                           # per-view px (<=640 std tier)
RADIUS  = 35                                   # snap radius to a real pano (m)
SOURCE  = "outdoor"                            # avoid indoor/business panos
OUTDIR  = "sarcelles_panoramas"

# loop order; route returns to the first point
WAYPOINTS = [
    ("A_start", 48.978700, 2.374210),
    ("B_cp1",   48.980063, 2.374902),
    ("C_cp2",   48.980440, 2.372210),
    ("D_cp3",   48.978453, 2.371434),
    ("E_cp4",   48.978110, 2.374007),
]

META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG_URL  = "https://maps.googleapis.com/maps/api/streetview"

# --------------------------- url signing (optional) ------------------------
def sign_url(url):
    if not SIGNING_SECRET:
        return url
    p = up.urlparse(url)
    to_sign = (p.path + "?" + p.query).encode()
    key = b64.urlsafe_b64decode(SIGNING_SECRET)
    sig = hmac.new(key, to_sign, hashlib.sha1).digest()
    return url + "&signature=" + b64.urlsafe_b64encode(sig).decode()

# ------------------------------- geo ---------------------------------------
LAT_M = 111320.0
def lon_m(lat):  return 111320.0 * math.cos(math.radians(lat))
def dist_m(p, q):
    return math.hypot((q[1]-p[1])*lon_m((p[0]+q[0])/2), (q[0]-p[0])*LAT_M)

def densify(wps, step):
    """Linear-interpolate along each leg; first sample of a leg is the waypoint."""
    pts, cum = [], 0.0
    loop = wps + [wps[0]]
    for i in range(len(loop)-1):
        (n0, la0, lo0), (n1, la1, lo1) = loop[i], loop[i+1]
        d = dist_m((la0, lo0), (la1, lo1))
        n = max(1, round(d/step))
        for k in range(n):
            t = k/n
            pts.append({"leg": f"{n0}->{n1}",
                        "waypoint": (n0 if k == 0 else ""),
                        "lat": la0 + (la1-la0)*t,
                        "lon": lo0 + (lo1-lo0)*t,
                        "cum_m": round(cum + d*t, 1)})
        cum += d
    return pts

# ------------------------------- api ---------------------------------------
def get_meta(lat, lon):
    u = (f"{META_URL}?location={lat},{lon}&radius={RADIUS}"
         f"&source={SOURCE}&key={API_KEY}")
    r = requests.get(sign_url(u), timeout=20); r.raise_for_status()
    return r.json()

def get_tile(pano, heading):
    u = (f"{IMG_URL}?size={TILE[0]}x{TILE[1]}&pano={pano}"
         f"&heading={heading}&pitch={PITCH}&fov={FOV}&key={API_KEY}")
    r = requests.get(sign_url(u), timeout=30); r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGB")

# --------------------------- contact sheet ---------------------------------
def _font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "DejaVuSans-Bold.ttf", "arialbd.ttf"):
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()

def contact_sheet(tiles, caption):
    cols, rows, gap, caph = 4, 2, 6, 22
    tw, th = TILE
    W = cols*tw + (cols+1)*gap
    H = rows*th + (rows+1)*gap + caph
    sheet = Image.new("RGB", (W, H), (12, 12, 12))
    d = ImageDraw.Draw(sheet)
    fy, fc = _font(22), _font(15)
    for idx, (yaw, im) in enumerate(tiles):
        c, r = idx % cols, idx // cols
        x, y = gap + c*(tw+gap), gap + r*(th+gap)
        sheet.paste(im, (x, y))
        d.text((x+8, y+6), f"yaw {yaw}\u00b0", fill=(0, 230, 0), font=fy)
    d.text((gap, H-caph+3), caption, fill=(185, 185, 185), font=fc)
    return sheet

# ------------------------------- main --------------------------------------
def main():
    if not API_KEY:
        sys.exit("ERROR: set GOOGLE_MAPS_API_KEY in your environment first.")
    os.makedirs(OUTDIR, exist_ok=True)
    tiledir = os.path.join(OUTDIR, "tiles"); os.makedirs(tiledir, exist_ok=True)

    pts = densify(WAYPOINTS, STEP_M)
    print(f"{len(pts)} sample points along the loop. Snapping to panoramas...\n")

    seen, manifest, n = set(), [], 0
    for p in pts:
        try:
            m = get_meta(p["lat"], p["lon"])
        except Exception as e:
            print("  meta error:", e); continue
        if m.get("status") != "OK":
            print(f"  (no pano near {p['lat']:.6f},{p['lon']:.6f}: {m.get('status')})")
            continue
        pano = m["pano_id"]
        if pano in seen:                       # same panorama already captured
            continue
        seen.add(pano)
        la, lo = m["location"]["lat"], m["location"]["lng"]
        date   = m.get("date", "")
        n += 1; tag = f"{n:03d}_{pano[:10]}"

        tiles = []
        for yaw in YAWS:
            try:
                im = get_tile(pano, yaw)
            except Exception as e:
                print("   tile error:", e); continue
            im.save(os.path.join(tiledir, f"{tag}_yaw{yaw:03d}.jpg"), quality=88)
            tiles.append((yaw, im))
            time.sleep(0.05)
        if not tiles:
            n -= 1; continue

        caption = f"{la:.6f}, {lo:.6f}  |  pano {pano}  |  {date}"
        contact_sheet(tiles, caption).save(
            os.path.join(OUTDIR, f"{tag}.jpg"), quality=88)

        manifest.append({
            "index": n, "pano_id": pano, "lat": la, "lon": lo, "date": date,
            "leg": p["leg"], "nearest_waypoint": p["waypoint"],
            "requested_lat": round(p["lat"], 6), "requested_lon": round(p["lon"], 6),
            "heading_is": "true-north compass degrees (0=N, 90=E)",
            "sheet": f"{tag}.jpg",
            "tiles": {str(y): f"tiles/{tag}_yaw{y:03d}.jpg" for y in YAWS},
        })
        print(f"[{n:3d}] {pano}  {la:.6f},{lo:.6f}  {date}")

    with open(os.path.join(OUTDIR, "manifest.json"), "w") as f:
        json.dump({"crs": "WGS84", "fov_deg": FOV, "pitch_deg": PITCH,
                   "yaws_deg": YAWS, "tile_px": TILE, "count": n,
                   "panoramas": manifest}, f, indent=2)
    with open(os.path.join(OUTDIR, "manifest.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["index", "pano_id", "lat", "lon", "date",
                    "leg", "nearest_waypoint", "sheet"])
        for r in manifest:
            w.writerow([r["index"], r["pano_id"], r["lat"], r["lon"],
                        r["date"], r["leg"], r["nearest_waypoint"], r["sheet"]])

    print(f"\nDone: {n} panoramas -> ./{OUTDIR}/")
    print(f"   contact sheets: {OUTDIR}/NNN_*.jpg")
    print(f"   individual tiles: {OUTDIR}/tiles/")
    print(f"   manifest: {OUTDIR}/manifest.json (+ .csv)")

if __name__ == "__main__":
    main()
