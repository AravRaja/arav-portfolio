# python3 overview.py OUTDIR : overview_desktop.png / overview_unison.png (2x3) and overview_phone.png (1x6), labelled
import sys, os
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]
F = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 34)
labels = {'current': 'current (L4 club, 18°)'}
def names():
    import json
    c = json.load(open(os.path.join(os.path.dirname(__file__), 'cams.json')))
    return {k: f"{k} {v['name']} ({v['elevation'][0]}°)" for k, v in c.items()}
labels.update(names())
keys = ['current', 'V1', 'V2', 'V3', 'V4', 'V5']
def grid(pattern, out, cols, scale):
    ims = [Image.open(os.path.join(D, pattern.format(k))).convert('RGB') for k in keys]
    w, h = int(ims[0].width * scale), int(ims[0].height * scale)
    rows = (len(ims) + cols - 1) // cols
    G = Image.new('RGB', (w * cols, h * rows), 'black')
    for i, (k, im) in enumerate(zip(keys, ims)):
        im = im.resize((w, h), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        t = labels[k] if 'phone' not in pattern else k
        bb = d.textbbox((0, 0), t, font=F)
        d.rectangle([0, h - (bb[3] + 24), bb[2] + 28, h], fill='black')
        d.text((14, h - bb[3] - 12), t, font=F, fill='white')
        G.paste(im, ((i % cols) * w, (i // cols) * h))
        if i % cols: ImageDraw.Draw(G).line([((i % cols) * w, (i // cols) * h), ((i % cols) * w, (i // cols + 1) * h)], fill='black', width=4)
    G.save(os.path.join(D, out))
grid('{}_desktop_1920x1080_41.04s.png', 'overview_desktop.png', 3, 0.5)
grid('{}_desktop_unison_68.50s.png', 'overview_unison.png', 3, 0.5)
grid('{}_phone13_390x844@2x_41.04s.png', 'overview_phone.png', 6, 0.5)
print('ok')
