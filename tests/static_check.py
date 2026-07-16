#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
idx=(ROOT/'index.html').read_text(encoding='utf-8')
js=(ROOT/'js/cityrail-runtime.js').read_text(encoding='utf-8')
css=(ROOT/'css/cityrail.css').read_text(encoding='utf-8')
errors=[]
script_srcs=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', idx)
if any('js/legacy/' in src for src in script_srcs): errors.append('index still loads js/legacy')
local_js=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', idx)
local_js=[x for x in local_js if './js/' in x or '/js/' in x or x.startswith('js/')]
expected_js=[
    'cityrail-runtime.js',
    'cityrail-v146-single-control-owner.js',
    'cityrail-apple-spatial-ui-authority.js',
    'cityrail-maplibre-pmtiles-authority.js',
    'cityrail-living-city.js',
    'cityrail-external-sources-v1.js',
    'cityrail-real-network-importer.js',
    'cityrail-performance-authority-v400.js',
]
inline_js=(
    'id="cityrail-inline-runtime"' in idx
    and 'id="cityrail-inline-control-owner"' in idx
)
local_js_names=[src.split('?',1)[0].rsplit('/',1)[-1] for src in local_js]
external_js_ok=local_js_names==expected_js
if not (external_js_ok or inline_js): errors.append(f'unexpected local JS entries: {local_js}')
local_css=re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', idx)
local_css=[x for x in local_css if './css/' in x or '/css/' in x or x.startswith('css/')]
inline_css='id="cityrail-inline-css"' in idx
external_css_ok=len(local_css)==1 and 'cityrail.css' in local_css[0]
if not (external_css_ok or inline_css): errors.append(f'unexpected local CSS entries: {local_css}')
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
for req in ['__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__','legacyControlSuppressed','singleControlOwner','CITYRAIL_BUILD_VERSION']:
    if req not in idx + js + v145: errors.append(f'missing required v146 single-owner symbol: {req}')
for req in ['/api/pay/create','/api/pay/status','cityrail-pay-modal']:
    if req not in idx + js + css: errors.append(f'missing required payment symbol: {req}')
for req in ['CityRailDispatchAuthorityV300','CityRailDispatchAuthorityV301','cityrailDispatchAuthorityOwnsFleet','CityRailDispatchConsoleV146','cityrailLastDispatch','cityrailLastOvertake']:
    if req not in js: errors.append(f'missing required v146 dispatch symbol: {req}')
# Static buttons should have data-action when declared in HTML.
html_shell=idx.split('<script',1)[0]
buttons=re.findall(r'<button\b([^>]*)>', html_shell, flags=re.I)
missing=[]
for attrs in buttons:
    if 'data-action=' not in attrs and 'disabled' not in attrs and 'onclick=' not in attrs:
        m=re.search(r'id=["\']([^"\']+)', attrs); missing.append(m.group(1) if m else attrs[:60])
if missing: errors.append(f'static buttons without data-action: {missing[:20]}')
print(json.dumps({'staticCheck':'pass' if not errors else 'fail','localJS':local_js,'localCSS':local_css,'archiveRootFiles':archive,'errors':errors}, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
