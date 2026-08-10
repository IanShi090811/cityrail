(function(){
  'use strict';
  const W = window;
  const D = document;
  const VERSION = 'v597-unified-map-control';
  if (W.CityRailUnifiedMapControl && W.CityRailUnifiedMapControl.version === VERSION) return;

  const VECTOR_KEY = 'pmtilesVector';
  const THREE_D_KEY = 'maplibre3d';
  const DEFAULT_KEY = 'dark';
  const ORDER = [
    'dark',
    'autonavi2026Road',
    'autonavi2026Satellite',
    'tencentSatellite',
    'tencentTerrain',
    'cartoLight',
    'cartoVoyager',
    'esriImagery',
    VECTOR_KEY,
    THREE_D_KEY
  ];
  const LABELS = {
    dark: 'CARTO暗色',
    autonavi2026Road: '高德2026标准',
    autonavi2026Satellite: '高德2026卫星',
    tencentSatellite: '腾讯卫星',
    tencentTerrain: '腾讯地形',
    cartoLight: 'CARTO浅色',
    cartoVoyager: 'CARTO Voyager',
    esriImagery: 'Esri影像',
    pmtilesVector: '矢量地图',
    maplibre3d: '3D地图'
  };
  const COORDS = {
    dark: 'wgs84',
    autonavi2026Road: 'gcj02',
    autonavi2026Satellite: 'gcj02',
    tencentSatellite: 'gcj02',
    tencentTerrain: 'gcj02',
    cartoLight: 'wgs84',
    cartoVoyager: 'wgs84',
    esriImagery: 'wgs84',
    pmtilesVector: 'wgs84',
    maplibre3d: 'wgs84'
  };
  const ALIASES = {
    satellite: 'esriImagery',
    cartoDark: 'dark',
    gaode: 'autonavi2026Road',
    amap: 'autonavi2026Road',
    gaodeRoad: 'autonavi2026Road',
    amapRoad: 'autonavi2026Road',
    'gaode-road': 'autonavi2026Road',
    'amap-road': 'autonavi2026Road',
    'autonavi-2026-road': 'autonavi2026Road',
    gaodeSatellite: 'autonavi2026Satellite',
    amapSatellite: 'autonavi2026Satellite',
    'gaode-satellite': 'autonavi2026Satellite',
    'amap-satellite': 'autonavi2026Satellite',
    'autonavi-2026-satellite': 'autonavi2026Satellite',
    tencentSatellite: 'tencentSatellite',
    'tencent-satellite': 'tencentSatellite',
    tencentTerrain: 'tencentTerrain',
    'tencent-terrain': 'tencentTerrain',
    osm: VECTOR_KEY,
    osmStandard: VECTOR_KEY,
    '3d': THREE_D_KEY,
    threeD: THREE_D_KEY,
    cityrail3d: THREE_D_KEY
  };

  const runtimeSetBaseLayer = typeof W.cityrailSetBaseMapLayer === 'function'
    ? W.cityrailSetBaseMapLayer.bind(W)
    : null;
  let maplibreHandler = null;
  let bound = false;

  function normalizeKey(key) {
    const raw = String(key || '').trim();
    const mapped = ALIASES[raw] || raw;
    return ORDER.includes(mapped) ? mapped : DEFAULT_KEY;
  }

  function layerFor(key) {
    return W.tileLayers && W.tileLayers[normalizeKey(key)];
  }

  function coordForKey(key) {
    const normalized = normalizeKey(key);
    const layer = layerFor(normalized);
    const opts = layer && layer.options || {};
    const adapter = W.CityRailMapCoordinateAdapter;
    if (adapter && typeof adapter.normalize === 'function') {
      return adapter.normalize(opts.cityrailCoord || opts.coordSystem || opts.coordinateSystem || COORDS[normalized] || 'wgs84');
    }
    return String(opts.cityrailCoord || opts.coordSystem || opts.coordinateSystem || COORDS[normalized] || 'wgs84').toLowerCase();
  }

  function keys() {
    if (!Array.isArray(W.layerKeys)) return ORDER.slice();
    const present = ORDER.filter(key => {
      if (key === VECTOR_KEY || key === THREE_D_KEY) return true;
      return !!layerFor(key);
    });
    W.layerKeys.splice(0, W.layerKeys.length, ...present);
    return present.slice();
  }

  function activeKey() {
    const available = keys();
    try {
      const active = available.find(key => {
        const layer = layerFor(key);
        return layer && W.map && W.map.hasLayer && W.map.hasLayer(layer);
      });
      if (active) return active;
    } catch(e) {}
    const preferred = normalizeKey(W.__cityrailPreferredMapLayerKey || D.documentElement.dataset.cityrailBaseLayer || DEFAULT_KEY);
    return available.includes(preferred) ? preferred : DEFAULT_KEY;
  }

  function syncIndex(key) {
    const available = keys();
    const normalized = normalizeKey(key || activeKey());
    const idx = Math.max(0, available.indexOf(normalized));
    try { W.currentLayerIdx = idx; } catch(e) {}
    try { currentLayerIdx = idx; } catch(e) {}
    W.__cityrailPreferredMapLayerKey = available[idx] || DEFAULT_KEY;
    D.documentElement.dataset.cityrailBaseLayer = W.__cityrailPreferredMapLayerKey;
    D.documentElement.dataset.cityrailBaseLayerCoord = coordForKey(W.__cityrailPreferredMapLayerKey);
    D.documentElement.dataset.cityrailMapControl = VERSION;
    return W.__cityrailPreferredMapLayerKey;
  }

  function syncButton(key) {
    const active = syncIndex(key);
    const btn = D.getElementById('btn-layer');
    if (btn) {
      btn.textContent = LABELS[active] || active || '地图';
      btn.title = '切换底图：CARTO、高德、腾讯、Esri、矢量地图、3D地图。高德和腾讯使用 GCJ-02，其余底图使用 WGS84。';
    }
    try { if (typeof W.cityrailSyncMapCredit === 'function') W.cityrailSyncMapCredit(active); } catch(e) {}
    try { if (typeof W.cityrailSyncCityBadgeTheme === 'function') W.cityrailSyncCityBadgeTheme(active); } catch(e) {}
    return active;
  }

  function audit(key, reason) {
    const active = normalizeKey(key || activeKey());
    const coord = coordForKey(active);
    try {
      const adapter = W.CityRailMapCoordinateAdapter;
      if (adapter && typeof adapter.audit === 'function') adapter.audit('unified-map-control-' + active + '-' + (reason || 'sync'), { forceRedraw: false });
      D.documentElement.dataset.cityrailMapCoordExpected = coord;
      D.documentElement.dataset.cityrailMapCoordBaseLayer = active;
    } catch(e) {}
    return { key: active, coord };
  }

  function setRasterBaseLayer(key, reason) {
    const next = normalizeKey(key);
    if (runtimeSetBaseLayer) runtimeSetBaseLayer(next, 'unified-raster-' + (reason || 'set'));
    syncButton(next);
    audit(next, reason || 'raster');
    return true;
  }

  function setLayer(key, reason) {
    const next = normalizeKey(key);
    W.__cityrailUserSelectedBaseLayer = true;
    if (maplibreHandler && typeof maplibreHandler.setLayer === 'function') {
      maplibreHandler.setLayer(next, 'unified-' + (reason || 'set'));
    } else {
      setRasterBaseLayer(next, reason);
    }
    syncButton(next);
    audit(next, reason || 'set');
    return next;
  }

  function nextLayer(reason) {
    const available = keys();
    const current = activeKey();
    const idx = Math.max(0, available.indexOf(current));
    return setLayer(available[(idx + 1) % available.length] || DEFAULT_KEY, reason || 'cycle');
  }

  function handleLayerButton(event) {
    if (!(event.target && event.target.closest && event.target.closest('#btn-layer'))) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    nextLayer('button');
  }

  function bindButton() {
    if (bound) return;
    bound = true;
    D.addEventListener('click', handleLayerButton, true);
  }

  function registerMaplibre(handler) {
    maplibreHandler = handler || null;
    return api;
  }

  function sync(reason) {
    syncButton(activeKey());
    audit(activeKey(), reason || 'sync');
    return reason || 'sync';
  }

  const defs = Object.fromEntries(ORDER.map(key => [key, {
    label: LABELS[key],
    coord: COORDS[key],
    vector: key === VECTOR_KEY || key === THREE_D_KEY,
    options: { cityrailCoord: COORDS[key], coordSystem: COORDS[key], coordinateSystem: COORDS[key] }
  }]));

  const api = {
    version: VERSION,
    keys,
    labels: LABELS,
    defs,
    normalizeKey,
    coordForKey,
    activeKey,
    setLayer,
    setRasterBaseLayer,
    nextLayer,
    sync,
    registerMaplibre,
    report: () => ({
      version: VERSION,
      active: activeKey(),
      coord: coordForKey(activeKey()),
      keys: keys(),
      hasCoordinateAdapter: !!W.CityRailMapCoordinateAdapter,
      hasMaplibreHandler: !!maplibreHandler,
      runtimeSetter: !!runtimeSetBaseLayer
    })
  };

  W.CityRailUnifiedMapControl = api;
  W.cityrailSetBaseMapLayer = setLayer;
  W.CityRailMapChoicesV219 = {
    version: VERSION,
    keys,
    labels: LABELS,
    defs,
    setLayer,
    nextLayer,
    sync,
    licensing: 'Basemap tiles are proxied per provider; domestic basemaps use GCJ-02 and global basemaps use WGS84.'
  };
  W.CityRailCleanDomesticBasemap = Object.assign({}, W.CityRailCleanDomesticBasemap || {}, {
    version: VERSION,
    labels: LABELS,
    keys,
    ensureMapChoiceLayer: key => !!layerFor(key),
    mapChoiceLicensing: W.CityRailMapChoicesV219.licensing
  });

  bindButton();
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => sync('dom-ready'), { once: true });
  else sync('boot');
})();
