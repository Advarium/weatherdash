/* ══════════════════════════════════════════════════════
   CORS PROXY
   cors-proxy-worker.js.  Leave empty to disable proxied sources.
══════════════════════════════════════════════════════ */

const PROXY_BASE = 'https://relay.advarium.workers.dev';

/** Wrap a URL through the CORS proxy if PROXY_BASE is set, else return as-is */
function proxyUrl(url) {
  if (!PROXY_BASE) return url;
  return `${PROXY_BASE}/?url=${encodeURIComponent(url)}`;
}

/* ══════════════════════════════════════════════════════
   HELPERS — formatting, panel states, live indicator
══════════════════════════════════════════════════════ */

function fmtTime(iso) {
  if (!iso) return '—';
  // Normalize: if the string looks like a bare datetime with no timezone info, assume UTC
  let normalized = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(normalized) && !/[Z+-]\d/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + 'Z';
  }
  const parsed = new Date(normalized);
  if (isNaN(parsed)) return iso;
  // toLocaleString automatically converts to the browser's local timezone
  return parsed.toLocaleString(undefined, {
    month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit',
    hour12: false, timeZoneName: 'short',
  });
}

function markUpdated(id) {
  const timestamp = new Date().toLocaleTimeString(undefined, {
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12: false, timeZoneName: 'short',
  });
  const el = document.getElementById(id);
  if (el) el.textContent = timestamp;
  // Every loader calls this on a successful fetch, so it doubles as the
  // heartbeat for the Live indicator.
  noteDataLoaded();
}

/* ── Live / stale indicator ─────────────────────────────────────
   Starts red in the markup and is promoted to green only after a real
   load succeeds, then demoted again if nothing succeeds for a while. */
const LIVE_STALE_MS = 10 * 60_000;   // 10 minutes with no successful load
let _lastDataOk = 0;

function noteDataLoaded() {
  _lastDataOk = Date.now();
  refreshLiveIndicator();
}

function refreshLiveIndicator() {
  const wrap  = document.getElementById('live-indicator');
  const label = document.getElementById('live-label');
  if (!wrap || !label) return;
  // navigator.onLine only reliably reports the DISCONNECTED case, so treat it
  // as a fast hint and still fall back to the staleness clock.
  const offline = navigator.onLine === false;
  const stale   = !_lastDataOk || (Date.now() - _lastDataOk) >= LIVE_STALE_MS;
  const isLive  = !offline && !stale;

  wrap.classList.toggle('live',  isLive);
  wrap.classList.toggle('stale', !isLive);
  label.textContent = offline ? 'Offline' : isLive ? 'Live' : 'Stale';
  wrap.title = _lastDataOk
    ? `Last successful update ${relTime(_lastDataOk)}`
    : 'No data loaded yet';
}

function showState(bodyId, icon, msg) {
  document.getElementById(bodyId).innerHTML =
    `<div class="state"><span style="font-size:22px">${icon}</span><span>${msg}</span></div>`;
}

function showLoading(bodyId) {
  const el = document.getElementById(bodyId);
  if (el) el.innerHTML = `<div class="state"><div class="spinner"></div></div>`;
}

function esc(value) {
  return String(value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relTime(ms) {
  const ageSeconds = (Date.now() - ms) / 1000;
  if (ageSeconds < 60)    return `${Math.round(ageSeconds)}s ago`;
  if (ageSeconds < 3600)  return `${Math.floor(ageSeconds/60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds/3600)}h ago`;
  return `${Math.floor(ageSeconds/86400)}d ago`;
}

/* ══════════════════════════════════════════════════════
   THEME SYSTEM
══════════════════════════════════════════════════════ */

const THEMES = [
  // Design
  { id: '',                    label: 'Everforest' },
  { id: 'theme-nord',          label: 'Nord' },
  { id: 'theme-dracula',       label: 'Dracula' },
  { id: 'theme-solarized',     label: 'Solarized' },
  { id: 'theme-catppuccin',    label: 'Catppuccin' },
  { id: 'theme-high-contrast', label: 'High Contrast' },
  // Styled
  { id: 'theme-terminal',      label: 'Terminal' },
  { id: 'theme-amber',         label: 'Amber CRT' },
  { id: 'theme-blueprint',     label: 'Blueprint' },
  { id: 'theme-industrial',    label: 'Industrial' },
  { id: 'theme-military',      label: 'Military' },
  // Atmospheric
  { id: 'theme-synthwave',     label: 'Synthwave' },
  { id: 'theme-deepsea',       label: 'Deep Sea' },
  { id: 'theme-volcanic',      label: 'Volcanic' },
  { id: 'theme-vaporwave',     label: 'Vaporwave' },
  { id: 'theme-arctic',        label: 'Arctic' },
  { id: 'theme-midnight',      label: 'Midnight City' },
  // Character
  { id: 'theme-brutalist',     label: 'Brutalist' },
  { id: 'theme-espresso',      label: 'Espresso' },
  { id: 'theme-cyberpunk',     label: 'Cyberpunk' },
  { id: 'theme-autumn',        label: 'Autumn' },
  { id: 'theme-rosegold',      label: 'Rose Gold' },
  { id: 'theme-desert',        label: 'Desert' },
  // Glass
  { id: 'theme-glass',         label: 'Glass' },
];

function setTheme(themeId) {
  // Remove all theme classes from <html>
  for (const theme of THEMES) {
    if (theme.id) document.documentElement.classList.remove(theme.id);
  }
  // Apply new theme
  if (themeId) document.documentElement.classList.add(themeId);
  localStorage.setItem('dashboard-theme', themeId);
  // Update active indicator in menu
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === themeId);
  });
  // Update font — each theme may set a different --font
  document.body.style.fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
  // Close menu
  document.getElementById('theme-menu')?.classList.remove('open');
}

function toggleThemeMenu() {
  document.getElementById('theme-menu')?.classList.toggle('open');
}

// Close theme menu on outside click
document.addEventListener('click', event => {
  const selector = document.getElementById('theme-selector');
  if (selector && !selector.contains(event.target)) {
    document.getElementById('theme-menu')?.classList.remove('open');
  }
});

// Restore saved theme on load
(function restoreTheme() {
  const saved = localStorage.getItem('dashboard-theme') || '';
  if (saved) {
    document.documentElement.classList.add(saved);
    document.body.style.fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
  }
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === saved);
  });
})();

/* ══════════════════════════════════════════════════════
   UI — clock, responsive sidebars, header toggles
══════════════════════════════════════════════════════ */

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hourCycle: 'h23' });
  const tzAbbr  = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
  document.getElementById('clock').textContent = `${timeStr} ${tzAbbr}`;
}

setInterval(updateClock, 1000);
updateClock();

/* The sidebars' collapse mechanism already exists and works — it is simply
   never invoked automatically. On narrow viewports their combined 430px of
   fixed width leaves no room for the map, so collapse them on load. The
   toggle strips still open them; mobile CSS then floats them over the map. */
let _respTimer = null;

function applyResponsiveSidebars() {
  if (!window.matchMedia('(max-width: 1200px)').matches) return;
  const narrow  = window.matchMedia('(max-width: 640px)').matches;
  const targets = [document.querySelector('.map-legend-sidebar')];
  if (narrow) targets.push(document.querySelector('.map-layers-sidebar'));

  for (const el of targets) {
    if (!el || el.classList.contains('collapsed')) continue;
    // The sidebars animate `width`, but collapsing them programmatically at
    // boot has no stable starting width to animate FROM — the transition then
    // latches at the pre-collapse value and the element never reaches 28px.
    // Suppress the transition for this one change, then restore it so the
    // user's own toggle still animates.
    el.style.transition = 'none';
    el.classList.add('collapsed');
    el.offsetWidth;                    // force reflow so the change is committed
    requestAnimationFrame(() => { el.style.transition = ''; });
  }
  map?.invalidateSize?.();
}

function toggleMapLayers() {
  document.getElementById('map-layers-sidebar').classList.toggle('collapsed');
  setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

function toggleMapLegend() {
  document.getElementById('map-legend-sidebar').classList.toggle('collapsed');
  setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

let _satActive = false;

function toggleSatellite() {
  _satActive = !_satActive;
  if (_satActive) {
    map.removeLayer(baseDark);
    map.removeLayer(baseDarkLabels);
    baseSat.addTo(map);
    baseSat.bringToBack();
    baseSatLabels.addTo(map);
  } else {
    map.removeLayer(baseSat);
    map.removeLayer(baseSatLabels);
    baseDark.addTo(map);
    baseDark.bringToBack();
    baseDarkLabels.addTo(map);
  }
  const btn = document.getElementById('sat-toggle');
  if (btn) btn.classList.toggle('active', _satActive);
}

/* ── Collapsible geo sections ───────────────────────── */
function toggleGeoSection(name, headerEl) {
  const section = document.getElementById(`geo-section-${name}`);
  if (!section) return;
  const collapsed = section.classList.toggle('collapsed');
  headerEl.classList.toggle('collapsed', collapsed);
}

/* ══════════════════════════════════════════════════════
   MAP  —  Leaflet + Esri basemaps + overlay layers
══════════════════════════════════════════════════════ */

let map, baseDark, baseSat, baseDarkLabels, baseSatLabels, eqLayer, easLayer, eonetLayer, droughtLayer, lsrLayer, gaugeLayer, volcLayer, gdacsLayer, meteoalarmLayer, wmoLayer, spcD1Layer, spcD2Layer, spcD3Layer, fwxD1Layer, fwxD2Layer, mscLayer, radarLayer, rainviewerLayer, imergLayer, goesWLayer, goesELayer, meteosatLayer, himawariLayer, graceLayer, smapRootLayer, smapSurfLayer, dwdRadarLayer, fmiRadarLayer, sstLayer, seaIceLayer, windLayer, ozoneLayer, so2Layer;

// Daily swath composites are assembled orbit-by-orbit as data downlinks, so a
// day stays incomplete for a while after it ends. Measured tile coverage at z3:
// today 10/24, yesterday 21/24, two days back 24/24. Pin to 2 for full coverage.
const GIBS_DAILY_OFFSET = 2;

// GIBS daily products want a YYYY-MM-DD date.
function gibsDayOffsetUTC(daysBack) {
  const d = new Date(Date.now() - daysBack * 86400_000);
  return d.toISOString().slice(0, 10);
}

// If the page is left open across a UTC midnight the pinned date goes stale,
// so re-point the daily layers when the target date changes.
function refreshGibsDailyLayers() {
  const day = gibsDayOffsetUTC(GIBS_DAILY_OFFSET);
  const swap = (layer, product) => {
    if (!layer) return;
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${product}` +
                `/default/${day}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
    if (layer._url !== url) layer.setUrl(url);
  };
  swap(ozoneLayer, 'OMPS_Ozone_Total_Column');
  swap(so2Layer,   'OMI_SO2_Lower_Troposphere');
}

function initMap() {
  map = L.map('map', {
    center: [20, 10],
    zoom: 2,
    minZoom: 2,
    zoomControl: false,
    attributionControl: true,
    maxBounds: [[-85, -180], [85, 180]],
    maxBoundsViscosity: 1.0,
  });

  // Prevent world-repeat: keep minZoom high enough that the map always fills
  // the container with exactly one world copy, recalculated on resize.
  function _updateMinZoom() {
    const W = map.getContainer().offsetWidth;
    const H = map.getContainer().offsetHeight;
    const minZ = Math.ceil(Math.log2(Math.max(W, H) / 256));
    map.setMinZoom(Math.max(minZ, 1));
    if (map.getZoom() < map.getMinZoom()) map.setZoom(map.getMinZoom());
  }
  _updateMinZoom();
  map.on('resize', _updateMinZoom);

  /* Popups near the ±180° edge: Leaflet's autoPan tries to pan the map to fit
     the popup, maxBounds (viscosity 1) snaps it straight back, and the popup is
     left hanging off the map. Instead, slide the popup box sideways to fit and
     leave its tip on the marker. A marker within a few pixels of the edge would
     leave the tip past the box's corner, so the tip is hidden there and the box
     still moves fully inside. Re-run after every move, since the snap-back
     lands after popupopen. */
  function _fitPopupInMap() {
    const popupEl = map._popup?.getElement();
    if (!popupEl) return;
    const box   = popupEl.querySelector('.leaflet-popup-content-wrapper');
    const close = popupEl.querySelector('.leaflet-popup-close-button');
    const tip   = popupEl.querySelector('.leaflet-popup-tip-container');
    const parts = [box, close].filter(Boolean);
    parts.forEach(el => { el.style.transform = ''; });
    if (tip) tip.style.visibility = '';

    const pad     = 8;
    const mapRect = map.getContainer().getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    let shift = 0;
    if (boxRect.left < mapRect.left + pad)        shift = mapRect.left + pad - boxRect.left;
    else if (boxRect.right > mapRect.right - pad) shift = mapRect.right - pad - boxRect.right;
    // The tip only stays attached while it sits under the box, clear of the rounded corners
    if (tip && Math.abs(shift) > boxRect.width / 2 - 24) tip.style.visibility = 'hidden';
    if (shift) parts.forEach(el => { el.style.transform = `translateX(${Math.round(shift)}px)`; });
  }
  map.on('popupopen moveend zoomend resize', _fitPopupInMap);

  // Basemap layers — swappable via header toggle
  // Esri Dark Gray Canvas: keyless, same provider as baseSat. Tile path is
  // {z}/{y}/{x} with no file extension.
  baseDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  });
  baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19
  });

  // Both basemaps are label-free; Esri publishes the place names as separate
  // transparent reference layers. Their pane sits above alert polygons (400) and
  // raster overlays, below markers (600), and ignores the mouse so clicks still
  // reach the shapes underneath.
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  baseDarkLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    pane: 'labels', maxZoom: 19
  });
  baseSatLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    pane: 'labels', maxZoom: 19
  });
  baseDark.addTo(map);
  baseDarkLabels.addTo(map);

  // Zoom control — bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // NEXRAD radar — Iowa State IEM composite reflectivity (CONUS, no API key)
  // Starts hidden; added below the event layers so markers render on top
  radarLayer = L.tileLayer(
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
    {
      attribution: 'NEXRAD &copy; <a href="https://mesonet.agron.iastate.edu/" target="_blank">Iowa State IEM</a>',
      opacity: 0.65,
      zIndex: 5
    }
  );

  // NASA GIBS — IMERG global precipitation rate (satellite-derived, ~30 min lag)
  // Note: GIBS WMTS uses TileMatrix/TileRow/TileCol → {z}/{y}/{x} in Leaflet template
  const _gibsBase = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
  const _gibsTms  = 'GoogleMapsCompatible_Level6';
  // Some GIBS products are published at a deeper tile matrix set — using the
  // wrong one returns 404s that Leaflet swallows silently (blank layer).
  const _gibsTms7 = 'GoogleMapsCompatible_Level7';
  imergLayer = L.tileLayer(
    `${_gibsBase}/IMERG_Precipitation_Rate/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'IMERG &copy; <a href="https://gpm.nasa.gov/" target="_blank">NASA GPM</a>',
      opacity: 0.7,
      maxNativeZoom: 6,
      zIndex: 4
    }
  );

  // NASA GIBS — GOES-West Band 13 Clean Infrared (covers Pacific + PNG region)
  goesWLayer = L.tileLayer(
    `${_gibsBase}/GOES-West_ABI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'GOES-West IR &copy; <a href="https://www.nesdis.noaa.gov/" target="_blank">NOAA/NESDIS</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 4
    }
  );

  // NASA GIBS — GOES-East Band 13 Clean Infrared (covers Americas + Atlantic)
  goesELayer = L.tileLayer(
    `${_gibsBase}/GOES-East_ABI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'GOES-East IR &copy; <a href="https://www.nesdis.noaa.gov/" target="_blank">NOAA/NESDIS</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 4
    }
  );

  // EUMETSAT EUMETView — MTG-I FCI IR 10.5 µm full disk (0°), 10-min cadence.
  // The operator's own service: CORS-enabled, no key, no quota. Omitting
  // `time` serves the latest frame, and style_02 is the enhanced-IR ramp that
  // matches the GOES/Himawari look.
  meteosatLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
    layers:      'mtg_fd:ir105_hrfi',
    styles:      'mtg_fd:mtg_fd_ir105_hrfi_style_02',
    format:      'image/png',
    transparent: true,
    opacity:     0.75,
    zIndex:      4,
    attribution: 'Meteosat MTG-I FCI &copy; <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a>',
  });

  // NASA GIBS — Himawari AHI Band 13 Clean Infrared (East Asia / W Pacific),
  // 10-minute cadence.
  himawariLayer = L.tileLayer(
    `${_gibsBase}/Himawari_AHI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'Himawari AHI &copy; <a href="https://www.data.jma.go.jp/mscweb/en/index.html" target="_blank">JMA</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 4
    }
  );

  // NASA GIBS — GRACE-FO groundwater anomaly (global drought proxy, monthly)
  graceLayer = L.tileLayer(
    `${_gibsBase}/GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'GRACE Groundwater &copy; <a href="https://grace.jpl.nasa.gov/" target="_blank">NASA/JPL GRACE</a> via NASA GIBS',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 3
    }
  );

  // NASA GIBS — SMAP root-zone soil moisture (global, ~3-day lag)
  smapRootLayer = L.tileLayer(
    `${_gibsBase}/SMAP_L4_Analyzed_Root_Zone_Soil_Moisture/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'SMAP Root Zone &copy; <a href="https://smap.jpl.nasa.gov/" target="_blank">NASA SMAP</a> via NASA GIBS',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 3
    }
  );

  // NASA GIBS — SMAP surface soil moisture (global, daily passive microwave)
  smapSurfLayer = L.tileLayer(
    `${_gibsBase}/SMAP_L3_Passive_Day_Soil_Moisture/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'SMAP Surface &copy; <a href="https://smap.jpl.nasa.gov/" target="_blank">NASA SMAP</a> via NASA GIBS',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 3
    }
  );

  // NASA GIBS — GHRSST MUR sea surface temperature (1 km, daily L4 analysis)
  sstLayer = L.tileLayer(
    `${_gibsBase}/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/${_gibsTms7}/{z}/{y}/{x}.png`,
    {
      attribution: 'SST &copy; <a href="https://podaac.jpl.nasa.gov/" target="_blank">NASA/JPL MUR</a> via NASA GIBS',
      opacity: 0.75,
      maxNativeZoom: 7,
      zIndex: 3
    }
  );

  // NASA GIBS — GHRSST MUR sea ice concentration (companion product to SST)
  seaIceLayer = L.tileLayer(
    `${_gibsBase}/GHRSST_L4_MUR_Sea_Ice_Concentration/default/default/${_gibsTms7}/{z}/{y}/{x}.png`,
    {
      attribution: 'Sea Ice &copy; <a href="https://podaac.jpl.nasa.gov/" target="_blank">NASA/JPL MUR</a> via NASA GIBS',
      opacity: 0.8,
      maxNativeZoom: 7,
      // above sstLayer (3) so ice always draws on top of the water beneath it
      zIndex: 4
    }
  );

  // ── Atmospheric composition (daily polar-orbiter products) ──
  // These are swath-based and assembled progressively, so recent days have
  // ragged western coverage. See GIBS_DAILY_OFFSET for the measured numbers.
  ozoneLayer = L.tileLayer(
    `${_gibsBase}/OMPS_Ozone_Total_Column/default/${gibsDayOffsetUTC(GIBS_DAILY_OFFSET)}/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'Ozone &copy; <a href="https://ozoneaq.gsfc.nasa.gov/" target="_blank">NASA OMPS / Suomi NPP</a> via NASA GIBS',
      opacity: 0.7,
      maxNativeZoom: 6,
      zIndex: 3
    }
  );

  so2Layer = L.tileLayer(
    `${_gibsBase}/OMI_SO2_Lower_Troposphere/default/${gibsDayOffsetUTC(GIBS_DAILY_OFFSET)}/${_gibsTms}/{z}/{y}/{x}.png`,
    {
      attribution: 'SO&#8322; &copy; <a href="https://aura.gsfc.nasa.gov/" target="_blank">NASA OMI / Aura</a> via NASA GIBS',
      opacity: 0.75,
      maxNativeZoom: 6,
      zIndex: 3
    }
  );

  // DWD German radar composite (WMS, 1x1 km, 5-min analysis).
  dwdRadarLayer = L.tileLayer.wms('https://maps.dwd.de/geoserver/dwd/wms', {
    layers: 'dwd:Radar_wn-analysis_1x1km_ger',
    format: 'image/png',
    transparent: true,
    opacity: 0.65,
    attribution: 'Radar &copy; <a href="https://www.dwd.de/" target="_blank">DWD</a>',
    zIndex: 5,
  });

  // FMI Finnish national radar dBZ composite (WMS, 5-min cadence)
  fmiRadarLayer = L.tileLayer.wms('https://openwms.fmi.fi/geoserver/wms', {
    layers: 'Radar:suomi_dbz_eureffin',
    format: 'image/png',
    transparent: true,
    opacity: 0.65,
    attribution: 'Radar &copy; <a href="https://en.ilmatieteenlaitos.fi/" target="_blank">FMI</a>',
    zIndex: 5,
  });

  // All overlay layers start hidden — user enables what they want
  windLayer       = L.layerGroup();
  droughtLayer    = L.layerGroup();
  spcD2Layer      = L.layerGroup();
  spcD3Layer      = L.layerGroup();
  fwxD2Layer      = L.layerGroup();
  spcD1Layer      = L.layerGroup();
  fwxD1Layer      = L.layerGroup();
  lsrLayer        = L.layerGroup();
  gaugeLayer      = L.layerGroup();
  volcLayer       = L.layerGroup();
  gdacsLayer      = L.layerGroup();
  meteoalarmLayer = L.layerGroup();
  wmoLayer        = L.layerGroup([], { attribution: 'Alerts via <a href="https://severeweather.wmo.int/" target="_blank">WMO SWIC</a>; Australia &copy; <a href="http://www.bom.gov.au/" target="_blank">Bureau of Meteorology</a>' });
  mscLayer        = L.layerGroup();
  easLayer        = L.layerGroup();
  eonetLayer      = L.layerGroup();
  eqLayer         = L.layerGroup();

  // Legend is the collapsible right-side sidebar (#map-legend-sidebar) — no Leaflet control needed
}

function updateMapCount() {
  let visibleCount = 0;
  if (document.getElementById('toggle-eq')?.checked)    visibleCount += eqData.length;
  if (document.getElementById('toggle-eas')?.checked)   visibleCount += easData.length;
  if (document.getElementById('toggle-eonet')?.checked) visibleCount += eonetData.length;
  document.getElementById('map-count').textContent = visibleCount;
}

// Ensure a map layer is visible before flying to it
function ensureLayerOn(which) {
  const checkbox = document.getElementById(`toggle-${which}`);
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    toggleLayer(which);
  }
}

function toggleLayer(which) {
  if (!map) return;
  // Dynamic layers (created async) — handle via shared lookup
  const dynamicMap = { rainviewer: rainviewerLayer };
  if (which in dynamicMap) {
    const layer = dynamicMap[which];
    const el = document.getElementById(`toggle-${which}`);
    if (layer) el?.checked ? map.addLayer(layer) : map.removeLayer(layer);
    // If checked but layer not yet loaded, the load function will add it when ready
    updateMapCount();
    return;
  }
  const layers = { eq: eqLayer, eas: easLayer, lsr: lsrLayer, eonet: eonetLayer, drought: droughtLayer, gauge: gaugeLayer, volc: volcLayer, gdacs: gdacsLayer, meteoalarm: meteoalarmLayer, wmo: wmoLayer, 'spc-d1': spcD1Layer, 'spc-d2': spcD2Layer, 'spc-d3': spcD3Layer, 'fwx-d1': fwxD1Layer, 'fwx-d2': fwxD2Layer, msc: mscLayer, radar: radarLayer, imerg: imergLayer, goesw: goesWLayer, goese: goesELayer, grace: graceLayer, 'smap-root': smapRootLayer, 'smap-surf': smapSurfLayer, 'dwd-radar': dwdRadarLayer, 'fmi-radar': fmiRadarLayer, sst: sstLayer, seaice: seaIceLayer, wind: windLayer, ozone: ozoneLayer, so2: so2Layer, himawari: himawariLayer, meteosat: meteosatLayer };
  const el = document.getElementById(`toggle-${which}`);
  if (el && layers[which]) {
    el.checked ? map.addLayer(layers[which]) : map.removeLayer(layers[which]);
  }
  // Wind is fetched per-viewport, so it needs data the moment it's switched on
  if (which === 'wind') {
    if (el?.checked) loadWind();
    else { _windAbort?.abort(); windData = []; windLayer?.clearLayers(); }
  }
  updateMapCount();
}

/* ══════════════════════════════════════════════════════
   RAINVIEWER — Global radar tiles
══════════════════════════════════════════════════════ */

async function loadRainviewer() {
  try {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const frames = payload.radar?.past || [];
    if (!frames.length) return;
    const latest = frames[frames.length - 1];
    const host   = payload.host || 'https://tilecache.rainviewer.com';
    // Colour scheme 2 (Universal Blue): the free API ignores this value and
    // always serves scheme 2, so request it explicitly to match the legend.
    // "1_1" = smoothed, with snow shown in its own colours.
    const tileUrl = `${host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

    const wasOnMap = rainviewerLayer && map.hasLayer(rainviewerLayer);
    if (rainviewerLayer) map.removeLayer(rainviewerLayer);

    rainviewerLayer = L.tileLayer(tileUrl, {
      attribution: 'Global Radar &copy; <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
      opacity: 0.65,
      zIndex: 5
    });

    // Re-add if it was visible before refresh, or if toggle is checked
    if (wasOnMap || document.getElementById('toggle-rainviewer')?.checked) {
      rainviewerLayer.addTo(map);
    }
  } catch (err) {
    console.warn('RainViewer fetch failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════
   MAP SEARCH — Photon geocoder (addresses/places) + live events
   Photon is keyless and CORS-open, handles house-number addresses
   from partial input, and is biased toward the current map centre so
   bare place names resolve near where the user is already looking.
══════════════════════════════════════════════════════ */

let _searchAbort    = null;
let _searchDebounce = null;
let _searchItems    = [];   // flat list of selectable rows, in render order
let _searchActive   = -1;   // keyboard cursor into _searchItems

// OSM key/value → short badge label + colour
function searchBadge(props) {
  const value = props.osm_value || '';
  const key   = props.osm_key   || '';
  if (props.housenumber || value === 'house' || value === 'building')
    return { label: 'Address', color: '#7fbbb3' };
  if (key === 'highway' || value === 'street')  return { label: 'Street',  color: '#7fbbb3' };
  if (value === 'city'   || value === 'town')   return { label: 'City',    color: '#a7c080' };
  if (value === 'village'|| value === 'hamlet' || value === 'locality')
    return { label: 'Town', color: '#a7c080' };
  if (value === 'suburb' || value === 'neighbourhood' || value === 'quarter')
    return { label: 'Area', color: '#a7c080' };
  if (value === 'state'  || value === 'province' || value === 'region')
    return { label: 'Region',  color: '#dbbc7f' };
  if (value === 'country')                      return { label: 'Country', color: '#dbbc7f' };
  if (value === 'aerodrome' || value === 'airport') return { label: 'Airport', color: '#d699b6' };
  if (value === 'peak' || value === 'volcano')  return { label: value === 'volcano' ? 'Volcano' : 'Peak', color: '#e69875' };
  return { label: value ? value.replace(/_/g, ' ').slice(0, 12) : 'Place', color: '#859289' };
}

// Sensible zoom when a feature has no bounding box to fit
function searchZoomFor(props) {
  const value = props.osm_value || '';
  if (props.housenumber || value === 'house' || value === 'building') return 17;
  if (value === 'street')                                             return 16;
  if (value === 'suburb' || value === 'neighbourhood')                return 14;
  if (value === 'village' || value === 'hamlet')                      return 13;
  if (value === 'town')                                               return 12;
  if (value === 'city')                                               return 11;
  if (value === 'state' || value === 'province' || value === 'region') return 7;
  if (value === 'country')                                            return 5;
  return 13;
}

// Human-readable second line for a Photon hit
function searchSubtitle(props) {
  return [props.street && props.housenumber ? `${props.housenumber} ${props.street}`
            : props.street,
          props.city, props.state, props.country]
    .filter(Boolean).join(', ');
}

/* ── Live-event search over data already loaded in the dashboard ── */
function searchLiveEvents(query) {
  const q = query.toLowerCase();
  const hits = [];
  const add  = (badge, color, name, sub, action) => hits.push({ badge, color, name, sub, action });

  for (const quake of eqData) {
    if (hits.length >= 6) break;
    const place = quake.properties?.place || '';
    if (place.toLowerCase().includes(q)) {
      add('Quake', '#dbbc7f',
          `M${(quake.properties.mag ?? 0).toFixed(1)} — ${place}`,
          fmtTime(new Date(quake.properties.time).toISOString()),
          () => flyToEq(quake.id));
    }
  }
  for (const alert of easData) {
    if (hits.length >= 10) break;
    const props = alert.properties || alert;
    const text  = `${props.event || ''} ${props.areaDesc || ''}`.toLowerCase();
    if (text.includes(q)) {
      add('Alert', '#e67e80', props.event || 'Alert',
          (props.areaDesc || '').split(';')[0].trim(), () => flyToAlert(alert.id));
    }
  }
  for (const event of gdacsData) {
    if (hits.length >= 13) break;
    if (`${event.name || ''} ${event.country || ''}`.toLowerCase().includes(q)) {
      add('GDACS', '#a7c080', event.name || event.type,
          event.country || '', () => flyToGDACS(event.guid));
    }
  }
  for (const volcano of vhpData) {
    if (hits.length >= 16) break;
    if ((volcano.volcano_name || '').toLowerCase().includes(q) && volcano.latitude != null) {
      add('Volcano', '#e69875', volcano.volcano_name, volcano.obs_fullname || '',
          () => flyToVolc(`vhp-${volcano.vnum}`, volcano.latitude, volcano.longitude));
    }
  }
  return hits;
}

/* ── Photon geocode, biased toward the current view ── */
async function searchGeocode(query, signal) {
  const params = new URLSearchParams({ q: query, limit: '6' });
  if (map) {
    const center = map.getCenter();
    params.set('lat', center.lat.toFixed(4));
    params.set('lon', center.lng.toFixed(4));
  }
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.features || []).filter(feature => feature.geometry?.coordinates);
}

function renderSearchResults(liveHits, places, { loading = false, failed = false } = {}) {
  const box = document.getElementById('map-search-results');
  if (!box) return;
  _searchItems = [];
  let html = '';

  if (liveHits.length) {
    html += `<div class="map-search-group">On the map now</div>`;
    for (const hit of liveHits) {
      html += `<div class="map-search-item" data-idx="${_searchItems.length}">
        <span class="map-search-badge" style="background:${hit.color}">${esc(hit.badge)}</span>
        <div class="map-search-text">
          <div class="map-search-name">${esc(hit.name)}</div>
          ${hit.sub ? `<div class="map-search-sub">${esc(hit.sub)}</div>` : ''}
        </div>
      </div>`;
      _searchItems.push(hit.action);
    }
  }

  if (places.length) {
    html += `<div class="map-search-group">Places</div>`;
    for (const feature of places) {
      const props = feature.properties || {};
      const badge = searchBadge(props);
      const [lon, lat] = feature.geometry.coordinates;
      const extent = props.extent;   // [minLon, maxLat, maxLon, minLat] when present
      html += `<div class="map-search-item" data-idx="${_searchItems.length}">
        <span class="map-search-badge" style="background:${badge.color}">${esc(badge.label)}</span>
        <div class="map-search-text">
          <div class="map-search-name">${esc(props.name || props.street || 'Unnamed')}</div>
          <div class="map-search-sub">${esc(searchSubtitle(props))}</div>
        </div>
      </div>`;
      _searchItems.push(() => {
        // extent is [minLon, maxLat, maxLon, minLat] when the feature has one
        if (Array.isArray(extent) && extent.length === 4 && extent.every(Number.isFinite)) {
          map.flyToBounds([[extent[3], extent[0]], [extent[1], extent[2]]],
                          { padding: [40, 40], maxZoom: 16, duration: 1 });
        } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
          map.flyTo([lat, lon], searchZoomFor(props), { duration: 1 });
        }
      });
    }
  }

  if (!html) {
    html = `<div class="map-search-state">${
      loading ? 'Searching…' : failed ? 'Search unavailable — try again' : 'No matches'
    }</div>`;
  }

  box.innerHTML = html;
  box.classList.add('open');
  _searchActive = -1;
}

function highlightSearchItem(delta) {
  const rows = [...document.querySelectorAll('.map-search-item')];
  if (!rows.length) return;
  _searchActive = (_searchActive + delta + rows.length) % rows.length;
  rows.forEach((row, i) => row.classList.toggle('active', i === _searchActive));
  rows[_searchActive].scrollIntoView({ block: 'nearest' });
}

function closeSearchResults() {
  document.getElementById('map-search-results')?.classList.remove('open');
  _searchActive = -1;
}

function runSearchItem(index) {
  const action = _searchItems[index];
  if (!action) return;
  // Leaflet throws on a zero-size map container (hidden tab) and on malformed
  // geocoder geometry. Either way the dropdown must still close, or it strands.
  try { action(); }
  catch (err) { console.warn('Search navigation failed:', err.message); }
  closeSearchResults();
  document.getElementById('map-search-input')?.blur();
}

async function performSearch(query) {
  const liveHits = searchLiveEvents(query);
  renderSearchResults(liveHits, [], { loading: true });

  _searchAbort?.abort();
  _searchAbort = new AbortController();
  try {
    const places = await searchGeocode(query, _searchAbort.signal);
    renderSearchResults(liveHits, places);
  } catch (err) {
    if (err.name === 'AbortError') return;         // superseded by a newer keystroke
    console.warn('Geocode failed:', err.message);
    renderSearchResults(liveHits, [], { failed: true });
  }
}

function initMapSearch() {
  const wrap  = document.getElementById('map-search');
  const input = document.getElementById('map-search-input');
  const clear = document.getElementById('map-search-clear');
  const box   = document.getElementById('map-search-results');
  if (!wrap || !input || !box) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    wrap.classList.toggle('has-text', query.length > 0);
    clearTimeout(_searchDebounce);
    if (query.length < 2) { _searchAbort?.abort(); closeSearchResults(); return; }
    _searchDebounce = setTimeout(() => performSearch(query), 250);
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown')      { event.preventDefault(); highlightSearchItem(1); }
    else if (event.key === 'ArrowUp')   { event.preventDefault(); highlightSearchItem(-1); }
    else if (event.key === 'Enter')     { event.preventDefault(); runSearchItem(_searchActive >= 0 ? _searchActive : 0); }
    else if (event.key === 'Escape')    { closeSearchResults(); input.blur(); }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2 && _searchItems.length) box.classList.add('open');
  });

  box.addEventListener('click', event => {
    const row = event.target.closest('.map-search-item');
    if (row) runSearchItem(+row.dataset.idx);
  });

  clear?.addEventListener('click', () => {
    input.value = '';
    wrap.classList.remove('has-text');
    _searchAbort?.abort();
    closeSearchResults();
    input.focus();
  });

  // Dismiss when clicking anywhere else
  document.addEventListener('click', event => {
    if (!wrap.contains(event.target)) closeSearchResults();
  });

  // Leaflet swallows keystrokes that reach the map container
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
}

/* ══════════════════════════════════════════════════════
   EARTHQUAKES  —  USGS
══════════════════════════════════════════════════════ */

let eqData = [];

async function loadEarthquakes() {
  showLoading('eq-body');
  const feed = document.getElementById('eq-feed').value;
  try {
    let url;
    if (feed === 'all_12h') {
      const start = new Date(Date.now() - 12*3600*1000).toISOString();
      url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&orderby=time`;
    } else {
      url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    eqData = (payload.features || []).sort((quakeA, quakeB) => quakeB.properties.mag - quakeA.properties.mag);
    markUpdated('eq-updated');
    renderEarthquakes();
  } catch (err) {
    showState('eq-body','⚠️', `Failed: ${err.message}`);
  }
}

function magClass(m) {
  if (m >= 8) return 'mag-great';
  if (m >= 7) return 'mag-major';
  if (m >= 6) return 'mag-strong';
  if (m >= 5) return 'mag-moderate';
  if (m >= 4) return 'mag-light';
  return 'mag-minor';
}

function magLabel(m) {
  if (m >= 8) return 'Great';
  if (m >= 7) return 'Major';
  if (m >= 6) return 'Strong';
  if (m >= 5) return 'Moderate';
  if (m >= 4) return 'Light';
  if (m >= 3) return 'Minor';
  return 'Micro';
}

// Magnitude → fill color (Everforest palette)
function magFillColor(m) {
  if (m >= 7.0) return '#e67e80';  // red
  if (m >= 6.0) return '#e69875';  // orange
  if (m >= 5.0) return '#dbbc7f';  // yellow
  if (m >= 4.0) return '#a7c080';  // green
  return '#83c092';                // aqua
}

function renderEarthquakes() {
  const minMag   = parseFloat(document.getElementById('eq-minmag').value) || 0;
  const filtered = eqData.filter(quake => (quake.properties.mag || 0) >= minMag);
  document.getElementById('eq-count').textContent = filtered.length;

  if (!filtered.length) {
    showState('eq-body','🟢','No events match filters.');
    plotEarthquakes();
    return;
  }

  let html = `<table>
    <thead><tr>
      <th>Mag</th><th>Location</th><th>Depth</th><th>Time (Local)</th>
    </tr></thead><tbody>`;

  for (const quake of filtered) {
    const props = quake.properties;
    const mag   = props.mag != null ? props.mag.toFixed(1) : '?';
    const depth = quake.geometry?.coordinates?.[2];
    const timeStr = props.time ? fmtTime(new Date(props.time).toISOString()) : '—';
    const cls   = magClass(parseFloat(mag));
    const isRecent = (Date.now() - (props.time||0)) < 3600_000;

    html += `<tr data-id="${esc(quake.id)}" onclick="flyToEq('${esc(quake.id)}')" title="Click to locate on map">
      <td><span class="mag ${cls}" data-tip="${magLabel(parseFloat(mag))}">${mag}</span></td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${isRecent ? '<span style="color:var(--green);font-weight:700;margin-right:3px">●</span>' : ''}
        ${esc(props.place || 'Unknown')}
      </td>
      <td style="white-space:nowrap;color:var(--muted)">${depth != null ? depth.toFixed(0)+' km' : '—'}</td>
      <td style="white-space:nowrap;color:var(--muted);font-size:10px">${timeStr}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  document.getElementById('eq-body').innerHTML = html;
  plotEarthquakes();
  buildGlobalSummary();

  buildAlertBar();
}

// Plot earthquake circle markers
function plotEarthquakes() {
  if (!map) return;
  eqLayer.clearLayers();
  const minMag = parseFloat(document.getElementById('eq-minmag').value) || 0;

  for (const quake of eqData) {
    const props = quake.properties;
    const mag = props.mag ?? 0;
    if (mag < minMag) continue;
    if (!quake.geometry?.coordinates) continue;

    const [lon, lat, depth] = quake.geometry.coordinates;
    const color  = magFillColor(mag);
    const radius = Math.max(4, mag * 3.8);
    const isRecent = (Date.now() - (props.time || 0)) < 3600_000; // < 1 hour

    const marker = L.circleMarker([lat, lon], {
      radius,
      fillColor:   color,
      color:       isRecent ? '#fff' : color,
      weight:      isRecent ? 1.5   : 0.6,
      opacity:     0.9,
      fillOpacity: 0.5
    });

    marker.bindPopup(`
      <div class="popup-inner">
        <div class="popup-title">M${mag.toFixed(1)} — ${esc(props.place || 'Unknown location')}</div>
        <div class="popup-sub">${fmtTime(new Date(props.time).toISOString())} ${isRecent ? '· <b style="color:#50fa7b">Recent</b>' : ''}</div>
        <div class="popup-row"><span>Depth</span><span>${depth != null ? depth.toFixed(1)+' km' : '—'}</span></div>
        <div class="popup-row"><span>Scale</span><span>${magLabel(mag)}</span></div>
        ${props.felt != null ? `<div class="popup-row"><span>Felt reports</span><span>${props.felt.toLocaleString()}</span></div>` : ''}
        ${props.url ? `<a class="popup-link" href="${esc(props.url)}" target="_blank" rel="noopener">View on USGS ↗</a>` : ''}
      </div>
    `);

    // Highlight matching row on click
    marker.on('click', () => highlightEqRow(quake.id));

    eqLayer.addLayer(marker);
  }
  updateMapCount();
}

// Pan map to a given earthquake row
function highlightEqRow(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    row.scrollIntoView({ behavior:'smooth', block:'nearest' });
    row.style.outline = '1px solid var(--accent)';
    setTimeout(() => row.style.outline = '', 1800);
  }
}

// Pan map to earthquake when row is clicked
function flyToEq(id) {
  ensureLayerOn('eq');
  const quake = eqData.find(entry => entry.id === id);
  if (!quake?.geometry?.coordinates) return;
  const [lon, lat] = quake.geometry.coordinates;
  map.flyTo([lat, lon], Math.max(map.getZoom(), 5), { duration: 1 });
  // open its popup
  eqLayer.eachLayer(marker => {
    if (marker.getLatLng) {
      const pos = marker.getLatLng();
      if (Math.abs(pos.lat - lat) < 0.001 && Math.abs(pos.lng - lon) < 0.001) {
        marker.openPopup();
      }
    }
  });
}

/* ══════════════════════════════════════════════════════
   EAS / NWS ALERTS
══════════════════════════════════════════════════════ */

let easData = [];

/* ── NWS alerts by state ───────────────────────────────────────────
   Every alert lists UGC zone codes ("ARC031", "OHZ045"); the first two
   letters are the state, or a marine area for coastal/offshore waters and
   the Great Lakes. An alert spanning several states appears in each of
   them, with its area text trimmed to that state's counties. */
const US_STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado',
  CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky',
  LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota',
  MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
  NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
  PR:'Puerto Rico', VI:'U.S. Virgin Islands', GU:'Guam', AS:'American Samoa', MP:'Northern Mariana Islands',
};

// Marine UGC prefixes → the water body panel they are listed under
const US_MARINE_AREAS = {
  AN:'Atlantic Coast', AM:'Atlantic Coast', GM:'Gulf Coast', PZ:'Pacific Coast',
  PK:'Alaska Waters', PH:'Hawaii Waters', PM:'Western Pacific', PS:'Western Pacific',
  LM:'Great Lakes', LS:'Great Lakes', LH:'Great Lakes', LE:'Great Lakes', LO:'Great Lakes',
  LC:'Great Lakes', SL:'Great Lakes',
};

const US_REGIONS = {
  'Northeast':     ['CT','DC','DE','MA','MD','ME','NH','NJ','NY','PA','RI','VT'],
  'Southeast':     ['AL','FL','GA','KY','MS','NC','SC','TN','VA','WV'],
  'Midwest':       ['IA','IL','IN','KS','MI','MN','MO','ND','NE','OH','SD','WI'],
  'South Central': ['AR','LA','OK','TX'],
  'Mountain West': ['AZ','CO','ID','MT','NM','NV','UT','WY'],
  'Pacific':       ['AK','CA','HI','OR','WA'],
  'Territories':   ['AS','GU','MP','PR','VI'],
  'Marine':        [...new Set(Object.values(US_MARINE_AREAS))],
};

const NWS_SEV_COLOR = { Extreme:'#e67e80', Severe:'#e69875', Moderate:'#dbbc7f' };
const NWS_SEV_RANK  = { Extreme:3, Severe:2, Moderate:1 };

// Panel key for a UGC code: its state code, or its marine area name
const nwsUgcKey = ugc => US_MARINE_AREAS[ugc.slice(0, 2)] || ugc.slice(0, 2);

// Panel keys an alert belongs to
function nwsAlertAreas(props) {
  return new Set((props.geocode?.UGC || []).map(nwsUgcKey));
}

/* The areaDesc parts for one panel. areaDesc lists one name per UGC code in
   the same order ("Craighead, AR; Hancock, WV" ↔ ARC031, WVC029), so parts are
   matched by position; zone names carry no state suffix ("Suffolk"), so the
   ", XX" suffix is only a fallback if the counts ever differ. */
function nwsAreaFor(props, key) {
  const parts = (props.areaDesc || '').split(';').map(part => part.trim()).filter(Boolean);
  const ugcs  = props.geocode?.UGC || [];
  let mine = [];
  if (parts.length === ugcs.length) mine = parts.filter((part, idx) => nwsUgcKey(ugcs[idx]) === key);
  else if (US_STATE_NAMES[key])     mine = parts.filter(part => part.endsWith(`, ${key}`));
  return (mine.length ? mine : parts).join('; ');
}

function renderStatePanels(alerts) {
  const container = document.getElementById('geo-us-state-panels');
  if (!container) return;
  container.innerHTML = '';

  if (!alerts.length) {
    container.innerHTML = `<div class="nws-states-msg"><div class="all-clear">✅ No active alerts.</div></div>`;
    return;
  }

  // Panel key → alerts, preserving easData's severity order
  const byArea = {};
  for (const alert of alerts) {
    const props = alert.properties || alert;
    for (const key of nwsAlertAreas(props)) {
      (byArea[key] ||= []).push({
        id:       alert.id,
        source:   'nws',
        title:    props.event || 'Unknown Alert',
        severity: props.severity || 'Unknown',
        _sevRank: NWS_SEV_RANK[props.severity] ?? 0,
        color:    NWS_SEV_COLOR[props.severity] || '#859289',
        areaDesc: nwsAreaFor(props, key),
        onset:    props.sent || props.effective || '',
        expires:  props.expires || props.ends || '',
        flyFn:    `flyToAlert('${String(alert.id).replace(/'/g, "\\'")}')`,
      });
    }
  }

  const regions = Object.entries(US_REGIONS);
  // Anything unrecognised (a new marine prefix, say) still gets shown
  const unknown = Object.keys(byArea).filter(key => !regions.some(([, keys]) => keys.includes(key)));
  if (unknown.length) regions.push(['Other', unknown]);

  for (const [region, keys] of regions) {
    const panels = keys.filter(key => byArea[key]).sort((keyA, keyB) =>
      byArea[keyB][0]._sevRank - byArea[keyA][0]._sevRank || byArea[keyB].length - byArea[keyA].length);
    if (!panels.length) continue;

    const srId = `geo-sr-us-${region.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const collapsed = _collapsedSubregions.has(srId);
    const lbl = document.createElement('div');
    lbl.className = 'geo-subregion-label' + (collapsed ? ' collapsed' : '');
    lbl.innerHTML = `${esc(region)}<span class="geo-sr-chevron">▾</span>`;
    lbl.onclick = () => toggleSubregion(srId, lbl);
    container.appendChild(lbl);

    const srSection = document.createElement('div');
    srSection.className = 'geo-section' + (collapsed ? ' collapsed' : '');
    srSection.id = srId;
    container.appendChild(srSection);

    for (const key of panels) {
      srSection.appendChild(buildCountryPanel(key, byArea[key], { label: US_STATE_NAMES[key] || key, showSources: false }));
    }
  }
}

async function loadAlerts() {
  const sevParam = 'severity=Extreme,Severe,Moderate';
  const url = `https://api.weather.gov/alerts/active?${sevParam}`;

  try {
    const response = await fetch(url, { headers:{ 'Accept':'application/geo+json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const sevOrder = { Extreme:0, Severe:1, Moderate:2, Unknown:3 };
    easData = (payload.features || []).sort((alertA, alertB) => {
      const propsA = alertA.properties || alertA, propsB = alertB.properties || alertB;
      return (sevOrder[propsA.severity]??4) - (sevOrder[propsB.severity]??4);
    });
    markUpdated('eas-updated');
    renderAlerts();
  } catch (err) {
    // Keep the last good panels on a failed refresh; only fill an empty section
    const container = document.getElementById('geo-us-state-panels');
    if (container && !easData.length) {
      container.innerHTML = `<div class="nws-states-msg"><div class="state"><span style="font-size:22px">⚠️</span><span>NWS alerts failed: ${esc(err.message)}</span></div></div>`;
    }
  }
}

function renderAlerts() {
  const sevFilter = document.getElementById('eas-sev').value;
  const filtered  = easData.filter(alert => {
    const props = alert.properties || alert;
    return sevFilter === 'all' || props.severity === sevFilter;
  });

  document.getElementById('eas-count').textContent = filtered.length;
  renderStatePanels(filtered);
  plotAlerts();
  buildGlobalSummary();

  buildAlertBar();
}

// Plot NWS alert polygons
function plotAlerts() {
  if (!map) return;
  easLayer.clearLayers();

  const sevColor = { Extreme:'#e67e80', Severe:'#e69875', Moderate:'#dbbc7f' };

  for (const alert of easData) {
    if (!alert.geometry) continue;
    const props     = alert.properties || alert;
    const eventName = (props.event || '').toLowerCase();
    // Event-type overrides take priority over severity colour
    let color;
    if (eventName.includes('flood')) color = '#a7c080'; // green — matches standard NWS flood colour
    else                             color = sevColor[props.severity] || '#aaa';

    try {
      const layer = L.geoJSON(alert.geometry, {
        style: {
          color,
          weight:      1.5,
          opacity:     0.85,
          fillColor:   color,
          fillOpacity: 0.12
        }
      });
      layer._alertId = alert.id;

      layer.bindPopup(`
        <div class="popup-inner">
          <div class="popup-title">${esc(props.event || 'Alert')}</div>
          <div class="popup-sub" style="color:${color}">${esc(props.severity || '')} · ${esc(props.urgency || '')}</div>
          <div class="popup-row"><span>Area</span><span style="max-width:140px;text-align:right;white-space:normal">${esc((props.areaDesc||'').substring(0,60))}${(props.areaDesc||'').length>60?'…':''}</span></div>
          <div class="popup-row"><span>Issued</span><span>${fmtTime(props.sent||props.effective||'')}</span></div>
          <div class="popup-row"><span>Expires</span><span>${fmtTime(props.expires||props.ends||'')}</span></div>
          ${props['@id']||props.id ? `<a class="popup-link" href="${esc(props['@id']||props.id)}" target="_blank" rel="noopener">Bulletin ↗</a>` : ''}
        </div>
      `);

      easLayer.addLayer(layer);
    } catch(_) { /* skip malformed geometry */ }
  }
  updateMapCount();
}

// Zone geometry cache — fire/weather zones don't change, so cache indefinitely
const _zoneCache = {};

async function _fetchZoneGeom(url) {
  if (_zoneCache[url]) return _zoneCache[url];
  try {
    const response = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const payload = await response.json();
    _zoneCache[url] = payload.geometry || null;
    return _zoneCache[url];
  } catch(_) { return null; }
}

// Pan map to NWS alert when sidebar row is clicked
async function flyToAlert(id) {
  ensureLayerOn('eas');
  const alert = easData.find(entry => entry.id === id);
  if (!alert) return;

  // Case 1: alert has direct geometry already plotted — find its layer
  let found = false;
  easLayer.eachLayer(layer => {
    if (layer._alertId !== id) return;
    try {
      const bounds = layer.getBounds();
      map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 8, duration: 1 });
      layer.openPopup();
      found = true;
    } catch(_) {}
  });
  if (found) return;

  // Case 2: no direct geometry — fetch first affectedZone polygon on demand
  const zones = alert.properties?.affectedZones;
  if (!zones?.length) return;
  const geom = await _fetchZoneGeom(zones[0]);
  if (!geom) return;
  try {
    const bounds = L.geoJSON(geom).getBounds();
    map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 8, duration: 1 });
    const props = alert.properties || alert;
    const color = { Extreme:'#e67e80', Severe:'#e69875', Moderate:'#dbbc7f' }[props.severity] || '#aaa';
    L.popup()
      .setLatLng(bounds.getCenter())
      .setContent(`
        <div class="popup-inner">
          <div class="popup-title">${esc(props.event || 'Alert')}</div>
          <div class="popup-sub" style="color:${color}">${esc(props.severity||'')} · ${esc(props.urgency||'')}</div>
          <div class="popup-row"><span>Area</span><span style="max-width:140px;text-align:right;white-space:normal">${esc((props.areaDesc||'').substring(0,60))}${(props.areaDesc||'').length>60?'…':''}</span></div>
          <div class="popup-row"><span>Issued</span><span>${fmtTime(props.sent||props.effective||'')}</span></div>
          <div class="popup-row"><span>Expires</span><span>${fmtTime(props.expires||props.ends||'')}</span></div>
          ${props['@id']||props.id ? `<a class="popup-link" href="${esc(props['@id']||props.id)}" target="_blank" rel="noopener">Bulletin ↗</a>` : ''}
        </div>
      `)
      .openOn(map);
  } catch(_) {}
}

/* ══════════════════════════════════════════════════════
   SPACE WEATHER  —  NOAA SWPC
══════════════════════════════════════════════════════ */

let swAlerts = [];
let kpCurrent = null;

// SWPC returns "YYYY-MM-DD HH:MM:SS" with no timezone — always UTC
function swpcUTC(datetimeStr) {
  if (!datetimeStr) return 0;
  return new Date(String(datetimeStr).trim().replace(' ', 'T') + 'Z').getTime();
}

async function loadSpaceWeather() {
  showLoading('sw-body');
  try {
    const [alertsRes, kpRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/products/alerts.json'),
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json')
    ]);

    if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
      const raw = await alertsRes.value.json();
      const cutoff = Date.now() - 7*24*3600*1000;
      swAlerts = raw
        .filter(alert => alert.message && swpcUTC(alert.issue_datetime) >= cutoff)
        .sort((alertA, alertB) => swpcUTC(alertB.issue_datetime) - swpcUTC(alertA.issue_datetime));
    }

    if (kpRes.status === 'fulfilled' && kpRes.value.ok) {
      const kpSeries = await kpRes.value.json();
      // Official 3-hour Kp product: array of objects { Kp, a_running, station_count, time_tag }
      // Find the last entry with a valid (non-null) Kp reading
      if (kpSeries?.length) {
        const latestReading = [...kpSeries].reverse().find(entry => entry.Kp != null && entry.Kp !== '');
        if (latestReading) kpCurrent = parseFloat(latestReading.Kp);
      }
    }

    markUpdated('sw-updated');
    renderSpaceWeather();
  } catch (err) {
    showState('sw-body','⚠️',`Failed: ${err.message}`);
  }
}

const SW_PRODUCT_URLS = {
  geo:   'https://www.swpc.noaa.gov/products/planetary-k-index',
  solar: 'https://www.swpc.noaa.gov/products/solar-radiation-storm',
  radio: 'https://www.swpc.noaa.gov/products/radio-blackout',
  other: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings'
};

function parseSWCategory(msg) {
  const upper = msg.toUpperCase();
  if (upper.includes('GEOMAGNETIC') || upper.includes('K-INDEX') || upper.includes('KP'))
    return { key:'geo',   cls:'cat-geo',   label:'Geomagnetic' };
  if (upper.includes('SOLAR RADIATION') || upper.includes('PROTON'))
    return { key:'solar', cls:'cat-solar', label:'Solar Radiation' };
  if (upper.includes('RADIO BLACKOUT') || upper.includes('X-RAY'))
    return { key:'radio', cls:'cat-radio', label:'Radio Blackout' };
  return { key:'other', cls:'cat-other', label:'Space Weather' };
}

function parseProductTitle(msg) {
  const titleMatch = msg.match(/^([A-Z][A-Z \-]+)\n/);
  if (titleMatch) return titleMatch[1].trim();
  const first = msg.split('\n')[0].trim();
  return first.length < 58 ? first : first.slice(0,55)+'…';
}

function renderSpaceWeather() {
  const catFilter = document.getElementById('sw-cat-filter').value;
  const filtered  = swAlerts.filter(alert =>
    catFilter === 'all' || parseSWCategory(alert.message).key === catFilter
  );

  document.getElementById('sw-count').textContent = filtered.length;
  let html = '';

  // Kp gauge
  if (kpCurrent !== null) {
    const kp      = kpCurrent;
    const kpColor = kp>=9?'#e67e80': kp>=7?'#e69875': kp>=5?'#dbbc7f': kp>=4?'#a7c080':'#83c092';
    const kpLabel = kp>=9?'G5 Extreme': kp>=7?'G3–G4 Severe': kp>=5?'G1–G2 Storm': kp>=4?'Active':'Quiet';
    html += `<div class="kp-bar-row">
      <div class="kp-label">
        <span style="color:var(--muted)">Planetary K-Index (Kp)</span>
        <span style="font-weight:600;color:${kpColor}">${kpLabel}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="kp-value" style="color:${kpColor}">${kp.toFixed(1)}</span>
        <div style="flex:1">
          <div class="kp-scale">
            ${[0,1,2,3,4,5,6,7,8,9].map(segment => {
              const segColor = segment>=9?'#e67e80': segment>=7?'#e69875': segment>=5?'#dbbc7f': segment>=4?'#a7c080':'#83c092';
              return `<div class="kp-seg ${kp>=segment?'active':''}" style="background:${segColor}" data-tip="Kp${segment}"></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:2px">
            <span>0</span><span>5</span><span>9</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  if (!filtered.length) {
    html += `<div class="all-clear">✅ No space weather alerts (7-day window).</div>`;
    document.getElementById('sw-body').innerHTML = html;
    return;
  }

  html += '<div class="sw-alert-list">';
  for (const alert of filtered) {
    const cat   = parseSWCategory(alert.message);
    const title = parseProductTitle(alert.message);
    const body  = alert.message.replace(/\r?\n/g,' ').trim();
    const issued= alert.issue_datetime || null;
    const link  = SW_PRODUCT_URLS[cat.key];
    html += `<div class="sw-item">
      <div class="sw-top">
        <span class="sw-type">${esc(title)}</span>
        <span class="sw-cat ${cat.cls}">${esc(cat.label)}</span>
      </div>
      <div class="sw-body">${esc(body)}</div>
      <div class="sw-time">
        ${issued ? `<span>Issued: ${fmtTime(new Date(swpcUTC(issued)).toISOString())}</span>` : ''}
        ${link ? `<span><a class="link-btn" href="${esc(link)}" target="_blank" rel="noopener">Bulletin ↗</a></span>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';
  document.getElementById('sw-body').innerHTML = html;
  buildGlobalSummary();

  buildAlertBar();
}

/* ══════════════════════════════════════════════════════
   NASA EONET — Active Natural Events
══════════════════════════════════════════════════════ */

let eonetData = [];

const EONET_CATS = {
  wildfires:    { icon:'🔥', color:'#e69875', label:'Wildfire'      },
  volcanoes:    { icon:'🌋', color:'#d699b6', label:'Volcano'       },
  severeStorms: { icon:'🌀', color:'#7fbbb3', label:'Severe Storm'  },
  seaLakeIce:   { icon:'🧊', color:'#83c092', label:'Sea/Lake Ice'  },
  snow:         { icon:'❄️', color:'#d3c6aa', label:'Snow'          },
  dustHaze:     { icon:'💨', color:'#859289', label:'Dust/Haze'     },
  floods:       { icon:'🌊', color:'#7fbbb3', label:'Flood'         },
  drought:      { icon:'🏜️', color:'#dbbc7f', label:'Drought'       },
  manmade:      { icon:'⚠️', color:'#e67e80', label:'Manmade'       },
};

/* EONET events normally carry a title. If one is ever missing, say so plainly
   rather than falling back to the category name: that fallback made the ticker
   print the category twice (once as the tag, once as the location) and read as
   though the category were the event's actual name. The EONET id is appended
   so an untitled event is still traceable back to the source. */
function eonetTitle(event) {
  const title = (event?.title || '').trim();
  if (title) return title;
  return `Untitled event${event?.id ? ` · ${event.id}` : ''}`;
}

function eonetCatInfo(event) {
  const catId = event.categories?.[0]?.id || 'manmade';
  return EONET_CATS[catId] || { icon:'🌐', color:'#859289', label: event.categories?.[0]?.title || 'Event' };
}

async function loadEonet() {
  showLoading('eonet-body');
  try {
    const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    eonetData = payload.events || [];
    markUpdated('eonet-updated');
    renderEonet();
  } catch (err) {
    showState('eonet-body','⚠️',`Failed: ${err.message}`);
  }
}

function renderEonet() {
  const catFilter = document.getElementById('eonet-cat').value;
  const eonetCutoff48 = Date.now() - 48 * 3_600_000;
  const filtered  = eonetData.filter(event => {
    if (catFilter !== 'all' && !event.categories?.some(cat => cat.id === catFilter)) return false;
    const geo = event.geometry?.[event.geometry.length - 1];
    const updatedAt = geo?.date ? new Date(geo.date).getTime() : 0;
    return updatedAt >= eonetCutoff48;
  });

  document.getElementById('eonet-count').textContent = filtered.length;

  if (!filtered.length) {
    document.getElementById('eonet-body').innerHTML =
      `<div class="all-clear">✅ No active natural events.</div>`;
    plotEonet();
    return;
  }

  let html = '';
  for (const event of filtered) {
    const cat   = eonetCatInfo(event);
    const geo   = event.geometry?.[event.geometry.length - 1];
    const mag   = geo?.magnitudeValue != null
      ? `${geo.magnitudeValue.toLocaleString()} ${geo.magnitudeUnit || ''}`
      : null;
    const date  = geo?.date ? fmtTime(geo.date) : '—';
    const src   = event.sources?.[0]?.url || event.link || '';

    html += `<div class="hazard-item" onclick="flyToEonet('${event.id}')" title="Click to locate on map">
      <div class="hazard-top">
        <span style="font-size:13px">${cat.icon}</span>
        <span class="hazard-title">${esc(eonetTitle(event))}</span>
        <span class="hazard-cat" style="background:${cat.color}22;color:${cat.color}">${esc(cat.label)}</span>
      </div>
      <div class="hazard-meta">
        <span><b>Updated:</b> ${date}</span>
        ${mag ? `<span><b>Size:</b> ${esc(mag)}</span>` : ''}
        ${src ? `<span><a class="link-btn" href="${esc(src)}" target="_blank" rel="noopener">Source ↗</a></span>` : ''}
      </div>
    </div>`;
  }
  document.getElementById('eonet-body').innerHTML = html;
  plotEonet();
  buildGlobalSummary();

  buildAlertBar();
}

function plotEonet() {
  if (!map) return;
  eonetLayer.clearLayers();
  const catFilter = document.getElementById('eonet-cat').value;

  const eonetMapCutoff = Date.now() - 48 * 3_600_000;

  for (const event of eonetData) {
    if (catFilter !== 'all' && !event.categories?.some(cat => cat.id === catFilter)) continue;
    const geo = event.geometry?.[event.geometry.length - 1];
    if (!geo?.coordinates) continue;
    const updatedAt = geo.date ? new Date(geo.date).getTime() : 0;
    if (!updatedAt || updatedAt < eonetMapCutoff) continue;

    const [lon, lat] = geo.coordinates;
    const cat   = eonetCatInfo(event);
    const isWildfire = event.categories?.some(cat => cat.id === 'wildfires');

    let marker;
    if (isWildfire) {
      marker = L.marker([lat, lon], {
        icon: L.divIcon({
          html: '<span style="font-size:18px;line-height:1">🔥</span>',
          className: 'leaflet-marker-emoji',
          iconSize:   [22, 22],
          iconAnchor: [11, 11],
          popupAnchor:[0, -12]
        })
      });
    } else {
      marker = L.circleMarker([lat, lon], {
        radius:      7,
        fillColor:   cat.color,
        color:       cat.color,
        weight:      1.5,
        opacity:     1,
        fillOpacity: 0.35,
        dashArray:   '4 3'
      });
    }

    marker._eonetId = event.id;
    marker.bindPopup(`
      <div class="popup-inner">
        <div class="popup-title">${cat.icon} ${esc(eonetTitle(event))}</div>
        <div class="popup-sub" style="color:${cat.color}">${esc(cat.label)}</div>
        ${geo.magnitudeValue != null
          ? `<div class="popup-row"><span>Size</span><span>${geo.magnitudeValue.toLocaleString()} ${geo.magnitudeUnit||''}</span></div>`
          : ''}
        <div class="popup-row"><span>Updated</span><span>${fmtTime(geo.date)}</span></div>
        ${event.sources?.[0]?.url
          ? `<a class="popup-link" href="${esc(event.sources[0].url)}" target="_blank" rel="noopener">Source ↗</a>`
          : ''}
      </div>
    `);
    eonetLayer.addLayer(marker);
  }
  updateMapCount();
}

// Pan map to EONET event when sidebar row is clicked
function flyToEonet(id) {
  ensureLayerOn('eonet');
  const event = eonetData.find(entry => entry.id === id);
  if (!event) return;
  const geo = event.geometry?.[event.geometry.length - 1];
  if (!geo?.coordinates) return;
  const [lon, lat] = geo.coordinates;
  map.flyTo([lat, lon], Math.max(map.getZoom(), 5), { duration: 1 });
  eonetLayer.eachLayer(marker => {
    if (marker._eonetId === id) marker.openPopup();
  });
}

/* ══════════════════════════════════════════════════════
   FEMA — Disaster Declarations
══════════════════════════════════════════════════════ */

let femaData = [];

const FEMA_ICONS = {
  'Fire':'🔥', 'Flood':'🌊', 'Hurricane':'🌀', 'Tornado':'🌪️',
  'Earthquake':'📡', 'Tsunami':'🌊', 'Winter Storm':'❄️',
  'Snow':'❄️', 'Drought':'🏜️', 'Severe Storm':'⛈️',
  'Severe Ice Storm':'🧊', 'Typhoon':'🌀', 'Chemical':'☣️',
  'Biological':'🦠', 'Dam/Levee Break':'🌊', 'Mud/Landslide':'⛰️',
  'Volcano':'🌋',
};

const FEMA_TYPE_LABELS = { DR:'Major Disaster', EM:'Emergency', FM:'Fire Mgmt', FS:'Fire Suppression' };

async function loadFema() {
  showLoading('fema-body');
  try {
    const sixMonthsAgo = new Date(Date.now() - 180*24*3600*1000).toISOString();
    const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`
              + `?$orderby=declarationDate%20desc&$top=50`
              + `&$filter=declarationDate%20gt%20'${sixMonthsAgo}'`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    // FEMA returns data under its own key, not OData's 'value'
    femaData = payload.DisasterDeclarationsSummaries || payload.value || [];
    markUpdated('fema-updated');
    renderFema();
  } catch (err) {
    showState('fema-body','⚠️',`Failed: ${err.message}`);
  }
}

function renderFema() {
  const typeFilter = document.getElementById('fema-type').value;
  const filtered   = femaData.filter(decl =>
    typeFilter === 'all' || decl.incidentType === typeFilter
  );

  document.getElementById('fema-count').textContent = filtered.length;

  if (!filtered.length) {
    document.getElementById('fema-body').innerHTML =
      `<div class="all-clear">✅ No declarations match filter.</div>`;
    return;
  }

  let html = '';
  for (const decl of filtered) {
    const icon      = FEMA_ICONS[decl.incidentType] || '⚠️';
    const typeLabel = FEMA_TYPE_LABELS[decl.declarationType] || decl.declarationType;
    const declId    = decl.femaDeclarationString || `DR-${decl.disasterNumber}`;
    const link      = decl.disasterNumber
      ? `https://www.fema.gov/disaster/${decl.disasterNumber}`
      : '';

    html += `<div class="hazard-item">
      <div class="hazard-top">
        <span style="font-size:13px">${icon}</span>
        <span class="hazard-title">${esc(decl.declarationTitle || decl.incidentType)}</span>
        <span class="hazard-cat" style="background:#2a3528;color:#a7c080">${esc(typeLabel)}</span>
      </div>
      <div class="hazard-meta">
        <span><b>${esc(declId)}</b></span>
        <span><b>State:</b> ${esc(decl.state || decl.stateCode || '—')}</span>
        <span><b>Type:</b> ${esc(decl.incidentType || '—')}</span>
        <span><b>Declared:</b> ${decl.declarationDate ? fmtTime(decl.declarationDate) : '—'}</span>
        ${link ? `<span><a class="link-btn" href="${esc(link)}" target="_blank" rel="noopener">FEMA ↗</a></span>` : ''}
      </div>
    </div>`;
  }
  document.getElementById('fema-body').innerHTML = html;
  buildGlobalSummary();

  buildAlertBar();
}

/* ══════════════════════════════════════════════════════
   NWS LOCAL STORM REPORTS — SPC daily storm data
══════════════════════════════════════════════════════ */

let lsrData = [];
const LSR_COLORS = { torn: '#e67e80', hail: '#dbbc7f', wind: '#83c092' };
const LSR_ICONS  = { torn: '🌪️', hail: '🌨️', wind: '💨' };
const LSR_LABELS = { torn: 'Tornado', hail: 'Hail', wind: 'Wind Damage' };

function parseSpcCsv(text, type) {
  // SPC CSV header: Time,F-Scale|Size|Speed,Location,County,State,Lat,Lon,Comments
  return text.trim().split('\n').slice(1).map(line => {
    const cols = line.split(',');
    if (cols.length < 7) return null;
    const lat = parseFloat(cols[5]), lon = parseFloat(cols[6]);
    if (isNaN(lat) || isNaN(lon)) return null;
    return {
      type,
      time:      cols[0].trim(),
      magnitude: cols[1].trim(),
      location:  cols[2].trim(),
      county:    cols[3].trim(),
      state:     cols[4].trim(),
      lat, lon,
      comments:  cols.slice(7).join(',').trim()
    };
  }).filter(Boolean);
}

async function loadLSR() {
  try {
    const base = 'https://www.spc.noaa.gov/climo/reports/today_filtered_';
    const [tornRes, hailRes, windRes] = await Promise.all([
      fetch(base + 'torn.csv'),
      fetch(base + 'hail.csv'),
      fetch(base + 'wind.csv'),
    ]);
    const reports = [];
    if (tornRes.ok) reports.push(...parseSpcCsv(await tornRes.text(), 'torn'));
    if (hailRes.ok) reports.push(...parseSpcCsv(await hailRes.text(), 'hail'));
    if (windRes.ok) reports.push(...parseSpcCsv(await windRes.text(), 'wind'));
    lsrData = reports;
    plotLSR();
  } catch (err) {
    console.warn('LSR load failed:', err.message);
  }
}

// Format an SPC storm report's magnitude for display.
// Units are SPC's own, not metric: hail Size is in hundredths of an inch.
// (100 = 1.00", the size of a quarter) and wind Speed is already in mph
// (verified against reports whose comments quote the measured gust).
// Tornado reports carry an EF/F scale string. Any of the three may be 'UNK'.
function lsrMagnitudeLabel(report) {
  const raw = (report.magnitude || '').trim();
  if (!raw || raw.toUpperCase() === 'UNK') return '';
  const value = parseFloat(raw);
  if (report.type === 'hail') {
    return Number.isFinite(value) ? ` · ${(value / 100).toFixed(2)}"` : '';
  }
  if (report.type === 'wind') {
    return Number.isFinite(value) ? ` · ${value} mph` : '';
  }
  return ` · ${raw}`;   // tornado EF/F scale
}

function plotLSR() {
  if (!map) return;
  lsrLayer.clearLayers();
  for (const report of lsrData) {
    const color = LSR_COLORS[report.type] || '#859289';
    const icon  = LSR_ICONS[report.type]  || '⚡';
    const label = LSR_LABELS[report.type] || 'Storm Report';
    const magStr = lsrMagnitudeLabel(report);
    L.circleMarker([report.lat, report.lon], {
      radius: 5, color, fillColor: color, fillOpacity: 0.8, weight: 1.5
    })
    .bindPopup(`<div class="popup-inner">
      <div class="popup-title">${icon} ${esc(label)}${esc(magStr)}</div>
      <div class="popup-sub">${esc(report.location)}, ${esc(report.county)} Co., ${esc(report.state)}</div>
      <div class="popup-row">UTC ${esc(report.time)} · NWS LSR</div>
      ${report.comments ? `<div class="popup-row">${esc(report.comments)}</div>` : ''}
    </div>`)
    .addTo(lsrLayer);
  }
}

/* ══════════════════════════════════════════════════════
   SPC CONVECTIVE OUTLOOK — spc.noaa.gov GeoJSON
══════════════════════════════════════════════════════ */

const SPC_RISK = {
  TSTM: { label: 'General Thunderstorms', color: '#a7c080', order: 1 },
  MRGL: { label: 'Marginal Risk',          color: '#83c092', order: 2 },
  SLGT: { label: 'Slight Risk',            color: '#dbbc7f', order: 3 },
  ENH:  { label: 'Enhanced Risk',          color: '#e69875', order: 4 },
  MDT:  { label: 'Moderate Risk',          color: '#e67e80', order: 5 },
  HIGH: { label: 'High Risk',              color: '#d699b6', order: 6 },
};

function _buildSpcLayer(geojson, layer) {
  layer.clearLayers();
  if (!geojson?.features?.length) return;
  // Sort lowest→highest risk so higher risk renders on top
  const features = [...geojson.features].sort((featA, featB) => {
    const orderA = SPC_RISK[featA.properties.LABEL]?.order ?? 0;
    const orderB = SPC_RISK[featB.properties.LABEL]?.order ?? 0;
    return orderA - orderB;
  });
  L.geoJSON({ type: 'FeatureCollection', features }, {
    style(feature) {
      const risk = SPC_RISK[feature.properties.LABEL];
      const col  = risk?.color ?? '#859289';
      return { color: col, weight: 1.5, opacity: 0.9, fillColor: col, fillOpacity: 0.18 };
    },
    onEachFeature(feature, lyr) {
      const p    = feature.properties;
      const risk = SPC_RISK[p.LABEL];
      lyr.bindPopup(`<div class="popup-inner">
        <div class="popup-title">⛈️ SPC ${esc(p.LABEL2 || p.LABEL)}</div>
        <div class="popup-row"><span>Valid</span><span>${fmtTime(p.VALID_ISO)}</span></div>
        <div class="popup-row"><span>Expires</span><span>${fmtTime(p.EXPIRE_ISO)}</span></div>
        <div class="popup-row"><span>Issued</span><span>${fmtTime(p.ISSUE_ISO)}</span></div>
        <div class="popup-row"><span>Forecaster</span><span>${esc(p.FORECASTER || '—')}</span></div>
      </div>`);
    }
  }).addTo(layer);
}

async function loadSPC() {
  const base = 'https://www.spc.noaa.gov/products/outlook/';
  try {
    const [d1, d2, d3] = await Promise.all([
      fetch(base + 'day1otlk_cat.nolyr.geojson', { signal: AbortSignal.timeout(10000) }).then(response => response.ok ? response.json() : null),
      fetch(base + 'day2otlk_cat.nolyr.geojson', { signal: AbortSignal.timeout(10000) }).then(response => response.ok ? response.json() : null),
      fetch(base + 'day3otlk_cat.nolyr.geojson', { signal: AbortSignal.timeout(10000) }).then(response => response.ok ? response.json() : null),
    ]);
    if (spcD1Layer) _buildSpcLayer(d1, spcD1Layer);
    if (spcD2Layer) _buildSpcLayer(d2, spcD2Layer);
    if (spcD3Layer) _buildSpcLayer(d3, spcD3Layer);
  } catch (err) {
    console.warn('SPC outlook load failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════
   SPC FIRE WEATHER OUTLOOK — NOAA MapServer
══════════════════════════════════════════════════════ */

const FWX_RISK = {
  5:  { label: 'Elevated',           color: '#dbbc7f' },
  8:  { label: 'Critical',           color: '#e69875' },
  10: { label: 'Extremely Critical', color: '#e67e80' },
};

// Parse SPC's compact timestamp format: "202604051700" → ISO string
function parseSpcTs(compact) {
  if (!compact || String(compact).length < 12) return null;
  const ts = String(compact);
  return new Date(Date.UTC(+ts.slice(0,4), +ts.slice(4,6)-1, +ts.slice(6,8), +ts.slice(8,10), +ts.slice(10,12))).toISOString();
}

async function _fetchFwxLayer(layerId) {
  const base = 'https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer';
  const params = new URLSearchParams({ where: '1=1', outFields: 'dn,valid,expire', returnGeometry: 'true', f: 'geojson' });
  const response = await fetch(`${base}/${layerId}/query?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  return response.json();
}

function _buildFwxLayer(mainGJ, dryGJ, layer) {
  layer.clearLayers();

  // Main categorical risk (Elevated / Critical / Extremely Critical)
  if (mainGJ?.features?.length) {
    const features = [...mainGJ.features]
      .filter(feature => feature.properties.dn && FWX_RISK[feature.properties.dn])
      .sort((featA, featB) => (featA.properties.dn ?? 0) - (featB.properties.dn ?? 0));
    L.geoJSON({ type: 'FeatureCollection', features }, {
      style(feature) {
        const risk = FWX_RISK[feature.properties.dn];
        const col  = risk?.color ?? '#859289';
        return { color: col, weight: 1.5, opacity: 0.9, fillColor: col, fillOpacity: 0.22 };
      },
      onEachFeature(feature, polygonLayer) {
        const props = feature.properties;
        const risk  = FWX_RISK[props.dn];
        polygonLayer.bindPopup(`<div class="popup-inner">
          <div class="popup-title">🔥 Fire Wx — ${esc(risk?.label ?? 'Unknown')}</div>
          <div class="popup-row"><span>Valid</span><span>${fmtTime(parseSpcTs(props.valid))}</span></div>
          <div class="popup-row"><span>Expires</span><span>${fmtTime(parseSpcTs(props.expire))}</span></div>
        </div>`);
      }
    }).addTo(layer);
  }

  // Dry thunderstorm areas — dashed outline only, no fill
  if (dryGJ?.features?.length) {
    const dryFeatures = dryGJ.features.filter(feature => feature.geometry?.coordinates?.length);
    if (dryFeatures.length) {
      L.geoJSON({ type: 'FeatureCollection', features: dryFeatures }, {
        style() {
          return { color: '#d699b6', weight: 2, opacity: 0.85, dashArray: '6 4', fill: false };
        },
        onEachFeature(feature, polygonLayer) {
          const props = feature.properties;
          polygonLayer.bindPopup(`<div class="popup-inner">
            <div class="popup-title">⚡ Dry Thunderstorm Area</div>
            <div class="popup-row"><span>Valid</span><span>${fmtTime(parseSpcTs(props.valid))}</span></div>
            <div class="popup-row"><span>Expires</span><span>${fmtTime(parseSpcTs(props.expire))}</span></div>
          </div>`);
        }
      }).addTo(layer);
    }
  }
}

async function loadFireWx() {
  try {
    const [d1main, d1dry, d2main, d2dry] = await Promise.all([
      _fetchFwxLayer(1),
      _fetchFwxLayer(2),
      _fetchFwxLayer(4),
      _fetchFwxLayer(5),
    ]);
    if (fwxD1Layer) _buildFwxLayer(d1main, d1dry, fwxD1Layer);
    if (fwxD2Layer) _buildFwxLayer(d2main, d2dry, fwxD2Layer);
  } catch (err) {
    console.warn('Fire weather outlook load failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════
   RIVER GAUGES — NOAA NWPS via ArcGIS MapServer
══════════════════════════════════════════════════════ */

let gaugeData = [];

const GAUGE_STATUS = {
  action:   { color: '#dbbc7f', label: 'Action Stage'    },
  flood:    { color: '#e69875', label: 'Minor Flooding'  },
  moderate: { color: '#e67e80', label: 'Moderate Flood'  },
  major:    { color: '#d699b6', label: 'Major Flood'     },
};

async function loadGauges() {
  try {
    const params = new URLSearchParams({
      where: "status IN ('action','flood','moderate','major')",
      outFields: 'gaugelid,status,location,waterbody,state,observed,units,flood,moderate,major,action,obstime,latitude,longitude,url',
      returnGeometry: 'false',
      resultRecordCount: 2000,
      f: 'json'
    });
    const response = await fetch(
      `https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?${params}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    gaugeData = (payload.features || []).map(feature => feature.attributes);
    plotGauges();
  } catch (err) {
    console.warn('River gauge load failed:', err.message);
  }
}

function plotGauges() {
  if (!map) return;
  gaugeLayer.clearLayers();
  for (const gauge of gaugeData) {
    const lat = parseFloat(gauge.latitude), lon = parseFloat(gauge.longitude);
    if (isNaN(lat) || isNaN(lon)) continue;
    const status = GAUGE_STATUS[gauge.status];
    if (!status) continue;
    const observedValue = parseFloat(gauge.observed);
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({
        html: `<div style="width:10px;height:10px;background:${status.color};border:1.5px solid #1a2227;box-sizing:border-box"></div>`,
        className: 'leaflet-marker-emoji',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
        popupAnchor: [0, -8]
      })
    });
    const location = esc(gauge.location || gauge.gaugelid);
    const waterbody = gauge.waterbody ? `<div style="color:var(--muted);font-size:11px;margin-top:2px">${esc(gauge.waterbody)}, ${esc(gauge.state)}</div>` : `<div style="color:var(--muted);font-size:11px;margin-top:2px">${esc(gauge.state)}</div>`;
    const thresholds = [
      gauge.action   ? `<tr><td>Action</td><td>${gauge.action} ${gauge.units}</td></tr>` : '',
      gauge.flood    ? `<tr><td>Minor</td><td>${gauge.flood} ${gauge.units}</td></tr>` : '',
      gauge.moderate ? `<tr><td>Moderate</td><td>${gauge.moderate} ${gauge.units}</td></tr>` : '',
      gauge.major    ? `<tr><td>Major</td><td>${gauge.major} ${gauge.units}</td></tr>` : '',
    ].filter(Boolean).join('');
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">💧 ${location}</div>
      ${waterbody}
      <div class="popup-row" style="margin-top:6px">
        <span style="background:${status.color};color:var(--badge-text, #1a2227);padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">${status.label}</span>
        <span style="margin-left:6px"><b>${isNaN(observedValue) ? esc(gauge.observed) : observedValue.toFixed(2)}</b> ${esc(gauge.units || 'ft')}</span>
      </div>
      ${thresholds ? `<table style="margin-top:6px;font-size:11px;color:var(--muted);width:100%;border-collapse:collapse"><tbody>${thresholds}</tbody></table>` : ''}
      <div class="popup-row" style="margin-top:4px">${gauge.obstime ? fmtTime(gauge.obstime.trim().replace(' ', 'T') + 'Z') : ''}</div>
      ${gauge.url ? `<div class="popup-row"><a href="${esc(gauge.url)}" target="_blank" style="color:var(--accent)">View on water.noaa.gov ↗</a></div>` : ''}
    </div>`);
    marker.addTo(gaugeLayer);
  }
}

/* ══════════════════════════════════════════════════════
   US DROUGHT MONITOR — droughtmonitor.unl.edu
══════════════════════════════════════════════════════ */

let droughtData = null;

const DM_LEVELS = [
  { dm:0, label:'D0 — Abnormally Dry',    color:'#dbbc7f', bg:'#3b3a27' },
  { dm:1, label:'D1 — Moderate Drought',  color:'#e69875', bg:'#3d3226' },
  { dm:2, label:'D2 — Severe Drought',    color:'#e67e80', bg:'#3d2b28' },
  { dm:3, label:'D3 — Extreme Drought',   color:'#d699b6', bg:'#2e2538' },
  { dm:4, label:'D4 — Exceptional Drought',color:'#a7c080',bg:'#293d2b' },
];

async function loadDrought() {
  try {
    const response = await fetch('https://droughtmonitor.unl.edu/data/json/usdm_current.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    droughtData = await response.json();
    plotDrought();
  } catch (err) { console.warn('Drought Monitor load failed:', err.message); }
}

function plotDrought() {
  if (!map || !droughtData) return;
  droughtLayer.clearLayers();

  // Always populate the layer — toggleLayer() controls map visibility
  const dmColors = { 0:'#dbbc7f', 1:'#e69875', 2:'#e67e80', 3:'#d699b6', 4:'#a7c080' };

  L.geoJSON(droughtData, {
    style: feature => ({
      color:       dmColors[feature.properties?.DM] || '#859289',
      weight:      0.5,
      opacity:     0.6,
      fillColor:   dmColors[feature.properties?.DM] || '#859289',
      fillOpacity: 0.18
    }),
    onEachFeature: (feature, layer) => {
      const level = DM_LEVELS.find(entry => entry.dm === feature.properties?.DM);
      if (level) layer.bindPopup(`<div class="popup-inner">
        <div class="popup-title">🏜️ ${esc(level.label)}</div>
        <div class="popup-sub">US Drought Monitor</div>
        <a class="popup-link" href="https://droughtmonitor.unl.edu/" target="_blank" rel="noopener">Full map ↗</a>
      </div>`);
    }
  }).addTo(droughtLayer);
}

/* ══════════════════════════════════════════════════════
   SURFACE WIND — station barbs via Open-Meteo (no key, CORS)
   Samples a grid across the current viewport, so density stays
   usable at every zoom instead of being fixed to a city list.
══════════════════════════════════════════════════════ */

let windData = [];
let _windAbort = null;      // cancels an in-flight fetch when the view moves again
let _windDebounce = null;

// Speed → colour ramp (knots), matching the dashboard's severity palette
function windColor(knots) {
  if (knots >= 48) return '#d699b6';  // storm force
  if (knots >= 34) return '#e67e80';  // gale
  if (knots >= 22) return '#e69875';  // strong
  if (knots >= 11) return '#dbbc7f';  // moderate
  return '#a7c080';                   // light
}

/**
 * Standard meteorological wind barb as an SVG divIcon.
 * Half barb = 5 kt, full barb = 10 kt, pennant = 50 kt; calm = open circle.
 * The staff points INTO the wind (the direction it blows FROM).
 *
 * Every shape is drawn twice — a wide dark stroke underneath and a narrow
 * coloured stroke on top. That halo is what keeps the glyph legible over both
 * the dark basemap and the bright ArcGIS satellite imagery, where a single
 * flat colour would disappear against clouds, snow, or desert.
 */
function windBarbIcon(knots, dirDeg) {
  const cx = 22, cy = 22, tipY = 5;
  const color = windColor(knots);
  let shapes = '';

  if (knots < 2) {
    // Calm — open circle, no staff
    shapes = `<circle cx="${cx}" cy="${cy}" r="4.5" fill="none"/>`;
  } else {
    shapes += `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${tipY}"/>`;
    let remaining = Math.round(knots / 5) * 5;
    let y = tipY;
    while (remaining >= 50) {                       // pennants
      shapes += `<polygon points="${cx},${y} ${cx - 10},${y + 2.4} ${cx},${y + 4.8}"/>`;
      remaining -= 50; y += 6.0;
    }
    while (remaining >= 10) {                       // full barbs
      shapes += `<line x1="${cx}" y1="${y}" x2="${cx - 10}" y2="${y - 3.0}"/>`;
      remaining -= 10; y += 4.3;
    }
    if (remaining >= 5) {                           // half barb
      // Nudge inward if it would sit on the very tip of a bare staff
      if (y === tipY) y += 4.3;
      shapes += `<line x1="${cx}" y1="${y}" x2="${cx - 5.2}" y2="${y - 1.6}"/>`;
    }
    shapes += `<circle cx="${cx}" cy="${cy}" r="1.9" fill="none"/>`;
  }

  const g = (stroke, width, fill) =>
    `<g stroke="${stroke}" stroke-width="${width}" fill="${fill}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`;

  const html =
    `<svg width="44" height="44" viewBox="0 0 44 44" style="overflow:visible">` +
      `<g transform="rotate(${dirDeg} ${cx} ${cy})">` +
        g('rgba(0,0,0,0.85)', 4.0, 'rgba(0,0,0,0.85)') +   // halo
        g(color, 1.6, color) +                             // glyph
      `</g>` +
    `</svg>`;

  return L.divIcon({
    html,
    className:  'leaflet-marker-emoji',
    iconSize:   [44, 44],
    iconAnchor: [22, 22],
    popupAnchor:[0, -16],
  });
}

// Build a lat/lon sample grid across the visible map, clamped to valid ranges
function windGridForView() {
  const bounds = map.getBounds();
  const south = Math.max(bounds.getSouth(), -82);
  const north = Math.min(bounds.getNorth(),  82);
  const west  = bounds.getWest();
  const east  = bounds.getEast();
  if (north <= south || east <= west) return [];

  const COLS = 7, ROWS = 5;                 // 35 points → one batched request
  const points = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lat = south + ((row + 0.5) / ROWS) * (north - south);
      let   lon = west  + ((col + 0.5) / COLS) * (east  - west);
      lon = ((lon + 180) % 360 + 360) % 360 - 180;   // normalise across the antimeridian
      points.push([+lat.toFixed(3), +lon.toFixed(3)]);
    }
  }
  return points;
}

async function loadWind() {
  if (!map || !windLayer) return;
  // Only fetch when the layer is actually switched on
  if (!document.getElementById('toggle-wind')?.checked) return;

  const points = windGridForView();
  if (!points.length) return;

  _windAbort?.abort();
  _windAbort = new AbortController();

  const params = new URLSearchParams({
    latitude:  points.map(p => p[0]).join(','),
    longitude: points.map(p => p[1]).join(','),
    current:   'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kn',
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,
      { signal: _windAbort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    // Open-Meteo returns a bare object for one point, an array for many
    windData = (Array.isArray(payload) ? payload : [payload])
      .filter(entry => entry?.current?.wind_speed_10m != null);
    plotWind();
    noteDataLoaded();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('Wind load failed:', err.message);
  }
}

function plotWind() {
  if (!windLayer) return;
  windLayer.clearLayers();
  for (const entry of windData) {
    const current = entry.current;
    const knots   = current.wind_speed_10m;
    const dir     = current.wind_direction_10m ?? 0;
    const gust    = current.wind_gusts_10m;
    const marker  = L.marker([entry.latitude, entry.longitude], {
      icon: windBarbIcon(knots, dir),
      interactive: true,
      zIndexOffset: 300,
    });
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">💨 Surface Wind</div>
      <div class="popup-sub">${entry.latitude.toFixed(2)}°, ${entry.longitude.toFixed(2)}°</div>
      <div class="popup-row"><span>Speed</span><span style="color:${windColor(knots)};font-weight:600">${knots.toFixed(0)} kt</span></div>
      <div class="popup-row"><span>Direction</span><span>${Math.round(dir)}° (${compassPoint(dir)})</span></div>
      ${gust != null ? `<div class="popup-row"><span>Gusts</span><span>${gust.toFixed(0)} kt</span></div>` : ''}
      <div class="popup-row" style="font-size:10px;color:var(--muted)">Barb points into the wind · 10 m above ground</div>
    </div>`);
    windLayer.addLayer(marker);
  }
}

// Degrees → 16-point compass abbreviation
function compassPoint(deg) {
  const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return points[Math.round(((deg % 360) / 22.5)) % 16];
}

/* ══════════════════════════════════════════════════════
   VOLCANISM — USGS VHP + GeoNet NZ
══════════════════════════════════════════════════════ */

let geonetVALData = [], vhpData = [], vonaData = [];
const GEONET_VAL_COLOR = { 0:'#859289', 1:'#a7c080', 2:'#dbbc7f', 3:'#e69875', 4:'#e67e80', 5:'#d699b6' };
const VHP_ALERT_COLOR = { NORMAL:'#859289', ADVISORY:'#dbbc7f', WATCH:'#e69875', WARNING:'#e67e80' };

async function loadVolcanism() {
  showLoading('vhp-body');
  showLoading('geonet-body');
  geonetVALData = []; vhpData = []; vonaData = [];
  await Promise.all([loadGeoNetVAL(), loadVHP()]);
  renderVHP();
  renderGeoNet();
  plotVolcanism();
  markUpdated('vhp-updated');
  markUpdated('geonet-updated');
}

async function loadGeoNetVAL() {
  try {
    const response = await fetch('https://api.geonet.org.nz/volcano/val', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    geonetVALData = payload.features || [];
  } catch (err) { console.warn('GeoNet VAL load failed:', err.message); }
}

async function loadVHP() {
  try {
    const [elevated, vonas] = await Promise.all([
      fetch('https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes', { signal: AbortSignal.timeout(10000) }).then(response => response.json()),
      fetch('https://volcanoes.usgs.gov/hans-public/api/notice/getVonasWithinLastYear',  { signal: AbortSignal.timeout(10000) }).then(response => response.json()),
    ]);
    const elevArr = Array.isArray(elevated) ? elevated : [];
    vonaData = Array.isArray(vonas) ? vonas : [];

    // Enrich each elevated volcano with lat/lon via getVolcano/{vnum}
    vhpData = await Promise.all(
      elevArr.map(async volcano => {
        try {
          const detail = await fetch(
            `https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/${volcano.vnum}`,
            { signal: AbortSignal.timeout(8000) }
          ).then(response => response.json());
          return { ...volcano, latitude: detail.latitude ?? null, longitude: detail.longitude ?? null, elevation_m: detail.elevation_meters ?? null };
        } catch { return volcano; }
      })
    );

    // Build vnum→coords lookup so VONAs can also have coordinates
    const vnumCoords = {};
    for (const volcano of vhpData) {
      if (volcano.vnum && volcano.latitude != null) vnumCoords[volcano.vnum] = { lat: volcano.latitude, lon: volcano.longitude };
    }
    // Tag VONAs with coordinates where the volcano is in the elevated list
    vonaData = vonaData.map(vona => ({ ...vona, ...(vnumCoords[vona.vnum] || {}) }));
  } catch (err) { console.warn('USGS VHP load failed:', err.message); }
}

function volcMarkerIcon(color) {
  return L.divIcon({
    html: `<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid ${color};filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))"></div>`,
    className: 'leaflet-marker-emoji',
    iconSize:    [14, 13],
    iconAnchor:  [7,  13],
    popupAnchor: [0, -14]
  });
}

function renderVHP() {
  const body = document.getElementById('vhp-body');
  if (!body) return;
  const items = [];

  // Coord lookup for VONAs
  const vhpCoords = {};
  for (const volcano of vhpData) {
    if (volcano.vnum && volcano.latitude != null) vhpCoords[volcano.vnum] = { lat: volcano.latitude, lon: volcano.longitude, id: `vhp-${volcano.vnum}` };
  }

  // USGS VHP — currently elevated volcanoes
  vhpData.forEach(volcano => {
    const col = VHP_ALERT_COLOR[volcano.alert_level] || '#859289';
    const coords = volcano.latitude != null ? { lat: volcano.latitude, lon: volcano.longitude, id: `vhp-${volcano.vnum}` } : null;
    items.push({
      source: 'VHP', color: col,
      title:  `${volcano.volcano_name} — ${volcano.alert_level}`,
      sub:    `${volcano.obs_fullname} · Aviation: ${volcano.color_code || '—'}`,
      time:   volcano.sent_utc ? volcano.sent_utc.replace(' ', 'T') + 'Z' : null,
      desc:   '',
      url:    volcano.notice_url || null,
      coords,
    });
  });

  // VONAs — last 7 days; coordinates shared via vnum lookup
  const cutoff = Date.now() - 7 * 86400_000;
  vonaData
    .filter(vona => (vona.sent_unixtime * 1000) >= cutoff)
    .forEach(vona => {
      const col = VHP_ALERT_COLOR[vona.alert_level] || '#859289';
      const coords = vhpCoords[vona.vnum] || null;
      items.push({
        source: 'VONA', color: col,
        title:  `${vona.volcano_name} — VONA ${vona.color_code}`,
        sub:    `${vona.region} · ${vona.nvews_threat || ''}`,
        time:   vona.sent_utc ? vona.sent_utc.replace(' ', 'T') + 'Z' : null,
        desc:   (vona.synopsis_complete || '').slice(0, 160),
        url:    vona.vona_url || null,
        coords,
      });
    });

  document.getElementById('vhp-count').textContent = items.length;

  if (!items.length) {
    body.innerHTML = '<div class="state muted">No elevated volcanic activity</div>';
    return;
  }

  // Timed items first (most recent), then untimed
  items.sort((itemA, itemB) => {
    if (itemA.time && itemB.time) return new Date(itemB.time) - new Date(itemA.time);
    if (itemA.time) return -1;
    if (itemB.time) return 1;
    return itemA.source.localeCompare(itemB.source);
  });

  body.innerHTML = items.map(item => {
    const flyAttr = item.coords
      ? `onclick="flyToVolc('${item.coords.id}',${item.coords.lat},${item.coords.lon})" style="border-left-color:${item.color};cursor:pointer"`
      : `style="border-left-color:${item.color}"`;
    return `
    <div class="alert-item" ${flyAttr} title="${item.coords ? 'Click to locate on map' : ''}">
      <div class="alert-row">
        <span class="alert-badge" style="background:${item.color};color:var(--badge-text, #1a2227)">${esc(item.source)}</span>
        <span class="alert-event">${esc(item.title)}</span>
      </div>
      ${item.sub  ? `<div class="alert-sub">${esc(item.sub)}</div>` : ''}
      ${item.desc ? `<div class="alert-sub" style="opacity:.8">${esc(item.desc)}${item.desc.length >= 160 ? '…' : ''}</div>` : ''}
      <div class="alert-meta">
        <span>${fmtTime(item.time)}</span>
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" style="color:var(--accent);margin-left:auto" onclick="event.stopPropagation()">↗</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderGeoNet() {
  const body = document.getElementById('geonet-body');
  if (!body) return;
  const items = [];

  // GeoNet VAL — all NZ volcanoes with their current alert level
  geonetVALData.forEach(feature => {
    const props = feature.properties;
    const col   = GEONET_VAL_COLOR[props.level ?? 0] || '#859289';
    const coords = feature.geometry?.coordinates
      ? { lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0], id: `geonet-${props.volcanoID}` }
      : null;
    items.push({
      source: 'NZ', color: col,
      title:  `${props.volcanoTitle} — VAL ${props.level ?? 0}`,
      sub:    props.activity || '',
      time:   null,
      desc:   props.hazards || '',
      url:    `https://www.geonet.org.nz/volcano/${props.volcanoID}`,
      coords,
    });
  });

  document.getElementById('geonet-count').textContent = items.length;

  if (!items.length) {
    body.innerHTML = '<div class="state muted">No elevated volcanic activity</div>';
    return;
  }

  body.innerHTML = items.map(item => {
    const flyAttr = item.coords
      ? `onclick="flyToVolc('${item.coords.id}',${item.coords.lat},${item.coords.lon})" style="border-left-color:${item.color};cursor:pointer"`
      : `style="border-left-color:${item.color}"`;
    return `
    <div class="alert-item" ${flyAttr} title="${item.coords ? 'Click to locate on map' : ''}">
      <div class="alert-row">
        <span class="alert-badge" style="background:${item.color};color:var(--badge-text, #1a2227)">${esc(item.source)}</span>
        <span class="alert-event">${esc(item.title)}</span>
      </div>
      ${item.sub  ? `<div class="alert-sub">${esc(item.sub)}</div>` : ''}
      ${item.desc ? `<div class="alert-sub" style="opacity:.8">${esc(item.desc)}${item.desc.length >= 160 ? '…' : ''}</div>` : ''}
      <div class="alert-meta">
        <span>${fmtTime(item.time)}</span>
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" style="color:var(--accent);margin-left:auto" onclick="event.stopPropagation()">↗</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

function plotVolcanism() {
  if (!map) return;
  volcLayer.clearLayers();

  // GeoNet NZ — GeoJSON Point geometry
  for (const feature of geonetVALData) {
    const props = feature.properties;
    if (!feature.geometry?.coordinates) continue;
    const [lon, lat] = feature.geometry.coordinates;
    const col = GEONET_VAL_COLOR[props.level ?? 0] || '#859289';
    const marker = L.marker([lat, lon], { icon: volcMarkerIcon(col), zIndexOffset: 100 });
    marker._volcId = `geonet-${props.volcanoID}`;
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">🌋 ${esc(props.volcanoTitle)}</div>
      <div class="popup-sub">GeoNet NZ — Volcanic Alert Level ${props.level ?? 0}</div>
      ${props.activity ? `<div class="popup-row" style="margin-top:4px;font-size:11px;color:var(--muted)">${esc(props.activity)}</div>` : ''}
      ${props.hazards  ? `<div class="popup-row" style="font-size:10px;color:var(--muted)">${esc(props.hazards.slice(0,200))}${props.hazards.length>200?'…':''}</div>` : ''}
      <div class="popup-row"><a href="https://www.geonet.org.nz/volcano/${esc(props.volcanoID)}" target="_blank" style="color:var(--accent)">GeoNet ↗</a></div>
    </div>`);
    marker.addTo(volcLayer);
  }

  // USGS VHP — elevated volcanoes (coordinates enriched in loadVHP)
  for (const volcano of vhpData) {
    if (volcano.latitude == null || volcano.longitude == null) continue;
    const col = VHP_ALERT_COLOR[volcano.alert_level] || '#859289';
    const marker = L.marker([volcano.latitude, volcano.longitude], { icon: volcMarkerIcon(col), zIndexOffset: 200 });
    marker._volcId = `vhp-${volcano.vnum}`;
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">🌋 ${esc(volcano.volcano_name)}</div>
      <div class="popup-sub">${esc(volcano.obs_fullname)}</div>
      <div class="popup-row" style="margin-top:4px">
        <span style="background:${col};color:var(--badge-text, #1a2227);padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700">${esc(volcano.alert_level)}</span>
        ${volcano.color_code ? `<span style="margin-left:6px;font-size:11px;color:var(--muted)">Aviation: ${esc(volcano.color_code)}</span>` : ''}
      </div>
      ${volcano.notice_url ? `<div class="popup-row"><a href="${esc(volcano.notice_url)}" target="_blank" style="color:var(--accent)">Latest Notice ↗</a></div>` : ''}
    </div>`);
    marker.addTo(volcLayer);
  }
}

function flyToVolc(id, lat, lon) {
  ensureLayerOn('volc');
  if (!map || lat == null || lon == null) return;
  map.flyTo([lat, lon], Math.max(map.getZoom(), 5), { duration: 1 });
  volcLayer.eachLayer(marker => { if (marker._volcId === id) marker.openPopup(); });
}

/* ══════════════════════════════════════════════════════
   CANADA — Environment and Climate Change Canada MSC
══════════════════════════════════════════════════════ */

let mscData = [];

// Classify MSC alert severity from the alert_type field ("warning" / "watch" /
// "advisory" / "statement"), falling back to matching on free text
function mscSeverity(alertType) {
  const type = (alertType || '').toLowerCase();
  if (type.includes('warning'))  return { color: '#e67e80', label: 'Warning' };
  if (type.includes('watch'))    return { color: '#e69875', label: 'Watch' };
  if (type.includes('advisory')) return { color: '#dbbc7f', label: 'Advisory' };
  return { color: '#7fbbb3', label: 'Statement' };
}

// Title-case a lowercase MSC alert name ("air quality warning" → "Air Quality Warning")
function mscTitleCase(name) {
  return (name || '').replace(/\b\w/g, ch => ch.toUpperCase());
}

async function loadMSCPanel() {
  showLoading('msc-body');
  mscData = [];
  await loadMSC();
  renderMSCPanel();
  markUpdated('msc-updated');
  buildGlobalSummary();
}

async function loadMSC() {
  try {
    // GeoMet OGC API — Features; serves CORS-enabled GeoJSON directly.
    const url = 'https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=500';
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    mscData = geojson.features || [];
    plotMSC();
  } catch (err) { console.warn('MSC load failed:', err.message); }
}

function renderMSCPanel() {
  const body = document.getElementById('msc-body');
  if (!body) return;

  const items = mscData.map(feature => {
    const props    = feature.properties;
    const severity = mscSeverity(props.alert_type);
    return {
      id:      feature.id || '',
      color:   severity.color,
      title:   mscTitleCase(props.alert_name_en) || 'MSC Alert',
      sub:     [props.feature_name_en, props.province].filter(Boolean).join(', '),
      time:    props.validity_datetime || props.publication_datetime,
      expires: props.expiration_datetime,
      desc:    (props.alert_text_en || '').slice(0, 160),
      url:     '',
    };
  });

  document.getElementById('msc-count').textContent = items.length;

  if (!items.length) {
    body.innerHTML = '<div class="state muted">No active Canadian alerts</div>';
    return;
  }

  items.sort((itemA, itemB) => new Date(itemB.time) - new Date(itemA.time));

  body.innerHTML = items.map(item => `
    <div class="alert-item clickable" style="border-left-color:${item.color}"
         onclick="flyToMSC('${esc(item.id)}')" title="Click to locate on map">
      <div class="alert-row">
        <span class="alert-badge" style="background:${item.color};color:var(--badge-text, #1a2227)">CA</span>
        <span class="alert-event">${esc(item.title)}</span>
      </div>
      ${item.sub  ? `<div class="alert-sub">${esc(item.sub)}</div>` : ''}
      ${item.desc ? `<div class="alert-sub" style="opacity:.8">${esc(item.desc)}${item.desc.length >= 160 ? '…' : ''}</div>` : ''}
      <div class="alert-meta">
        <span>${fmtTime(item.time)}</span>
        ${item.expires ? `<span>Exp: ${fmtTime(item.expires)}</span>` : ''}
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" style="color:var(--accent);margin-left:auto" onclick="event.stopPropagation()">↗</a>` : ''}
      </div>
    </div>`).join('');
}

function plotMSC() {
  if (!map) return;
  mscLayer.clearLayers();
  L.geoJSON({ type: 'FeatureCollection', features: mscData }, {
    style(feature) {
      const severity = mscSeverity(feature.properties.alert_type);
      return { color: severity.color, weight: 1, opacity: 0.8, fillColor: severity.color, fillOpacity: 0.12, dashArray: '3 4' };
    },
    onEachFeature(feature, layer) {
      const props    = feature.properties;
      const severity = mscSeverity(props.alert_type);
      const alertText = props.alert_text_en || '';
      layer._mscId = feature.id;
      layer.bindPopup(`<div class="popup-inner">
        <div class="popup-title">🇨🇦 ${esc(mscTitleCase(props.alert_name_en) || 'MSC Alert')}</div>
        <div class="popup-sub">${esc(props.feature_name_en || props.province || '')}</div>
        <div class="popup-row" style="margin-top:4px">
          <span style="background:${severity.color};color:var(--badge-text, #1a2227);padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">${severity.label}</span>
        </div>
        <div class="popup-row" style="margin-top:6px;line-height:1.4;font-size:11px;color:var(--muted)">${esc(alertText.slice(0, 300))}${alertText.length > 300 ? '…' : ''}</div>
        <div class="popup-row"><span>Effective</span><span>${fmtTime(props.validity_datetime || props.publication_datetime)}</span></div>
        <div class="popup-row"><span>Expires</span><span>${fmtTime(props.expiration_datetime)}</span></div>
      </div>`);
    }
  }).addTo(mscLayer);
}

function flyToMSC(identifier) {
  ensureLayerOn('msc');
  if (!map || !identifier) return;
  // mscLayer contains one L.geoJSON group; individual polygon layers are one level deeper
  mscLayer.eachLayer(group => {
    (group.eachLayer ? group : { eachLayer: visit => visit(group) }).eachLayer(polygonLayer => {
      if (polygonLayer._mscId !== identifier) return;
      try {
        const bounds = polygonLayer.getBounds?.();
        if (bounds?.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 8, duration: 1 });
      } catch {}
      polygonLayer.openPopup();
    });
  });
}

/* ══════════════════════════════════════════════════════
   GDACS — Global Disaster Alert and Coordination System
   Feed: https://www.gdacs.org/xml/rss.xml  (via CORS proxy)
══════════════════════════════════════════════════════ */

let gdacsData = [];
const GDACS_COLOR = { Red: '#e67e80', Orange: '#e69875', Green: '#a7c080' };
const GDACS_ICON  = { FL:'💧', TC:'🌀', DR:'☀️', WF:'🔥', VO:'🌋', EQ:'🔴', TS:'🌊' };
const GDACS_LABEL = { FL:'Flood', TC:'Cyclone', DR:'Drought', WF:'Wildfire', VO:'Volcano', EQ:'Earthquake', TS:'Tsunami' };

// Get first direct child element with a given local name (namespace-safe)
function xmlLocal(el, lname) {
  if (!el) return null;
  for (const child of el.children) {
    if (child.localName === lname) return child;
  }
  return null;
}

function xmlLocalText(el, lname) {
  const child = xmlLocal(el, lname);
  return child ? child.textContent.trim() : '';
}

/* ── GDACS per-type popup rows ─────────────────────────────────────
   <gdacs:severity> and <gdacs:population> mean different things for each
   event type, and the numeric value attribute has no unit on its own:
     EQ  severity = magnitude + depth      population = people exposed at an MMI level
     TC  severity = max wind (km/h)        population = people in Cat 1+ winds (+ TS winds)
     FL  severity = placeholder, always 0  population = deaths (+ displaced)
     DR  severity = drought area (km²)     population = always empty
     WF  severity = burned area (ha)       population = people in the fire area
     VO  severity = empty                  population = exposure description
   Tsunamis are never published as their own TS item: GDACS attaches them to
   the triggering earthquake and sets <calculationtype>tsunami</calculationtype>.
   The modelled wave height is only in the event API, fetched when the popup opens. */

// Raw {value, unit, text} of a <gdacs:severity>/<gdacs:population> element
function gdacsMeasure(el) {
  return {
    value: parseFloat(el?.getAttribute('value')) || 0,
    unit:  el?.getAttribute('unit') || '',
    text:  el?.textContent.trim() || '',
  };
}

const gdacsInt = n => Math.round(n).toLocaleString();

function gdacsDate(str) {
  const parsed = new Date(str);
  return isNaN(parsed) ? str : parsed.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

function gdacsPeriod(from, to) {
  if (!from) return '';
  const start = gdacsDate(from), end = to ? gdacsDate(to) : '';
  return end && end !== start ? `${start} – ${end}` : start;
}

// Saffir-Simpson class from 1-minute sustained wind. GDACS's value attribute is
// an exact knot conversion and agrees with the item description; the severity
// text frequently quotes a different speed, so it is not used.
function gdacsCycloneClass(kmh) {
  const kt = kmh / 1.852;
  if (kt < 34)  return 'Tropical Depression';
  if (kt < 64)  return 'Tropical Storm';
  if (kt < 83)  return 'Category 1';
  if (kt < 96)  return 'Category 2';
  if (kt < 113) return 'Category 3';
  if (kt < 137) return 'Category 4';
  return 'Category 5';
}

const MMI_SHAKING = {
  I:'not felt', II:'weak', III:'weak', IV:'light', V:'moderate', VI:'strong',
  VII:'very strong', VIII:'severe', IX:'violent', X:'extreme', XI:'extreme', XII:'extreme',
};

// "90 thousand in MMI V" / "2 thousand (in MMI>=VII)" / "Few people affected in MMI -"
function gdacsShakingExposure(text) {
  const match = text.match(/^(.*?)\s*\(?in MMI\s*(>=)?\s*([IVX]+|-)\s*\)?\.?$/);
  if (!match) return text;
  const [, who, atLeast, mmi] = match;
  if (mmi === '-') return who;
  const people = /^[\d.]+\s*(thousand|million)?$/.test(who) ? `${who} people` : who;
  return `${people} · MMI ${atLeast ? '≥' : ''}${mmi} (${MMI_SHAKING[mmi] || '?'}${atLeast ? '+' : ''} shaking)`;
}

const GDACS_ROWS = {
  EQ(event) {
    const quake = event.sev.text.match(/Magnitude\s+([\d.]+)\s*M?.*?Depth:\s*([\d.]+)\s*km/i);
    const rows = [
      ['Magnitude', quake ? `M ${quake[1]}` : (event.sev.value ? `M ${event.sev.value}` : '')],
      ['Depth',     quake ? `${+parseFloat(quake[2]).toFixed(1)} km` : ''],
      ['Exposed',   gdacsShakingExposure(event.pop.text)],
      ['Occurred',  event.fromdate ? fmtTime(event.fromdate) : ''],
    ];
    if (event.calctype === 'tsunami') rows.push(['Tsunami', 'Checking model…', 'gdacs-tsunami']);
    return rows;
  },
  TC(event) {
    const kmh = event.sev.value;
    // "…wind speeds or higher is 0 (0.768 million in Tropical Storm)"
    const tsWinds = event.pop.text.match(/\(([^()]*?)\s+in Tropical Storm\)/i)?.[1];
    return [
      ['Max wind',      kmh ? `${gdacsInt(kmh)} km/h · ${gdacsCycloneClass(kmh)}` : ''],
      ['In Cat 1+ winds', event.pop.text ? `${gdacsInt(event.pop.value)} people` : ''],
      ['In storm-force winds', tsWinds ? `${tsWinds} people` : ''],
      ['Vulnerability', event.vulnerability],
      ['Active',        gdacsPeriod(event.fromdate, event.todate)],
    ];
  },
  FL(event) {
    const deaths    = event.pop.text.match(/([\d,]+)\s+deaths?/i)?.[1];
    const displaced = event.pop.text.match(/([\d,]+)\s+displaced/i)?.[1];
    return [
      ['Deaths',    deaths ?? ''],
      ['Displaced', displaced && displaced !== '0' ? displaced : ''],
      ['Period',    gdacsPeriod(event.fromdate, event.todate)],
    ];
  },
  DR(event) {
    // "Medium impact for agricultural drought in 196893 km2"
    const impact = event.sev.text.match(/^(\w+) impact for (\w+) drought/i);
    const weeks  = parseInt(event.durationweeks, 10);
    return [
      ['Impact',   impact ? `${impact[1]} (${impact[2]})` : ''],
      ['Area',     event.sev.value ? `${gdacsInt(event.sev.value)} km²` : ''],
      ['Duration', weeks > 0 ? `${weeks} week${weeks === 1 ? '' : 's'}` : ''],
      ['Since',    event.fromdate ? gdacsDate(event.fromdate) : ''],
    ];
  },
  WF(event) {
    return [
      ['Burned area',    event.sev.value ? `${gdacsInt(event.sev.value)} ha` : ''],
      ['People in area', event.pop.text ? gdacsInt(event.pop.value) : ''],
      ['Period',         gdacsPeriod(event.fromdate, event.todate)],
    ];
  },
  VO(event) {
    return [
      ['Activity', event.description],
      ['Exposure', event.pop.text],
      ['Reported', event.fromdate ? gdacsDate(event.fromdate) : ''],
    ];
  },
};
// Tsunami items have never appeared in the feed (GDACS models tsunamis under
// the EQ event), but if one does, it carries the same quake fields.
GDACS_ROWS.TS = GDACS_ROWS.EQ;

// Fallback for any unrecognised type: the readable text, or value + unit
function gdacsGenericRows(event) {
  const describe = ({ text, value, unit }) =>
    text && !/^Magnitude 0\s*$/i.test(text) ? text : (value ? `${value} ${unit}`.trim() : '');
  return [
    ['Severity', describe(event.sev)],
    ['Impact',   describe(event.pop)],
    ['Period',   gdacsPeriod(event.fromdate, event.todate)],
  ];
}

function gdacsRows(event) {
  return (GDACS_ROWS[event.type] || gdacsGenericRows)(event).filter(([, value]) => value);
}

// Modelled max tsunami height lives only in the event API (earthquakedetails.tsmaxheight)
const gdacsTsunamiCache = new Map();
async function fillGDACSTsunami(event, popupEl) {
  const cell = popupEl?.querySelector('.gdacs-tsunami');
  if (!cell || !event.eventid) return;
  try {
    if (!gdacsTsunamiCache.has(event.eventid)) {
      const url = `https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=EQ&eventid=${encodeURIComponent(event.eventid)}`;
      const response = await fetch(proxyUrl(url), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      gdacsTsunamiCache.set(event.eventid, parseFloat(data?.properties?.earthquakedetails?.tsmaxheight));
    }
    const height = gdacsTsunamiCache.get(event.eventid);
    cell.textContent = isNaN(height) ? 'Modelled, no height available'
      : height > 0 ? `Max modelled wave ${height.toFixed(2)} m`
      : 'No significant wave modelled';
  } catch (err) {
    console.warn('GDACS tsunami lookup failed:', err.message);
    cell.textContent = 'Modelled, see GDACS details';
  }
}

async function loadGDACS() {
  gdacsData = [];
  try {
    const response = await fetch(proxyUrl('https://www.gdacs.org/xml/rss.xml'), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const doc  = new DOMParser().parseFromString(text, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    gdacsData = items.map(item => {
      const type     = xmlLocalText(item, 'eventtype');
      const level    = xmlLocalText(item, 'alertlevel');
      const name     = xmlLocalText(item, 'eventname') || item.querySelector('title')?.textContent?.trim() || '';
      const country  = xmlLocalText(item, 'country');
      const todate   = xmlLocalText(item, 'todate');
      const fromdate = xmlLocalText(item, 'fromdate');
      const eventid  = xmlLocalText(item, 'eventid');
      const calctype = xmlLocalText(item, 'calculationtype');
      const durationweeks = xmlLocalText(item, 'durationinweek');
      const vulnerability = xmlLocalText(item, 'vulnerability');
      const description   = item.querySelector('description')?.textContent?.trim() || '';
      const sev      = gdacsMeasure(xmlLocal(item, 'severity'));
      const pop      = gdacsMeasure(xmlLocal(item, 'population'));
      const guid     = item.querySelector('guid')?.textContent?.trim() || '';
      const link     = item.querySelector('link')?.textContent?.trim() || '';
      // georss:point → "lat lon"
      const ptEl = xmlLocal(item, 'point');
      let lat = null, lon = null;
      if (ptEl) {
        const parts = ptEl.textContent.trim().split(/\s+/);
        if (parts.length >= 2) { lat = parseFloat(parts[0]); lon = parseFloat(parts[1]); }
      }
      return { type, level, name, country, fromdate, todate, eventid, calctype, durationweeks,
               vulnerability, description, sev, pop, guid, link, lat, lon };
    }).filter(event => event.type);
  } catch (err) {
    console.warn('GDACS load failed:', err.message);
    return;
  }
  plotGDACS();
  noteDataLoaded();
  AlertStore.push('gdacs', normalizeGDACS(gdacsData));
}

// Diamond-shaped divIcon: immediately distinct from circle EQ markers and triangle volcano markers
function gdacsMarkerIcon(type, level) {
  const col = GDACS_COLOR[level] || '#859289';
  const lbl = (type || '?').slice(0, 2); // 2-char type code: TC, FL, DR…
  return L.divIcon({
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center">
      <div style="width:23px;height:23px;background:${col};border:2px solid rgba(0,0,0,.55);transform:rotate(45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 7px rgba(0,0,0,.55)">
        <span style="transform:rotate(-45deg);font-size:8px;font-weight:800;color:var(--badge-text, #1a2227);letter-spacing:-.3px;line-height:1;font-family:system-ui,sans-serif">${lbl}</span>
      </div>
    </div>`,
    className:   'leaflet-marker-emoji',
    iconSize:    [36, 36],
    iconAnchor:  [18, 18],
    popupAnchor: [0, -20],
  });
}

function plotGDACS() {
  if (!gdacsLayer) return;
  gdacsLayer.clearLayers();
  gdacsData.filter(event => event.lat != null && event.lon != null).forEach(event => {
    const icon = GDACS_ICON[event.type]  || '⚠️';
    const lbl  = GDACS_LABEL[event.type] || event.type;
    const col  = GDACS_COLOR[event.level] || '#859289';
    const marker = L.marker([event.lat, event.lon], { icon: gdacsMarkerIcon(event.type, event.level) });
    marker._gdacsGuid = event.guid;
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">${icon} ${esc(event.name || lbl)}</div>
      <div class="popup-row"><span>Type</span><span>${esc(lbl)}</span></div>
      <div class="popup-row"><span>Alert</span><span style="color:${col};font-weight:600">${esc(event.level)}</span></div>
      ${event.country  ? `<div class="popup-row"><span>Country</span><span>${esc(event.country)}</span></div>` : ''}
      ${gdacsRows(event).map(([label, value, cls]) =>
        `<div class="popup-row"><span>${esc(label)}</span><span${cls ? ` class="${cls}"` : ''}>${esc(value)}</span></div>`).join('')}
      ${event.link     ? `<div class="popup-row"><a href="${esc(event.link)}" target="_blank" rel="noopener">GDACS Details ↗</a></div>` : ''}
    </div>`);
    if (event.calctype === 'tsunami') {
      marker.on('popupopen', popupEvent => fillGDACSTsunami(event, popupEvent.popup.getElement()));
    }
    gdacsLayer.addLayer(marker);
  });
}

function flyToGDACS(guid) {
  ensureLayerOn('gdacs');
  const event = gdacsData.find(entry => entry.guid === guid);
  if (!event || event.lat == null || event.lon == null || !map) return;
  map.flyTo([event.lat, event.lon], Math.max(map.getZoom(), 5), { duration: 1 });
  gdacsLayer.eachLayer(marker => { if (marker._gdacsGuid === guid) marker.openPopup(); });
}

/* ══════════════════════════════════════════════════════
   METEOALARM — European Severe Weather Warnings
   Covers 39 countries via CAP feeds (via CORS proxy)
══════════════════════════════════════════════════════ */

let meteoalarmData = [];

const METEO_SEV_COLOR = {
  Minor:    '#a7c080',
  Moderate: '#dbbc7f',
  Severe:   '#e69875',
  Extreme:  '#e67e80',
};

const METEO_SEV_ORDER = { Minor: 0, Moderate: 1, Severe: 2, Extreme: 3 };

/* ── MeteoAlarm awareness codes ──────────────────────────────────
   Most national feeds put a human-readable description in the CAP
   `event` field. Romania instead publishes the raw awareness codes, as an example.
   Code meanings come from MeteoAlarm's own EDR API metadata.
   Type 11 is absent from their list; 12 and 13 are both flood variants,
   so it is mapped defensively rather than left to fall through. */
const METEO_AWARENESS_TYPE = {
  1: 'Wind',            2: 'Snow/Ice',        3: 'Thunderstorm',
  4: 'Fog',             5: 'High Temperature', 6: 'Low Temperature',
  7: 'Coastal Event',   8: 'Forest Fire',     9: 'Avalanches',
  10: 'Rain',           11: 'Flooding',       12: 'Flooding',
  13: 'Rain/Flood',     14: 'Marine Hazard',  15: 'Drought',
};

/* Read the structured MeteoAlarm awareness codes out of a CAP info block.
   Values look like "1; green; Minor" and "5; high-temperature". */
function meteoAwareness(info) {
  let level = null, hazard = null;
  for (const param of (info.parameter || [])) {
    const name  = (param.valueName || '').toLowerCase();
    const digit = /^\s*(\d+)/.exec(String(param.value ?? ''));
    if (!digit) continue;
    if      (name === 'awareness_level') level  = +digit[1];
    else if (name === 'awareness_type')  hazard = METEO_AWARENESS_TYPE[+digit[1]] || null;
  }
  return { level, hazard };
}

// "awareness_type=5, awareness_level=2" → "High Temperature".
// The level is deliberately dropped: it always matches the CAP severity
// already shown on the badge beside this text, so repeating it just
// duplicates. Any event string not in code form is returned untouched.
function meteoDecodeEvent(event) {
  const match = /awareness_type\s*=\s*(\d+)/i.exec(event || '');
  if (!match) return event;
  return METEO_AWARENESS_TYPE[+match[1]] || event;   // unknown code → leave raw
}

// Slugs must match live feeds at https://feeds.meteoalarm.org/
const METEOALARM_COUNTRIES = [
  'andorra','austria','belgium','bosnia-herzegovina','bulgaria','croatia',
  'cyprus','czechia','denmark','estonia','finland','france','germany',
  'greece','hungary','iceland','ireland','israel','italy','latvia',
  'lithuania','luxembourg','malta','moldova','montenegro','netherlands',
  'norway','poland','portugal','republic-of-north-macedonia','romania',
  'serbia','slovakia','slovenia','spain','sweden','switzerland','ukraine',
  'united-kingdom',
];

// Prefer English info block; fall back to first
function meteoInfoEN(infoArr) {
  if (!Array.isArray(infoArr) || !infoArr.length) return null;
  return infoArr.find(info => info.language && info.language.toLowerCase().startsWith('en')) || infoArr[0];
}

// Parse Meteoalarm polygon field → array of rings [[lat,lon],...] or null
// The field may be a single string or an array of strings (one per sub-area polygon)
function parseMeteoPolygon(polygon) {
  if (!polygon) return null;
  const strings = Array.isArray(polygon) ? polygon : [polygon];
  const rings = strings.map(polygonStr => {
    if (!polygonStr || typeof polygonStr !== 'string') return null;
    try {
      const coords = polygonStr.trim().split(/\s+/).map(pair => {
        const [lat, lon] = pair.split(',').map(Number);
        return [lat, lon];
      }).filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
      return coords.length >= 3 ? coords : null;
    } catch { return null; }
  }).filter(Boolean);
  return rings.length ? rings : null;
}

async function loadMeteoalarm() {
  meteoalarmData = [];
  const BASE = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-';
  const results = await Promise.allSettled(
    METEOALARM_COUNTRIES.map(country =>
      fetch(proxyUrl(BASE + country), { signal: AbortSignal.timeout(15000) })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
    )
  );
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value?.warnings) return;
    const country = METEOALARM_COUNTRIES[index];
    result.value.warnings.forEach(warning => {
      // API wraps CAP data under warning.alert; fall back to flat structure for older feeds
      const alertObj = warning.alert || warning;
      const info = meteoInfoEN(alertObj.info);
      if (!info) return;

      const awareness = meteoAwareness(info);

      // Drop green "no particular awareness required" entries. Many national
      // feeds publish one per hazard type per region as a placeholder.
      if (awareness.level === 1) return;

      // Drop anything already expired — the map layer and AlertStore read this
      // array directly, so without this they keep showing lapsed warnings.
      if (info.expires && new Date(info.expires).getTime() <= Date.now()) return;

      const sev = info.severity || 'Minor';
      // Keep each country's own description; only fall back to the structured
      // hazard name when a feed publishes raw codes instead (Romania).
      const rawEvent = (info.event || '').trim();
      const event = (/awareness_type\s*=/i.test(rawEvent)
                      ? (awareness.hazard || meteoDecodeEvent(rawEvent))
                      : rawEvent) || 'Warning';
      // Collect polygons from all areas (some countries split into multiple area entries)
      const allAreas = Array.isArray(info.area) ? info.area : (info.area ? [info.area] : []);
      const area = allAreas[0] || {};
      // Gather all polygon strings across all areas, then parse
      const allPolygonStrings = allAreas.flatMap(areaEntry =>
        Array.isArray(areaEntry.polygon) ? areaEntry.polygon : (areaEntry.polygon ? [areaEntry.polygon] : [])
      );
      const coords = parseMeteoPolygon(allPolygonStrings.length ? allPolygonStrings : null);
      // Centroid: average of all rings' average points
      let centLat = null, centLon = null;
      if (coords) {
        const allPts = coords.flat();
        centLat = allPts.reduce((sum, point) => sum + point[0], 0) / allPts.length;
        centLon = allPts.reduce((sum, point) => sum + point[1], 0) / allPts.length;
      }
      meteoalarmData.push({
        id:       alertObj.identifier || warning.uuid || `${country}-${Date.now()}-${Math.random()}`,
        country,
        severity: sev,
        event,
        areaDesc: area.areaDesc || country,
        headline: info.headline || '',
        onset:    info.onset    || alertObj.sent || '',
        expires:  info.expires  || '',
        coords,
        centLat,
        centLon,
      });
    });
  });
  plotMeteoalarm();
  noteDataLoaded();
  AlertStore.push('meteoalarm', normalizeMeteoalarm(meteoalarmData));
}

function plotMeteoalarm() {
  if (!meteoalarmLayer) return;
  meteoalarmLayer.clearLayers();
  meteoalarmData.forEach(warning => {
    const col = METEO_SEV_COLOR[warning.severity] || '#859289';
    if (warning.coords) {
      // coords is an array of rings; L.polygon accepts [[ring1],[ring2],...] for multi-ring
      const poly = L.polygon(warning.coords, {
        color: col, weight: 1.5, opacity: 0.85,
        fillColor: col, fillOpacity: 0.18,
      });
      poly._meteoId = warning.id;
      poly.bindPopup(_meteoPopup(warning));
      meteoalarmLayer.addLayer(poly);
    } else if (warning.centLat != null) {
      const marker = L.circleMarker([warning.centLat, warning.centLon], {
        radius: 7, color: col, weight: 2, opacity: 0.9,
        fillColor: col, fillOpacity: 0.35,
      });
      marker._meteoId = warning.id;
      marker.bindPopup(_meteoPopup(warning));
      meteoalarmLayer.addLayer(marker);
    }
  });
}

function _meteoPopup(warning) {
  const col = METEO_SEV_COLOR[warning.severity] || '#859289';
  return `<div class="popup-inner">
    <div class="popup-title">⚠️ ${esc(warning.event)}</div>
    <div class="popup-row"><span>Severity</span><span style="color:${col}">${esc(warning.severity)}</span></div>
    <div class="popup-row"><span>Area</span><span>${esc(warning.areaDesc)}</span></div>
    ${warning.headline ? `<div class="popup-row"><span>Info</span><span>${esc(warning.headline)}</span></div>` : ''}
    ${warning.onset   ? `<div class="popup-row"><span>Onset</span><span>${fmtTime(warning.onset)}</span></div>`     : ''}
    ${warning.expires ? `<div class="popup-row"><span>Expires</span><span>${fmtTime(warning.expires)}</span></div>` : ''}
  </div>`;
}

function flyToMeteo(id) {
  ensureLayerOn('meteoalarm');
  const warning = meteoalarmData.find(entry => entry.id === id);
  if (!warning || !map) return;
  // Try to fly to polygon bounds first, then fall back to centroid
  let flown = false;
  meteoalarmLayer.eachLayer(layer => {
    if (layer._meteoId !== id) return;
    try {
      const bounds = layer.getBounds?.();
      if (bounds?.isValid()) {
        map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 8, duration: 1 });
        flown = true;
      }
    } catch {}
    layer.openPopup();
  });
  if (!flown && warning.centLat != null && warning.centLon != null) {
    map.flyTo([warning.centLat, warning.centLon], Math.max(map.getZoom(), 5), { duration: 1 });
  }
}

/* ══════════════════════════════════════════════════════
   WMO SWIC — Global Severe Weather Alerts
   WFS GeoServer with full polygon geometry
   Endpoint: https://severeweather.wmo.int/f/ows
══════════════════════════════════════════════════════ */

let wmoData = [];

// s integer: 0=Unknown 1=Minor 2=Moderate 3=Severe 4=Extreme
const WMO_SEV_COLOR = ['#859289', '#a7c080', '#dbbc7f', '#e69875', '#e67e80'];
const WMO_SEV_LABEL = ['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'];

/* CAP urgency/certainty, which the WFS exposes as the numeric `u` and `c`
   columns. Mapping confirmed by fetching the source CAP files and comparing:
   u 4=Immediate 3=Expected 2=Future 0=Unknown, c 4=Observed 3=Likely
   2=Possible 0=Unknown.

   Certainty is the field that separates "this hazard is happening" from
   "conditions make it likely". It matters because several services publish
   risk forecasts under an event name that reads like an active event.
   As an example, Kazakhstan's fire-danger warnings arrive as event "Forestfire", severity
   Extreme, certainty Likely, with no description text to disambiguate. */
const WMO_URGENCY   = { 0:'Unknown', 1:'Past', 2:'Future', 3:'Expected', 4:'Immediate' };
const WMO_CERTAINTY = { 0:'Unknown', 1:'Unlikely', 2:'Possible', 3:'Likely', 4:'Observed' };

// Plain-language gloss so the CAP term isn't left to interpretation
function wmoCertaintyNote(code) {
  if (code === 4) return 'observed — hazard reported';
  if (code === 3 || code === 2) return 'forecast — not yet observed';
  return null;
}

// Extract 2-letter ISO country code from capurl prefix (e.g. "cn-cma-xx/..." → "cn")
const WMO_ISO2_NAME = {
  af:'Afghanistan', al:'Albania', dz:'Algeria', ao:'Angola', ar:'Argentina',
  am:'Armenia', au:'Australia', at:'Austria', az:'Azerbaijan', bd:'Bangladesh',
  by:'Belarus', be:'Belgium', bj:'Benin', bo:'Bolivia', ba:'Bosnia',
  br:'Brazil', bg:'Bulgaria', bf:'Burkina Faso', kh:'Cambodia', cm:'Cameroon',
  ca:'Canada', cl:'Chile', cn:'China', co:'Colombia', cd:'DR Congo',
  cr:'Costa Rica', hr:'Croatia', cu:'Cuba', cz:'Czechia', dk:'Denmark',
  do:'Dominican Rep.', ec:'Ecuador', eg:'Egypt', sv:'El Salvador', et:'Ethiopia',
  fi:'Finland', fr:'France', ge:'Georgia', de:'Germany', gh:'Ghana',
  gr:'Greece', gt:'Guatemala', gn:'Guinea', ht:'Haiti', hn:'Honduras',
  hu:'Hungary', in:'India', id:'Indonesia', ir:'Iran', iq:'Iraq',
  ie:'Ireland', il:'Israel', it:'Italy', jm:'Jamaica', jp:'Japan',
  jo:'Jordan', kz:'Kazakhstan', ke:'Kenya', kp:'North Korea', kr:'South Korea',
  kw:'Kuwait', kg:'Kyrgyzstan', la:'Laos', lv:'Latvia', lb:'Lebanon',
  ly:'Libya', lt:'Lithuania', mg:'Madagascar', mw:'Malawi', my:'Malaysia',
  ml:'Mali', mr:'Mauritania', mx:'Mexico', md:'Moldova', mn:'Mongolia',
  ma:'Morocco', mz:'Mozambique', mm:'Myanmar', np:'Nepal', nl:'Netherlands',
  nz:'New Zealand', ni:'Nicaragua', ng:'Nigeria', no:'Norway', om:'Oman',
  pk:'Pakistan', pa:'Panama', py:'Paraguay', pe:'Peru', ph:'Philippines',
  pl:'Poland', pt:'Portugal', ro:'Romania', ru:'Russia', sa:'Saudi Arabia',
  sn:'Senegal', rs:'Serbia', sl:'Sierra Leone', so:'Somalia', za:'South Africa',
  es:'Spain', lk:'Sri Lanka', sd:'Sudan', se:'Sweden', ch:'Switzerland',
  sy:'Syria', tw:'Taiwan', tj:'Tajikistan', tz:'Tanzania', th:'Thailand',
  tg:'Togo', tn:'Tunisia', tr:'Turkey', tm:'Turkmenistan', ug:'Uganda',
  ua:'Ukraine', ae:'UAE', gb:'United Kingdom', us:'USA', uz:'Uzbekistan',
  ve:'Venezuela', vn:'Vietnam', ye:'Yemen', zm:'Zambia', zw:'Zimbabwe',
};

function wmoCountryFromCapurl(capurl) {
  if (!capurl) return '';
  const iso2 = capurl.split('-')[0].toLowerCase();
  return WMO_ISO2_NAME[iso2] || iso2.toUpperCase();
}

/* ── Australia via WMO SWIC ──────────────────────────────────────
   The Bureau of Meteorology publishes its CAP warnings into SWIC under the
   "au-bom-en" prefix, so Australia is served from the same WFS as the rest
   of the world rather than from BOM's own (undocumented) app API. BOM tags
   most of those alerts with CAP severity 0 or 1, including active Severe
   Weather Warnings, so the global "s>=2" filter would drop nearly all of
   them and the fixed severity would mis-rank the rest. They are fetched
   with a separate query and re-graded from the event name and description. */
const WMO_BOM_PREFIX = 'au-bom-en/';

function bomCapSeverity(props) {
  const s     = props.s ?? 0;
  const event = (props.event || '').toLowerCase();
  const text  = `${props.headline || ''} ${props.description || ''}`.toLowerCase();
  if (/tsunami|tropical cyclone/.test(event))   return 4;
  if (/flood/.test(event))                       return /major flooding/.test(text) ? 3 : /moderate flooding/.test(text) ? 2 : 1;
  if (/heat/.test(event))                        return /extreme heatwave/.test(text) ? 4 : /severe heatwave/.test(text) ? 3 : 2;
  if (/fire/.test(event))                        return /catastrophic/.test(text) ? 4 : 3;
  if (/^weather$|thunderstorm/.test(event))      return Math.max(s, 3);   // BOM only issues these as "Severe ..." warnings
  if (/sheep|grazier|frost|road/.test(event))    return 1;
  return Math.max(s, 1);
}

// BOM's CAP event names are terse ("Weather", "Riverine Flood"); restore the
// product names Australians know from the warnings themselves.
function bomCapEvent(props) {
  const event = (props.event || '').trim();
  const text  = `${props.headline || ''} ${props.description || ''}`.toLowerCase();
  if (/^weather$/i.test(event))        return 'Severe Weather Warning';
  if (/thunderstorm/i.test(event))     return 'Severe Thunderstorm Warning';
  if (/flood/i.test(event)) {
    const level = /major flooding/.test(text) ? 'Major' : /moderate flooding/.test(text) ? 'Moderate' : 'Minor';
    return `${level} Flood Warning`;
  }
  if (/^wind$/i.test(event))           return 'Wind Warning';
  if (/fire/i.test(event))             return 'Fire Weather Warning';
  return event || 'Weather Warning';
}

async function loadWMO() {
  wmoData = [];
  const base = 'https://severeweather.wmo.int/f/ows';
  const wfs = (cql, extra = {}) => new URLSearchParams({
    service:      'WFS',
    version:      '1.1.0',
    request:      'GetFeature',
    typeName:     'local_postgis:postgis_geojsons',
    outputFormat: 'application/json',
    CQL_FILTER:   cql,
    ...extra,
  });
  // Global: severe+ land alerts, server-side filtered + sorted.
  // Australia: every land alert from BOM, re-graded client-side (see above).
  const globalParams = wfs("s>=2 AND marine='0' AND row_type<>'BOUNDARY'", { maxFeatures: '250', sortBy: 's D' });
  const bomParams    = wfs(`capurl LIKE '${WMO_BOM_PREFIX}%' AND marine='0' AND row_type<>'BOUNDARY'`, { maxFeatures: '200' });
  try {
    const [globalRes, bomRes] = await Promise.all([
      fetch(proxyUrl(`${base}?${globalParams}`), { signal: AbortSignal.timeout(20000) }),
      fetch(proxyUrl(`${base}?${bomParams}`),    { signal: AbortSignal.timeout(20000) })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null),   // Australia is additive; a failure must not sink the global feed
    ]);
    if (!globalRes.ok) throw new Error(`HTTP ${globalRes.status}`);
    const geojson = await globalRes.json();
    if (!Array.isArray(geojson.features)) throw new Error('Unexpected response shape');
    const features = [...geojson.features, ...(bomRes?.features || [])];

    // Deduplicate by capurl — keep best geometry type (POLYGON/MULTIPOLYGON > POINT)
    const geomRank = { POLYGON: 2, MULTIPOLYGON: 2, POINT: 1 };
    const seen = new Map();
    for (const feature of features) {
      const props = feature.properties;
      const key = props.capurl || feature.id;
      const rank = geomRank[props.row_type] ?? 0;
      if (!seen.has(key) || rank > (geomRank[seen.get(key).properties.row_type] ?? 0)) {
        seen.set(key, feature);
      }
    }

    wmoData = [...seen.values()].map(feature => {
      const props = feature.properties;
      // Compute centroid for point/polygon fly-to
      let centLat = null, centLon = null;
      if (feature.geometry?.type === 'Point') {
        [centLon, centLat] = feature.geometry.coordinates;
      } else if (feature.bbox) {
        centLon = (feature.bbox[0] + feature.bbox[2]) / 2;
        centLat = (feature.bbox[1] + feature.bbox[3]) / 2;
      }
      const fromBom = (props.capurl || '').startsWith(WMO_BOM_PREFIX);
      return {
        id:       feature.id,
        capurl:   props.capurl || '',
        country:  wmoCountryFromCapurl(props.capurl),
        areadesc: props.areadesc || '',
        event:    fromBom ? bomCapEvent(props)    : (props.event || ''),
        sev:      fromBom ? bomCapSeverity(props) : (props.s ?? 0),
        source:   fromBom ? 'bom' : 'wmo',
        credit:   fromBom ? 'Bureau of Meteorology via WMO SWIC' : '',
        urgency:   props.u ?? 0,
        certainty: props.c ?? 0,
        onset:    props.onset    || props.effective || props.sent || '',
        expires:  props.expires  || props.chk_expires || '',
        geometry: feature.geometry || null,
        centLat, centLon,
      };
    });
  } catch (err) {
    console.warn('WMO load failed:', err.message);
    return;
  }
  plotWMO();
  noteDataLoaded();
  // Two store sources so BOM keeps its own tag, header count and stale-sweep
  const normalized = normalizeWMO(wmoData);
  AlertStore.push('wmo', normalized.filter(alert => alert.source === 'wmo'));
  AlertStore.push('bom', normalized.filter(alert => alert.source === 'bom'));
}

function plotWMO() {
  if (!wmoLayer) return;
  wmoLayer.clearLayers();
  // Only plot Severe+ on the map to avoid overwhelming it
  wmoData.filter(alert => alert.sev >= 3 && alert.geometry).forEach(alert => {
    const col = WMO_SEV_COLOR[alert.sev] || '#859289';
    let layer;
    if (alert.geometry.type === 'Point') {
      const [lon, lat] = alert.geometry.coordinates;
      layer = L.circleMarker([lat, lon], {
        radius: 6, color: col, weight: 1.5, opacity: 0.9,
        fillColor: col, fillOpacity: 0.4,
      });
    } else {
      // L.geoJSON handles GeoJSON [lon,lat] → Leaflet [lat,lon] natively
      layer = L.geoJSON(alert.geometry, {
        style: { color: col, weight: 1.2, opacity: 0.8, fillColor: col, fillOpacity: 0.15 },
      });
    }
    const popup = `<div class="popup-inner">
      <div class="popup-title">⚠️ ${esc(alert.event || 'Weather Alert')}</div>
      <div class="popup-row"><span>Severity</span><span style="color:${col};font-weight:600">${esc(WMO_SEV_LABEL[alert.sev] ?? '')}</span></div>
      <div class="popup-row"><span>Certainty</span><span>${esc(WMO_CERTAINTY[alert.certainty] || 'Unknown')}${
        wmoCertaintyNote(alert.certainty) ? ` <span style="color:var(--muted)">(${esc(wmoCertaintyNote(alert.certainty))})</span>` : ''}</span></div>
      <div class="popup-row"><span>Urgency</span><span>${esc(WMO_URGENCY[alert.urgency] || 'Unknown')}</span></div>
      ${alert.areadesc ? `<div class="popup-row"><span>Area</span><span>${esc(alert.areadesc)}</span></div>` : ''}
      ${alert.country  ? `<div class="popup-row"><span>Country</span><span>${esc(alert.country)}</span></div>` : ''}
      ${alert.onset    ? `<div class="popup-row"><span>Onset</span><span>${fmtTime(alert.onset)}</span></div>` : ''}
      ${alert.expires  ? `<div class="popup-row"><span>Expires</span><span>${fmtTime(alert.expires)}</span></div>` : ''}
      ${alert.credit   ? `<div class="popup-row"><span>Source</span><span>${esc(alert.credit)}</span></div>` : ''}
    </div>`;
    if (layer.bindPopup) {
      layer.bindPopup(popup);
    } else {
      layer.eachLayer(subLayer => subLayer.bindPopup(popup));
    }
    layer._wmoId = alert.id;
    wmoLayer.addLayer(layer);
  });
}

function flyToWMO(id) {
  ensureLayerOn('wmo');
  const alert = wmoData.find(entry => entry.id === id);
  if (!alert || !map) return;
  if (alert.centLat != null && alert.centLon != null) {
    map.flyTo([alert.centLat, alert.centLon], Math.max(map.getZoom(), 5), { duration: 1 });
  }
  // Open popup on matching layer
  wmoLayer.eachLayer(layer => {
    if (layer._wmoId !== id) return;
    if (layer.openPopup) layer.openPopup();
    else layer.eachLayer?.(subLayer => subLayer.openPopup?.());
  });
}

/* ══════════════════════════════════════════════════════
   ALERTSTORE — cross-source alert index + per-country panels
   Meteoalarm, WMO and GDACS push normalized alerts here; the store
   groups them by country → sub-region → continent for the sidebar.
══════════════════════════════════════════════════════ */

/* ── Geographic hierarchy ───────────────────────────────────────── */
const GEO_REGIONS = {
  // Europe
  'Nordic':          ['denmark','finland','iceland','norway','sweden'],
  'British Isles':   ['ireland','united-kingdom'],
  'Western Europe':  ['andorra','belgium','france','luxembourg','monaco','netherlands','switzerland'],
  'Central Europe':  ['austria','czechia','germany','hungary','poland','slovakia','slovenia'],
  'Southern Europe': ['albania','bosnia-herzegovina','croatia','cyprus','greece','israel','italy','malta','montenegro','north-macedonia','portugal','serbia','spain','turkey'],
  'Eastern Europe':  ['belarus','bulgaria','estonia','latvia','lithuania','moldova','romania','russia','ukraine'],
  // Americas
  'North America':   ['canada','mexico','united-states'],
  'Caribbean':       ['bahamas','barbados','cuba','dominican-republic','haiti','jamaica','puerto-rico','trinidad-and-tobago'],
  'Central America': ['belize','costa-rica','el-salvador','guatemala','honduras','nicaragua','panama'],
  'South America':   ['argentina','bolivia','brazil','chile','colombia','ecuador','guyana','paraguay','peru','suriname','uruguay','venezuela'],
  // Africa
  'North Africa':    ['algeria','egypt','libya','morocco','tunisia'],
  'West Africa':     ['benin','burkina-faso','cameroon','cape-verde','gambia','ghana','guinea','guinea-bissau','ivory-coast','liberia','mali','mauritania','niger','nigeria','senegal','sierra-leone','togo'],
  'East Africa':     ['burundi','djibouti','eritrea','ethiopia','kenya','rwanda','somalia','south-sudan','sudan','tanzania','uganda'],
  'Southern Africa': ['botswana','comoros','dr-congo','lesotho','madagascar','malawi','mauritius','mozambique','namibia','republic-of-congo','south-africa','zambia','zimbabwe'],
  // Asia-Pacific
  'Middle East':     ['afghanistan','bahrain','iran','iraq','jordan','kuwait','lebanon','oman','qatar','saudi-arabia','syria','united-arab-emirates','yemen'],
  'Central Asia':    ['armenia','azerbaijan','georgia','kazakhstan','kyrgyzstan','tajikistan','turkmenistan','uzbekistan'],
  'South Asia':      ['bangladesh','bhutan','india','maldives','nepal','pakistan','sri-lanka'],
  'East Asia':       ['china','japan','mongolia','north-korea','south-korea','taiwan'],
  'Southeast Asia':  ['brunei','cambodia','indonesia','laos','malaysia','myanmar','philippines','singapore','thailand','timor-leste','vietnam'],
  'Oceania':         ['australia','fiji','new-zealand','papua-new-guinea','samoa','solomon-islands','tonga','vanuatu'],
  // Catch-all
  'Global':          [],
};

const GEO_COUNTRY_REGION = {};

for (const [region, countries] of Object.entries(GEO_REGIONS)) {
  for (const c of countries) GEO_COUNTRY_REGION[c] = region;
}

// Which panel group each sub-region belongs to
const GEO_REGION_GROUP = {
  'Nordic':'Europe','British Isles':'Europe','Western Europe':'Europe',
  'Central Europe':'Europe','Southern Europe':'Europe','Eastern Europe':'Europe',
  'North America':'Americas','Caribbean':'Americas','Central America':'Americas','South America':'Americas',
  'North Africa':'Africa','West Africa':'Africa','East Africa':'Africa','Southern Africa':'Africa',
  'Middle East':'Asia-Pacific','Central Asia':'Asia-Pacific','South Asia':'Asia-Pacific',
  'East Asia':'Asia-Pacific','Southeast Asia':'Asia-Pacific','Oceania':'Asia-Pacific',
  'Global':'Global',
};

// Full country name → slug (for WMO ISO-name and GDACS raw-name normalization)
const COUNTRY_NAME_SLUG = {
  'afghanistan':'afghanistan','albania':'albania','algeria':'algeria','andorra':'andorra',
  'angola':'angola','argentina':'argentina','armenia':'armenia','australia':'australia',
  'austria':'austria','azerbaijan':'azerbaijan','bahamas':'bahamas','bahrain':'bahrain',
  'bangladesh':'bangladesh','barbados':'barbados','belarus':'belarus','belgium':'belgium',
  'belize':'belize','benin':'benin','bhutan':'bhutan','bolivia':'bolivia',
  'bosnia and herzegovina':'bosnia-herzegovina','bosnia-herzegovina':'bosnia-herzegovina',
  'botswana':'botswana','brazil':'brazil','brunei':'brunei','bulgaria':'bulgaria',
  'burkina faso':'burkina-faso','burundi':'burundi','cambodia':'cambodia',
  'cameroon':'cameroon','canada':'canada','cape verde':'cape-verde',
  'central african republic':'central-african-republic','chad':'chad','chile':'chile',
  'china':'china','colombia':'colombia','comoros':'comoros','congo':'republic-of-congo',
  'costa rica':'costa-rica','croatia':'croatia','cuba':'cuba','cyprus':'cyprus',
  'czechia':'czechia','czech republic':'czechia','democratic republic of the congo':'dr-congo',
  'dr congo':'dr-congo','denmark':'denmark','djibouti':'djibouti',
  'dominican republic':'dominican-republic','ecuador':'ecuador','egypt':'egypt',
  'el salvador':'el-salvador','eritrea':'eritrea','estonia':'estonia','ethiopia':'ethiopia',
  'fiji':'fiji','finland':'finland','france':'france','gabon':'gabon','gambia':'gambia',
  'georgia':'georgia','germany':'germany','ghana':'ghana','greece':'greece',
  'guatemala':'guatemala','guinea':'guinea','guinea-bissau':'guinea-bissau',
  'guyana':'guyana','haiti':'haiti','honduras':'honduras','hungary':'hungary',
  'iceland':'iceland','india':'india','indonesia':'indonesia','iran':'iran','iraq':'iraq',
  'ireland':'ireland','israel':'israel','italy':'italy',
  "cote d'ivoire":'ivory-coast',"côte d'ivoire":'ivory-coast','ivory coast':'ivory-coast',
  'jamaica':'jamaica','japan':'japan','jordan':'jordan','kazakhstan':'kazakhstan',
  'kenya':'kenya','kyrgyzstan':'kyrgyzstan','laos':'laos',
  "lao people's democratic republic":'laos','latvia':'latvia','lebanon':'lebanon',
  'lesotho':'lesotho','liberia':'liberia','libya':'libya','lithuania':'lithuania',
  'luxembourg':'luxembourg','madagascar':'madagascar','malawi':'malawi',
  'malaysia':'malaysia','maldives':'maldives','mali':'mali','malta':'malta',
  'mauritania':'mauritania','mauritius':'mauritius','mexico':'mexico',
  'moldova':'moldova','republic of moldova':'moldova','mongolia':'mongolia',
  'montenegro':'montenegro','morocco':'morocco','mozambique':'mozambique',
  'myanmar':'myanmar','namibia':'namibia','nepal':'nepal','netherlands':'netherlands',
  'new zealand':'new-zealand','nicaragua':'nicaragua','niger':'niger','nigeria':'nigeria',
  'north korea':'north-korea',"democratic people's republic of korea":'north-korea',
  'north macedonia':'north-macedonia','norway':'norway','oman':'oman',
  'pakistan':'pakistan','panama':'panama','papua new guinea':'papua-new-guinea',
  'paraguay':'paraguay','peru':'peru','philippines':'philippines','poland':'poland',
  'portugal':'portugal','puerto rico':'puerto-rico','qatar':'qatar',
  'republic of congo':'republic-of-congo','romania':'romania','russia':'russia',
  'russian federation':'russia','rwanda':'rwanda','saudi arabia':'saudi-arabia',
  'senegal':'senegal','serbia':'serbia','sierra leone':'sierra-leone',
  'singapore':'singapore','slovakia':'slovakia','slovenia':'slovenia',
  'solomon islands':'solomon-islands','somalia':'somalia','south africa':'south-africa',
  'south korea':'south-korea','republic of korea':'south-korea','south sudan':'south-sudan',
  'spain':'spain','sri lanka':'sri-lanka','sudan':'sudan','suriname':'suriname',
  'sweden':'sweden','switzerland':'switzerland','syria':'syria','taiwan':'taiwan',
  'tajikistan':'tajikistan','tanzania':'tanzania','united republic of tanzania':'tanzania',
  'thailand':'thailand','togo':'togo','trinidad and tobago':'trinidad-and-tobago',
  'tunisia':'tunisia','turkey':'turkey','turkiye':'turkey','turkmenistan':'turkmenistan',
  'uganda':'uganda','ukraine':'ukraine','united arab emirates':'united-arab-emirates',
  'united kingdom':'united-kingdom','united states':'united-states',
  'united states of america':'united-states','usa':'united-states','us':'united-states',
  'uruguay':'uruguay','uzbekistan':'uzbekistan','vanuatu':'vanuatu',
  'venezuela':'venezuela','vietnam':'vietnam','viet nam':'vietnam',
  'yemen':'yemen','zambia':'zambia','zimbabwe':'zimbabwe',
};

// Source badge appearance in geo panels
const GEO_SOURCE_STYLE = {
  meteoalarm: { bg: 'rgba(230,158,117,0.22)', color: '#e69875', label: 'MET' },
  wmo:        { bg: 'rgba(136,204,255,0.20)', color: '#88CCFF', label: 'WMO' },
  gdacs:      { bg: 'rgba(167,192,128,0.22)', color: '#a7c080', label: 'GDA' },
  nws:        { bg: 'rgba(230,126,128,0.20)', color: '#e67e80', label: 'NWS' },
  msc:        { bg: 'rgba(127,187,179,0.20)', color: '#7fbbb3', label: 'MSC' },
  bom:        { bg: 'rgba(214,153,182,0.20)', color: '#d699b6', label: 'BOM' },
  usgs:       { bg: 'rgba(167,192,128,0.20)', color: '#a7c080', label: 'USGS' },
  eonet:      { bg: 'rgba(214,153,182,0.20)', color: '#d699b6', label: 'EON'  },
  swpc:       { bg: 'rgba(127,187,179,0.20)', color: '#7fbbb3', label: 'SWX'  },
  fema:       { bg: 'rgba(219,188,127,0.20)', color: '#dbbc7f', label: 'FEMA' },
};

/* ── AlertStore ─────────────────────────────────────────────────── */
const AlertStore = (() => {
  const _store     = new Map();   // countrySlug → Alert[]
  const _listeners = new Set();

  function _notify() { _listeners.forEach(fn => fn()); }

  return {
    push(sourceId, alerts) {
      // Remove stale alerts from this source across all countries
      for (const [countrySlug, list] of _store) {
        const kept = list.filter(alert => alert.source !== sourceId);
        if (kept.length === 0) _store.delete(countrySlug);
        else _store.set(countrySlug, kept);
      }
      // Drop expired alerts; for no-expiry alerts, drop if onset is older than 48 hours
      const now       = Date.now();
      const MAX_AGE   = 48 * 60 * 60 * 1000;
      const active = alerts.filter(alert => {
        if (alert.expires) return new Date(alert.expires).getTime() > now;
        if (alert.onset)   return now - new Date(alert.onset).getTime() < MAX_AGE;
        return true;
      });
      // Insert new alerts
      for (const alert of active) {
        const key = alert.country || 'unknown';
        if (!_store.has(key)) _store.set(key, []);
        _store.get(key).push(alert);
      }
      // Sort each country's alerts by severity desc
      for (const list of _store.values()) {
        list.sort((alertA, alertB) => (alertB._sevRank ?? 0) - (alertA._sevRank ?? 0));
      }
      _notify();
    },

    countries()             { return [..._store.keys()]; },
    getCountry(countrySlug) { return _store.get(countrySlug) || []; },

    // Returns { subRegion: { countrySlug: Alert[] } } filtered to given panel groups
    getForGroups(groups) {
      const out = {};
      for (const [country, alerts] of _store) {
        if (!alerts.length) continue;
        const sub   = GEO_COUNTRY_REGION[country] || 'Global';
        const group = GEO_REGION_GROUP[sub]        || 'Global';
        if (!groups.includes(group)) continue;
        if (!out[sub]) out[sub] = {};
        out[sub][country] = alerts;
      }
      return out;
    },

    subscribe(fn) {
      _listeners.add(fn);
      return () => _listeners.delete(fn);
    },
  };
})();

/* ── Country name normalizer ────────────────────────────────────── */
function countryNameToSlug(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  const normalized = name.toLowerCase().trim();
  return COUNTRY_NAME_SLUG[normalized] || normalized.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/* ── Alert normalization adapters ───────────────────────────────── */
// Meteoalarm feed slugs that differ from the canonical GEO_REGIONS slugs
const METEOALARM_GEO_SLUG = {
  'republic-of-north-macedonia': 'north-macedonia',
};

function normalizeMeteoalarm(data) {
  return data.map(warning => ({
    id:       `meteoalarm-${warning.id}`,
    source:   'meteoalarm',
    country:  METEOALARM_GEO_SLUG[warning.country] || warning.country,
    title:    warning.event,
    severity: warning.severity,
    _sevRank: METEO_SEV_ORDER[warning.severity] ?? 0,
    color:    METEO_SEV_COLOR[warning.severity] || '#859289',
    areaDesc: warning.areaDesc,
    onset:    warning.onset,
    expires:  warning.expires,
    centLat:  warning.centLat,
    centLon:  warning.centLon,
    flyFn:    warning.centLat != null ? `flyToMeteo('${warning.id.replace(/'/g,"\\'")}')` : null,
  }));
}

function normalizeWMO(data) {
  const sevRank = [0, 1, 2, 3, 4];   // index = WMO sev number
  return data.map(alert => ({
    id:       `wmo-${alert.id}`,
    source:   alert.source || 'wmo',
    country:  countryNameToSlug(alert.country || ''),
    title:    alert.event || 'Weather Alert',
    severity: WMO_SEV_LABEL[alert.sev] || 'Unknown',
    _sevRank: sevRank[alert.sev] ?? 0,
    color:    WMO_SEV_COLOR[alert.sev]  || '#859289',
    areaDesc: alert.areadesc || '',
    onset:    alert.onset,
    expires:  alert.expires,
    centLat:  alert.centLat,
    centLon:  alert.centLon,
    certainty: WMO_CERTAINTY[alert.certainty] || null,
    flyFn:    alert.centLat != null ? `flyToWMO('${alert.id.replace(/'/g,"\\'")}')` : null,
  }));
}

function normalizeGDACS(data) {
  const sevRank = { Red: 3, Orange: 2 };
  /* GDACS "Green" is its lowest tier: the event is tracked, but no significant
     humanitarian impact is expected — the same semantic class as Meteoalarm's
     green "no awareness required" entries. They are kept OUT of the AlertStore,
     which feeds the country panels and the header counts. 
     They remain in full on the map, since plotGDACS() reads gdacsData
     directly rather than the store. */
  return data
    .filter(event => event.level !== 'Green')
    .map(event => ({
    id:       `gdacs-${event.guid}`,
    source:   'gdacs',
    country:  countryNameToSlug(event.country || ''),
    title:    `${GDACS_ICON[event.type] || '⚠️'} ${event.name || GDACS_LABEL[event.type] || event.type}`,
    severity: event.level || 'Unknown',
    _sevRank: sevRank[event.level] ?? 0,
    color:    GDACS_COLOR[event.level]  || '#859289',
    areaDesc: event.country || '',
    onset:    event.todate,
    expires:  null,
    centLat:  event.lat,
    centLon:  event.lon,
    flyFn:    event.lat != null ? `flyToGDACS('${event.guid.replace(/'/g,"\\'")}')` : null,
  }));
}

/* ── Per-continent ordered sub-region lists ──────────────────────── */
const GEO_GROUP_SUBREGIONS = {
  'Africa':       ['North Africa','West Africa','East Africa','Southern Africa'],
  'Americas':     ['North America','Caribbean','Central America','South America'],
  'Asia-Pacific': ['Middle East','Central Asia','South Asia','East Asia','Southeast Asia','Oceania'],
  'Europe':       ['Nordic','British Isles','Western Europe','Central Europe','Southern Europe','Eastern Europe'],
};

/* Maps group name → its sidebar header, collapsible section, and the
   container that receives the dynamic country panels */
const GEO_GROUP_DOM = {
  'Africa':       { header: 'geo-africa-header',      section: 'geo-section-africa',      panels: 'geo-africa-panels' },
  'Americas':     { header: 'geo-americas-header',    section: 'geo-section-americas',    panels: 'geo-americas-panels' },
  'Asia-Pacific': { header: 'geo-asiapacific-header', section: 'geo-section-asiapacific', panels: 'geo-asiapacific-panels' },
  'Europe':       { header: 'geo-europe-header',      section: 'geo-section-europe',      panels: 'geo-europe-panels' },
};

/* ── Build a single country panel element ────────────────────────── */
// options.label overrides the slug-derived title; options.showSources = false
// drops the source tags (US state panels are all NWS, so they add nothing)
function buildCountryPanel(country, alerts, { label, showSources = true } = {}) {
  label ??= country.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  const topAlert = alerts[0];

  // Unique sources for header badges
  const uniqSources = showSources ? [...new Set(alerts.map(alert => alert.source))] : [];
  const sourceTags  = uniqSources.map(sourceId => {
    const style = GEO_SOURCE_STYLE[sourceId] || { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)', label: sourceId.slice(0,3).toUpperCase() };
    return `<span class="geo-source-tag" style="background:${style.bg};color:${style.color}">${style.label}</span>`;
  }).join('');

  // Alert item rows
  let alertsHtml = '';
  for (const alert of alerts) {
    const sourceStyle = GEO_SOURCE_STYLE[alert.source] || { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)', label: alert.source.toUpperCase().slice(0,3) };
    alertsHtml += `<div class="alert-item${alert.flyFn ? ' clickable' : ''}" style="border-left-color:${alert.color}"
                       ${alert.flyFn ? `onclick="${esc(alert.flyFn)}" title="Click to locate on map"` : ''}>
      <div class="alert-row">
        <span class="alert-badge" style="background:${alert.color};color:var(--badge-text)">${esc(alert.severity)}</span>
        <span class="alert-event">${esc(alert.title)}</span>
        ${showSources ? `<span class="geo-source-tag" style="background:${sourceStyle.bg};color:${sourceStyle.color}">${sourceStyle.label}</span>` : ''}
      </div>
      ${alert.areaDesc ? `<div class="alert-sub">${esc(alert.areaDesc)}</div>` : ''}
      ${alert.certainty && alert.certainty !== 'Observed'
        ? `<div class="alert-sub" style="opacity:.7">${esc(alert.certainty)} — forecast, not observed</div>` : ''}
      <div class="alert-meta">
        ${alert.onset   ? `<span>${fmtTime(alert.onset)}</span>`        : ''}
        ${alert.expires ? `<span>Exp: ${fmtTime(alert.expires)}</span>` : ''}
      </div>
    </div>`;
  }

  const panel = document.createElement('div');
  panel.className = 'panel geo-country-panel';
  panel.dataset.country = country;
  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">
        ${esc(label)}
        <span class="badge" style="background:${topAlert.color};color:var(--badge-text)">${alerts.length}</span>
      </div>
      <div class="panel-controls">${sourceTags}</div>
    </div>
    <div class="panel-body">${alertsHtml}</div>`;
  return panel;
}

/* ── Render all continent country-panel sections ─────────────────── */
/* Persist sub-region collapsed state across re-renders */
const _collapsedSubregions = new Set();

function toggleSubregion(srId, labelEl) {
  const section = document.getElementById(srId);
  if (!section) return;
  const collapsed = section.classList.toggle('collapsed');
  labelEl.classList.toggle('collapsed', collapsed);
  if (collapsed) _collapsedSubregions.add(srId);
  else            _collapsedSubregions.delete(srId);
}

function renderCountryPanels() {
  for (const [group, dom] of Object.entries(GEO_GROUP_DOM)) {
    const container = document.getElementById(dom.panels);
    if (!container) continue;

    const subRegions = GEO_GROUP_SUBREGIONS[group];
    const byRegion   = AlertStore.getForGroups([group]);

    // Clear existing dynamic content
    container.innerHTML = '';

    let hasAny = false;

    for (const region of subRegions) {
      const countries = byRegion[region];
      if (!countries) continue;

      // Sort countries within region: highest top-severity first
      const sorted = Object.entries(countries).sort(([, alertsA], [, alertsB]) =>
        Math.max(...alertsB.map(alert => alert._sevRank)) - Math.max(...alertsA.map(alert => alert._sevRank))
      );
      if (!sorted.length) continue;

      hasAny = true;

      // Stable ID for this sub-region section
      const srId = `geo-sr-${group.toLowerCase().replace(/[^a-z]/g,'-')}-${region.toLowerCase().replace(/\s+/g,'-')}`;

      // Sub-region label (collapsible button)
      const lbl = document.createElement('div');
      lbl.className = 'geo-subregion-label' + (_collapsedSubregions.has(srId) ? ' collapsed' : '');
      lbl.innerHTML = `${esc(region)}<span class="geo-sr-chevron">▾</span>`;
      lbl.onclick = () => toggleSubregion(srId, lbl);
      container.appendChild(lbl);

      // Sub-region section wrapper (display:contents, collapsible)
      const srSection = document.createElement('div');
      srSection.className = 'geo-section' + (_collapsedSubregions.has(srId) ? ' collapsed' : '');
      srSection.id = srId;
      container.appendChild(srSection);

      for (const [country, alerts] of sorted) {
        srSection.appendChild(buildCountryPanel(country, alerts));
      }
    }

    // Hide the group header when its section has nothing to show: no dynamic
    // country panels and no static panels of its own (Africa and Europe are
    // dynamic-only; Americas and Asia-Pacific always carry static panels).
    const section   = document.getElementById(dom.section);
    const hasStatic = !!section?.querySelector(':scope > .panel');
    const header    = document.getElementById(dom.header);
    if (header) header.style.display = (hasAny || hasStatic) ? '' : 'none';
  }
}

/* ── Subscribe country panels + summary/rail to AlertStore ───────── */
AlertStore.subscribe(() => {
  renderCountryPanels();
  buildGlobalSummary();

  buildAlertBar();
});

/* ══════════════════════════════════════════════════════
   GLOBAL SUMMARY COUNTS — header bar
══════════════════════════════════════════════════════ */

function buildGlobalSummary() {
  let extreme = 0, severe = 0, moderate = 0;
  const srcCounts = { nws:0, meteoalarm:0, wmo:0, gdacs:0, msc:0, bom:0 };

  // AlertStore sources (meteoalarm, wmo, gdacs, bom)
  for (const country of AlertStore.countries()) {
    for (const alert of AlertStore.getCountry(country)) {
      if (alert._sevRank >= 3) extreme++;
      else if (alert._sevRank >= 2) severe++;
      else if (alert._sevRank >= 1) moderate++;
      if (srcCounts.hasOwnProperty(alert.source)) srcCounts[alert.source]++;
    }
  }

  // NWS (not yet in AlertStore)
  for (const alert of easData) {
    const sev = (alert.properties || alert).severity;
    if      (sev === 'Extreme')  { extreme++;  srcCounts.nws++; }
    else if (sev === 'Severe')   { severe++;   srcCounts.nws++; }
    else if (sev === 'Moderate') { moderate++; srcCounts.nws++; }
  }

  // MSC (not in AlertStore — use mscSeverity to classify)
  for (const feature of mscData) {
    const label = mscSeverity(feature.properties?.alert_type).label;
    srcCounts.msc++;
    if      (label === 'Warning') severe++;
    else if (label === 'Watch')   severe++;
    else if (label === 'Advisory') moderate++;
  }

  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || '—'; };
  set('sc-extreme-count',  extreme  || '—');
  set('sc-severe-count',   severe   || '—');
  set('sc-moderate-count', moderate || '—');
  for (const [src, count] of Object.entries(srcCounts)) {
    set(`sc-src-${src}`, count || '—');
  }
}

/* ══════════════════════════════════════════════════════
   ALERT DETAIL BAR — 5-panel story scroller across all sources
══════════════════════════════════════════════════════ */

let adbAlerts    = [];
let adbActiveIdx = 0;      // index into adbAlerts of the alert being scrolled
let _adbWindowStart = 0;   // index of the first alert occupying a panel slot

/* The breakpoints hide trailing panels with CSS (5 → 3 → 2), but the rotation
   is driven by JS. Without a window the detail bar would narrate alerts whose
   panel is off-screen, with no panel highlighted at all. So the panels show a
   sliding window over adbAlerts, and it slides once the last visible alert has
   finished scrolling. Measured from the DOM so it always matches the CSS. */
function _adbVisibleCount() {
  const panels = [...document.querySelectorAll('.adb-panel')];
  if (!panels.length) return Math.min(5, adbAlerts.length || 5);
  const shown = panels.filter(p => getComputedStyle(p).display !== 'none').length;
  return Math.max(1, Math.min(shown || 5, adbAlerts.length || 1));
}

/* Advance to the next alert, sliding the window when we reach its end.
   The window slides by the number of visible slots, clamped so the last
   window still ends on the final alert — so with 5 alerts and 2 slots it
   slides 2, then 1. Every alert is shown exactly once per cycle, and when
   all 5 are visible (desktop) maxStart is 0, so nothing slides at all. */
function _adbAdvance() {
  const total = adbAlerts.length;
  if (!total) return;
  const visible   = _adbVisibleCount();
  const maxStart  = Math.max(0, total - visible);
  const windowEnd = Math.min(_adbWindowStart + visible - 1, total - 1);

  if (adbActiveIdx < windowEnd) { adbActiveIdx++; return; }

  if (_adbWindowStart >= maxStart) {
    _adbWindowStart = 0;                                   // wrap to the start
    adbActiveIdx    = 0;
  } else {
    _adbWindowStart = Math.min(_adbWindowStart + visible, maxStart);
    // skip any alert the previous window already showed
    adbActiveIdx    = Math.min(Math.max(_adbWindowStart, adbActiveIdx + 1), total - 1);
  }
}

// ── Colour + label helpers ──────────────────────────
function adbColorForItem(item) {
  if (item._color) return item._color;
  if (item.src === 'usgs') return '#a7c080';
  if (item.src === 'swpc') return '#7fbbb3';
  if (item.src === 'eonet') {
    const EONET_COLORS = {
      wildfires:'#e69875', volcanoes:'#d699b6', severeStorms:'#7fbbb3',
      seaLakeIce:'#83c092', snow:'#d3c6aa', dustHaze:'#859289',
      floods:'#5fa8e8', drought:'#dbbc7f', manmade:'#e67e80'
    };
    return EONET_COLORS[item._catId] || '#d699b6';
  }
  if (item.src === 'fema')  return '#dbbc7f';
  // NWS — colour by event type
  const eventName = (item._event || '').toLowerCase();
  if (eventName.includes('tornado'))                                 return '#ff5555';
  if (eventName.includes('flash flood'))                             return '#4db8c8';
  if (eventName.includes('flood'))                                   return '#5fa8e8';
  if (eventName.includes('thunderstorm'))                            return '#f0c040';
  if (eventName.includes('fire'))                                    return '#f08040';
  if (eventName.includes('blizzard') || eventName.includes('snow'))  return '#a8d8f8';
  if (eventName.includes('ice') || eventName.includes('winter'))     return '#b8e8ff';
  if (eventName.includes('wind'))                                    return '#90d080';
  if (eventName.includes('heat'))                                    return '#ff9060';
  return '#e67e80';
}

// ── Aggregate the 5 most-recent items across all sources ──
function adbGatherItems() {
  // NB: no hard character truncation on `tag` or `short`. The panel rows are
  // full-width with CSS `text-overflow: ellipsis`, which clips at the actual
  // pixel boundary and shows a "…". Slicing here instead chopped mid-word with no ellipsis
  const candidates = [];

  // USGS earthquakes
  for (const quake of eqData) {
    const props = quake.properties;
    const time  = props.time || 0;
    const mag   = props.mag != null ? props.mag.toFixed(1) : '?';
    const depth = quake.geometry?.coordinates?.[2];
    const issueTime = fmtTime(new Date(time).toISOString());
    const parts = [];
    if (props.place)   parts.push(props.place);
    if (depth != null) parts.push(`Depth: ${depth.toFixed(0)} km`);
    if (props.alert)   parts.push(`USGS alert level: ${props.alert.toUpperCase()}`);
    parts.push(`Magnitude: ${mag}`);
    if (props.url)     parts.push(props.url.replace(/^https?:\/\//, ''));
    candidates.push({
      src: 'usgs', ts: time,
      tag: `M${mag} EQ`, issueTime,
      short: props.place || 'Unknown location',
      detail: parts.join('   ·   '),
      _event: `M${mag} Earthquake`,
      flyId: quake.id
    });
  }

  // NWS alerts — all active, no filter
  for (const alert of easData) {
    const props   = alert.properties || alert;
    const time    = new Date(props.sent || props.effective || 0).getTime();
    const sent    = props.sent || props.effective;
    const expires = props.expires || props.ends;
    const issueTime = sent ? fmtTime(sent) : '—';
    const parts = [];
    if (props.areaDesc)    parts.push(props.areaDesc.trim());
    if (props.headline)    parts.push(props.headline.replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ').trim());
    if (props.description) parts.push(props.description.replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ').trim());
    if (props.instruction) parts.push('⚠ INSTRUCTIONS: ' + props.instruction.replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ').trim());
    // issue time is in the label; only include expiry in scroll
    if (expires) parts.push(`Expires: ${fmtTime(expires)}`);
    candidates.push({
      src: 'nws', ts: time || Date.now(),
      tag: props.event || 'ALERT', issueTime,
      short: (props.areaDesc || '').split(';')[0].trim() || '—',
      detail: parts.join('   ·   '),
      _event: props.event || '',
      flyId: alert.id
    });
  }

  // EONET natural events — last 2 days only
  const eonetCutoff = Date.now() - 2 * 24 * 3_600_000;
  for (const event of eonetData) {
    const geo    = event.geometry?.[event.geometry.length - 1];
    const time   = geo?.date ? new Date(geo.date).getTime() : 0;
    if (!time || time < eonetCutoff) continue;
    const catId  = event.categories?.[0]?.id || 'manmade';
    const catLbl = event.categories?.[0]?.title || 'Event';
    const issueTime = geo?.date ? fmtTime(geo.date) : '—';
    const parts = [];
    parts.push(eonetTitle(event));
    parts.push(`Category: ${catLbl}`);
    if (geo?.magnitudeValue != null) parts.push(`Size: ${geo.magnitudeValue.toLocaleString()} ${geo.magnitudeUnit || ''}`);
    if (event.sources?.[0]?.id) parts.push(`Source: ${event.sources[0].id}`);
    if (event.link) parts.push(`Info: ${event.link}`);
    // updated time is in the issueTime label
    candidates.push({
      src: 'eonet', ts: time,
      tag: catLbl.toUpperCase(), issueTime,
      short: eonetTitle(event),
      detail: parts.join('   ·   '),
      _catId: catId,
      flyId: event.id
    });
  }

  // SWPC space weather
  for (const alert of swAlerts) {
    const time      = swpcUTC(alert.issue_datetime);
    const issueTime = alert.issue_datetime ? fmtTime(new Date(time).toISOString()) : '—';
    const msg       = (alert.message || '').replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ').trim();
    const title     = parseProductTitle ? parseProductTitle(alert.message || '') : 'Space Weather';
    // issue time in label; message is the detail
    // Tag carries the hazard class, location row carries the product title.
    candidates.push({
      src: 'swpc', ts: time,
      tag: parseSWCategory(alert.message || '').label.toUpperCase(), issueTime,
      short: title,
      detail: msg,
      _event: title
    });
  }

  // FEMA declarations
  for (const decl of femaData) {
    const time      = decl.declarationDate ? new Date(decl.declarationDate).getTime() : 0;
    const typeLabel = FEMA_TYPE_LABELS[decl.declarationType] || decl.declarationType;
    const declId    = decl.femaDeclarationString || `DR-${decl.disasterNumber}`;
    const issueTime = decl.declarationDate ? fmtTime(decl.declarationDate) : '—';
    const parts     = [];
    parts.push(decl.declarationTitle || decl.incidentType || 'Declaration');
    parts.push(`${typeLabel} declared for ${decl.state || decl.stateCode || 'Unknown'}`);
    parts.push(`Incident type: ${decl.incidentType || '—'}`);
    parts.push(`Declaration ID: ${declId}`);
    if (decl.disasterNumber) parts.push(`FEMA.gov/disaster/${decl.disasterNumber}`);
    // declared date is in the issueTime label
    candidates.push({
      src: 'fema', ts: time,
      tag: typeLabel.toUpperCase(), issueTime,
      short: `${decl.state || '—'} · ${decl.incidentType || '—'}`,
      detail: parts.join('   ·   '),
      _event: typeLabel
    });
  }

  // AlertStore — severe+ alerts that are currently active (onset in the past)
  const _now = Date.now();
  for (const country of AlertStore.countries()) {
    for (const alert of AlertStore.getCountry(country)) {
      if (alert._sevRank < 2) continue;
      const srcStyle    = GEO_SOURCE_STYLE[alert.source] || {};
      const countryLbl  = (alert.country||'').replace(/-/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());
      const onsetTs     = alert.onset ? new Date(alert.onset).getTime() : 0;
      if (onsetTs > _now) continue;  // skip advance warnings not yet in effect
      candidates.push({
        src:       alert.source,
        ts:        onsetTs,
        tag:       `${(srcStyle.label||alert.source.slice(0,4).toUpperCase())} · ${alert.severity.toUpperCase()}`,
        issueTime: alert.onset ? fmtTime(alert.onset) : '—',
        short:     `${countryLbl}${alert.areaDesc ? ' — ' + alert.areaDesc : ''}`,
        detail:    [alert.title, countryLbl, alert.areaDesc, alert.expires ? `Exp: ${fmtTime(alert.expires)}` : ''].filter(Boolean).join('   ·   '),
        _event:    alert.title,
        _color:    alert.color,
        flyId:     null,
      });
    }
  }

  // Sort newest-first, take top 5
  candidates.sort((itemA, itemB) => itemB.ts - itemA.ts);
  return candidates.slice(0, 5);
}

let _adbDebounce = null;

function buildAlertBar() {
  // Debounce: rapid calls from the render functions collapse into one build,
  // so only a single rAF(_adbAnimate) loop is ever started per refresh.
  clearTimeout(_adbDebounce);
  _adbDebounce = setTimeout(_adbBuildNow, 80);
}

function _adbBuildNow() {
  adbAlerts = adbGatherItems();
  if (adbActiveIdx >= adbAlerts.length) adbActiveIdx = 0;
  const _maxStart = Math.max(0, adbAlerts.length - _adbVisibleCount());
  if (_adbWindowStart > _maxStart) _adbWindowStart = 0;
  if (adbActiveIdx < _adbWindowStart) _adbWindowStart = 0;

  // If a rAF loop is already running (either the measure frame or the step loop),
  // leave it alone and just silently refresh the inactive panels.
  // This prevents periodic data refreshes (NWS 60s, EQ 120s, etc.) from
  // cancelling and restarting the animation mid-scroll.
  if (_adbRafId !== null || _adbMeasureId !== null) {
    _adbRefreshInactive();
    return;
  }

  _adbRenderAll();
  requestAnimationFrame(_adbAnimate);
}

// Three stacked rows: event tag, location, timestamp. Each spans the panel's
// full width, so a long event name cannot crowd out the location beside it.
function adbPanelMarkup(item) {
  return `
    <span class="adb-tag" style="color:${adbColorForItem(item)}">${esc(item.tag)}</span>
    <span class="adb-short">${esc(item.short)}</span>
    <span class="adb-issue-time">${esc(item.issueTime || '—')}</span>`;
}

// Update only the inactive panels — never touches the active one or its animation
function _adbRefreshInactive() {
  for (let slot = 0; slot < 5; slot++) {
    const alertIdx = _adbWindowStart + slot;
    if (alertIdx === adbActiveIdx) continue;
    const panel = document.getElementById(`adb-panel-${slot}`);
    if (!panel) continue;
    const item    = adbAlerts[alertIdx];
    const flyable = !!(item?.flyId);
    panel.className = 'adb-panel' + (flyable ? ' flyable' : '');
    if (flyable) { panel.dataset.flySrc = item.src; panel.dataset.flyId = item.flyId; }
    else         { delete panel.dataset.flySrc; delete panel.dataset.flyId; }
    if (item) {
      panel.innerHTML = adbPanelMarkup(item);
    } else {
      panel.innerHTML = `<span class="adb-empty">—</span>`;
    }
  }
}

// Always do a full ordered rebuild — no partial updates, no ordering bugs
function _adbRenderAll() {
  const bar = document.getElementById('adb-panels');
  if (!bar) return;
  bar.innerHTML = '';

  if (!adbAlerts.length) {
    bar.innerHTML = `<span class="adb-empty" style="padding:0 24px;color:#2a3540;flex:1;display:flex;align-items:center">No recent events</span>`;
    return;
  }

  for (let slot = 0; slot < 5; slot++) {
    const panel    = document.createElement('div');
    panel.id       = `adb-panel-${slot}`;
    const alertIdx = _adbWindowStart + slot;      // slot → alert via the window
    const item     = adbAlerts[alertIdx];
    const isActive = (alertIdx === adbActiveIdx);
    const flyable  = !!(item?.flyId);
    panel.className = 'adb-panel' + (isActive ? ' active' : '') + (flyable ? ' flyable' : '');
    if (flyable) {
      panel.dataset.flySrc = item.src;
      panel.dataset.flyId  = item.flyId;
    }

    if (item) {
      // Both active and inactive panels show the same layout;
      // detail text lives in the separate bar below.
      panel.innerHTML = adbPanelMarkup(item);
    } else {
      panel.innerHTML = `<span class="adb-empty">—</span>`;
    }

    bar.appendChild(panel); // always in order 0→4
  }
}

// Manual rAF scroll — guaranteed constant speed, no easing curves
const ADB_SPEED  = 215; // px per second
const ADB_TAIL_GAP = 5; // px from the left edge at which the panel hands over
let _adbRafId    = null; // handle for the active step() loop
let _adbMeasureId = null; // handle for the one-frame measurement rAF

function _adbAnimate() {
  if (!adbAlerts.length) return;

  // Cancel any in-flight loops (both measurement frame and step loop)
  if (_adbMeasureId) { cancelAnimationFrame(_adbMeasureId); _adbMeasureId = null; }
  if (_adbRafId)     { cancelAnimationFrame(_adbRafId);     _adbRafId     = null; }

  const item     = adbAlerts[adbActiveIdx];
  const detailEl = document.getElementById('adb-detail-text');
  const innerEl  = document.getElementById('adb-detail-inner');
  if (!item || !detailEl || !innerEl) return;

  detailEl.textContent = item.detail;
  detailEl.style.transform = '';

  // One measurement frame so the browser has committed the new text width
  _adbMeasureId = requestAnimationFrame(() => {
    _adbMeasureId = null;
    const barW  = innerEl.offsetWidth;
    const textW = detailEl.scrollWidth;
    // Hand over once the text's trailing edge is ADB_TAIL_GAP from the left
    // edge of the bar, so the panel change lands as the description clears
    // rather than after a beat of empty bar.
    const total = barW + textW - ADB_TAIL_GAP;
    let startTime = null;

    function step(ts) {
      if (!startTime) startTime = ts;
      const px = ((ts - startTime) / 1000) * ADB_SPEED;
      detailEl.style.transform = `translateX(${barW - px}px)`;

      if (px >= total) {
        // Finished — advance, sliding the panel window if this was the last
        // visible alert (see _adbAdvance)
        _adbRafId = null;
        _adbAdvance();
        _adbRenderAll();
        requestAnimationFrame(_adbAnimate);
      } else {
        _adbRafId = requestAnimationFrame(step);
      }
    }

    _adbRafId = requestAnimationFrame(step);
  });
}

/* ── Fly-to dispatcher (ticker + alert bar) ─────── */
function adbFlyTo(src, id) {
  if (!src || !id) return;
  if      (src === 'usgs')        flyToEq(id);
  else if (src === 'nws')         flyToAlert(id);
  else if (src === 'eonet')       flyToEonet(id);
  else if (src === 'meteoalarm')  flyToMeteo(id);
  else if (src === 'wmo')         flyToWMO(id);
  else if (src === 'bom')         flyToWMO(id);   // BOM alerts live in the WMO layer
  else if (src === 'gdacs')       flyToGDACS(id);
  else if (src === 'msc')         flyToMSC(id);
  // SWPC and FEMA have no map markers
}

// Event delegation — alert detail bar panels
document.getElementById('adb-panels').addEventListener('click', event => {
  const panel = event.target.closest('.adb-panel.flyable');
  if (panel) adbFlyTo(panel.dataset.flySrc, panel.dataset.flyId);
});

/* ══════════════════════════════════════════════════════
   BOOT + AUTO-REFRESH
══════════════════════════════════════════════════════ */

function refreshAll() {
  loadEarthquakes();
  loadAlerts();
  loadSpaceWeather();
  loadEonet();
  loadFema();
  loadDrought();
  loadLSR();
  loadSPC();
  loadFireWx();
  loadGauges();
  loadVolcanism();
  loadMSCPanel();
  loadGDACS();
  loadMeteoalarm();
  loadWMO();
  loadRainviewer();
}

// Init map first, then load all data
initMap();
requestAnimationFrame(() => map.invalidateSize());
buildAlertBar(); // render empty bar immediately
initMapSearch();
applyResponsiveSidebars();

addEventListener('resize', () => {
  clearTimeout(_respTimer);
  _respTimer = setTimeout(applyResponsiveSidebars, 250);
});

refreshAll();

// Staggered auto-refresh intervals
setInterval(loadEarthquakes,  120_000);  // USGS Earthquakes - 2 minute refresh
setInterval(loadAlerts,        60_000);  // NWS Alerts - check once per minute
setInterval(loadSpaceWeather, 1800_000);  // Space Weather - every 30 minutes
setInterval(loadEonet,        300_000);  // EONET - every 5 minutes
setInterval(loadFema,         600_000);  // FEMA declarations change slowly
setInterval(loadDrought,      600_000);  // Drought monitor updates weekly
setInterval(loadLSR,          300_000);  // SPC storm reports — 5 min refresh
setInterval(loadSPC,         1800_000);  // SPC convective outlook — updates ~every 30 min
setInterval(loadFireWx,     1800_000);  // SPC fire weather outlook — updates ~every 30 min
setInterval(loadGauges,       300_000);  // NWPS river gauges — 5 min refresh
setInterval(loadVolcanism,    600_000);  // VHP + GeoNet — 10 min (data changes slowly)
setInterval(loadMSCPanel,     300_000);  // Canada MSC alerts — 5 min refresh
setInterval(loadGDACS,        600_000);  // GDACS global disasters — 10 min refresh
setInterval(loadMeteoalarm,   600_000);  // Meteoalarm Europe — 10 min refresh
setInterval(loadWMO,          600_000);  // WMO SWIC global alerts — 10 min refresh
setInterval(loadWind,         600_000);  // Surface wind barbs — 10 min (no-ops while layer is off)
setInterval(refreshGibsDailyLayers, 3600_000);  // re-point daily GIBS layers after a UTC date rollover
setInterval(loadRainviewer,   300_000);  // RainViewer refreshes frames ~every 5 min
setInterval(() => { buildGlobalSummary(); }, 60_000);   // Re-evaluate 1-hour window every minute

// Live indicator: re-evaluate on a timer so it goes stale on its own, and
// react immediately to the browser's own connectivity events.
setInterval(refreshLiveIndicator, 30_000);
addEventListener('online',  refreshLiveIndicator);
addEventListener('offline', refreshLiveIndicator);
refreshLiveIndicator();

// Re-sample wind whenever the view settles somewhere new (debounced so a drag
// or a pinch-zoom fires one request, not one per animation frame)
map.on('moveend', () => {
  if (!document.getElementById('toggle-wind')?.checked) return;
  clearTimeout(_windDebounce);
  _windDebounce = setTimeout(loadWind, 600);
});
