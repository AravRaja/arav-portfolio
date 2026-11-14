import json,sys
d=json.load(open(sys.argv[1]))
at=d['at']; n=len(next(iter(at.values()))['occ'])
perD=[max(a['occ'][i] for a in at.values()) for i in range(n)]
worst=max(perD); wi=perD.index(worst); wt=[t for t,a in at.items() if a['occ'][wi]==worst][0]
allo=sorted(o for a in at.values() for o in a['occ'])
import statistics
print(json.dumps({'times':len(at),'worst':round(worst,3),'worstDancer':wi,'worstT':wt,'p95_dancer_frame':round(allo[int(0.95*len(allo))],3),'over20':sum(1 for o in allo if o>0.2),'over25':sum(1 for o in allo if o>0.25),'frames':len(allo),
 'minH':min(a['minH'] for a in at.values()),'meanH':round(statistics.mean(a['meanH'] for a in at.values()),1),'perDancerWorst':[round(x,2) for x in perD],'cam':d.get('cam')}))
