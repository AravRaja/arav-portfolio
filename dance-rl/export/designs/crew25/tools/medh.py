import json,sys,statistics
for f in sys.argv[1:]:
  d=json.load(open(f)); at=d['at']; n=len(next(iter(at.values()))['heightPx'])
  med=[statistics.median(a['heightPx'][i] for a in at.values()) for i in range(n)]
  print(f, 'per-dancer median height: min %.0f mean %.0f'%(min(med), statistics.mean(med)))
