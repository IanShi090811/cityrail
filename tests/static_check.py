#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
idx=(ROOT/'index.html').read_text(encoding='utf-8')
js=(ROOT/'js/cityrail-runtime.js').read_text(encoding='utf-8')
css=(ROOT/'css/cityrail.css').read_text(encoding='utf-8')
errors=[]
if 'js/legacy/' in idx: errors.append('index still loads js/legacy')
local_js=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', idx)
local_js=[x for x in local_js if './js/' in x or '/js/' in x or x.startswith('js/')]
expected_js=['cityrail-runtime.js','cityrail-v146-single-control-owner.js']
if len(local_js)!=2 or any(name not in src for name,src in zip(expected_js,local_js)): errors.append(f'unexpected local JS entries: {local_js}')
local_css=re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', idx)
local_css=[x for x in local_css if './css/' in x or '/css/' in x or x.startswith('css/')]
if len(local_css)!=1 or 'cityrail.css' not in local_css[0]: errors.append(f'unexpected local CSS entries: {local_css}')
bad_text=[ ''.join(map(chr,[21040,22320,22270,36873,25321,20572,31449])), ''.join(map(chr,[26087]))+'ATS', ''.join(map(chr,[26087,32447,36335,36816,33829])), 'cityrail-'+'v'+'141', 'v'+'141', 'V'+'141']
for bad in bad_text:
    for name,body in [('index.html',idx),('js/cityrail-runtime.js',js),('css/cityrail.css',css)]:
        if bad in body: errors.append(f'{bad} remains in {name}')
# release package should not contain old docs/archive notes
archive=[p.name for p in ROOT.iterdir() if p.is_file() and (p.suffix=='.md' or p.name.endswith('.bak') or p.name=='refactor-manifest.json')]
if archive: errors.append(f'archive docs remain in release root: {archive}')
# Required exported self-check names and strict control bridge.
for req in ['cityrailV143Report','cityrailSelfCheck','CityRailInteractionV143','__cityrailV143InnerHTMLGuard','__cityrailV143DragStability','CityRailStationDragCore']:
    if req not in js: errors.append(f'missing required v143 symbol: {req}')
v145=(ROOT/'js/cityrail-v146-single-control-owner.js').read_text(encoding='utf-8')
for req in ['cityrailV145Report','__v145StableOwner','snapshotOwner','CityRailStationDragCore']:
    if req not in v145: errors.append(f'missing required v145 symbol: {req}')
for req in ['__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__','legacyControlSuppressed','singleControlOwner','v146-single-control-owner']:
    if req not in idx + js + v145: errors.append(f'missing required v146 single-owner symbol: {req}')
for req in ['bindStableDispatchEvents','CityRailDispatchConsoleV146','cityrailLastDispatch','cityrailLastOvertake']:
    if req not in js: errors.append(f'missing required v146 dispatch symbol: {req}')
# Static buttons should have data-action when declared in HTML.
buttons=re.findall(r'<button\b([^>]*)>', idx, flags=re.I)
missing=[]
for attrs in buttons:
    if 'data-action=' not in attrs and 'disabled' not in attrs and 'onclick=' not in attrs:
        m=re.search(r'id=["\']([^"\']+)', attrs); missing.append(m.group(1) if m else attrs[:60])
if missing: errors.append(f'static buttons without data-action: {missing[:20]}')
print(json.dumps({'staticCheck':'pass' if not errors else 'fail','localJS':local_js,'localCSS':local_css,'archiveRootFiles':archive,'errors':errors}, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
