# python3 summary.py CHECKSDIR -> table per layout (desktop 1920 + 1280 frame, phone)
import json, sys, os, math
C = sys.argv[1]
def load(n):
    p = os.path.join(C, n)
    return json.load(open(p)) if os.path.exists(p) else None
def frame(d):
    if not d: return None
    ok = True; worst = []
    for t, a in d['at'].items():
        ok &= a['frameTop'] >= d['frame']['headerBottom'] and a['frameBottom'] <= d['frame']['spaceTop'] and a['frameL'] >= 0 and a['frameR'] <= d['w']
        worst.append((round(a['frameTop'] - d['frame']['headerBottom']), round(d['frame']['spaceTop'] - a['frameBottom']), a['frameL'], d['w'] - a['frameR']))
    return ok, [min(x[i] for x in worst) for i in range(4)]
out = {}
for v in ['L4', 'V1', 'V2', 'V3', 'V4', 'V5']:
    for mode, f in [('desktop', f'{v}_desktop_1920.json'), ('phone', f'{v}_phone13.json')]:
        d = load(f)
        if not d: continue
        at = d['at']; n = len(at['41.04']['occ'])
        perD = [max(a['occ'][i] for a in at.values()) for i in range(n)]
        wi = perD.index(max(perD)); wt = [t for t, a in at.items() if a['occ'][wi] == perD[wi]][0]
        slots = d['chk'] and None
        r = {'el': d['cam']['elevation'], 'meanH41': at['41.04']['meanH'], 'minH41': at['41.04']['minH'], 'meanH68': at['68.5']['meanH'], 'minH68': at['68.5']['minH'],
             'worstOcc': round(max(perD), 3), 'worstDancer': wi, 'worstT': wt, 'meanOcc': round(sum(perD) / n, 3), 'over25': sum(1 for o in perD if o > 0.25), 'occ41': at['41.04']['worst'],
             'chk': d.get('chk'), 'frame': frame(d)}
        if mode == 'desktop': r['frame1280'] = frame(load(f'{v}_desktop_1280.json'))
        out[f'{v} {mode}'] = r
for k, r in out.items():
    c = r['chk'] or {}
    print(k, json.dumps({kk: r[kk] for kk in ['el', 'meanH41', 'minH41', 'meanH68', 'minH68', 'worstOcc', 'worstDancer', 'worstT', 'meanOcc', 'over25', 'occ41', 'frame'] + (['frame1280'] if 'frame1280' in r else [])}),
          json.dumps({kk: c.get(kk) for kk in ['minRootGap', 'at', 'slotMin', 'neighbourSameOutfit', 'neighbourSameMotion', 'allBlack', 'oddRightEvenLeft', 'yawRange']}))
json.dump(out, open(os.path.join(C, 'summary.json'), 'w'), indent=1)
