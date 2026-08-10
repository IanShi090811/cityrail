import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const index = read('index.html');
const runtime = read('js/cityrail-runtime-v594.js');
const unified = read('js/cityrail-unified-map-control.js');
const maplibre = read('js/cityrail-maplibre-pmtiles-authority.js');

assert(index.indexOf('js/cityrail-runtime-v594.js') < index.indexOf('js/cityrail-unified-map-control.js'));
assert(index.indexOf('js/cityrail-unified-map-control.js') < index.indexOf('js/cityrail-maplibre-pmtiles-authority.js'));

assert(unified.includes('W.CityRailUnifiedMapControl = api'));
assert(unified.includes('W.cityrailSetBaseMapLayer = setLayer'));
assert(unified.includes('W.CityRailMapChoicesV219 = {'));
assert(unified.includes("autonavi2026Road: 'gcj02'"));
assert(unified.includes("tencentSatellite: 'gcj02'"));

assert(maplibre.includes('W.CityRailUnifiedMapControl.registerMaplibre({setLayer,nextLayer})'));
assert(maplibre.includes('if(W.CityRailUnifiedMapControl) return;'));

for (const forbidden of [
  'v247-cached-wgs84-basemap-authority',
  'v247-map-choice-owner',
  '__cityrailV247LayerSwitcherPatched',
  '__v219MapChoiceBound',
  'CityRailCachedWgs84Basemap'
]) {
  assert(!runtime.includes(forbidden), `${forbidden} should not remain in runtime`);
}

assert(runtime.includes('window.CityRailMapCoordinateAdapter = {'));
assert(runtime.includes('reanchor: cityrailReanchorMapCoordSystem'));
assert(runtime.includes("cityrailCoord: 'gcj02', coordSystem: 'gcj02', coordinateSystem: 'gcj02'"));

console.log(JSON.stringify({
  unifiedMapControlStaticCheck: 'pass',
  control: 'CityRailUnifiedMapControl',
  domesticCoord: 'gcj02',
  globalCoord: 'wgs84'
}, null, 2));
