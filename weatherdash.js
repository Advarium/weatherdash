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

/* ══════════════════════════════════════════════════════
   MAP SYMBOLOGY — shared rules so overlays stay readable together
   • Alert layers (NWS, WMO, Meteoalarm, Canada) share one severity colour
     scale; the line style carries the product type (warning solid, watch
     dashed, advisory and statement dotted).
   • Area layers are "cased": a wider dark line sits under the coloured one,
     so the edge reads over radar, satellite and other rasters.
   • While a colour-field raster is on (radar, SST, soil moisture…), area
     fills switch off through a class on the map container, leaving only the
     cased outlines. Nothing is replotted.
══════════════════════════════════════════════════════ */

const MAP_CASING = '#141a1d';
const ALERT_DASH = { warning: null, watch: '9 6', advisory: '2 5', statement: '1 6' };

// Product type from an alert's event name ("Flood Warning", "Winter Storm Watch"…)
function alertProductType(eventName = '') {
  const name = eventName.toLowerCase();
  if (name.includes('warning'))   return 'warning';
  if (name.includes('watch'))     return 'watch';
  if (name.includes('advisory'))  return 'advisory';
  return 'statement';
}

/* L.geoJSON drawn twice inside one feature group: a non-interactive dark
   casing, then the styled layer. Styles may set `casing` (edge colour) and
   `className` (e.g. 'spc-fill'); every styled path also gets 'area-fill',
   unless the style sets `field: true` (a vector layer that is itself a colour
   field, like drought, and keeps its fill). */
function casedGeoJSON(data, options) {
  const styleOf = typeof options.style === 'function' ? options.style : () => options.style;
  const group = L.featureGroup();
  L.geoJSON(data, {
    interactive: false,
    style: feature => {
      const style = styleOf(feature);
      return {
        color: style.casing || MAP_CASING, weight: (style.weight || 1.5) + 2.5,
        opacity: Math.min(1, (style.opacity ?? 0.9) + 0.05), fill: false,
        dashArray: null, lineJoin: 'round', className: 'map-casing',
      };
    },
  }).addTo(group);
  L.geoJSON(data, {
    ...options,
    style: feature => {
      const style = styleOf(feature);
      return { ...style, className: `${style.field ? '' : 'area-fill'} ${style.className || ''}`.trim() };
    },
  }).addTo(group);
  return group;
}

// L.polygon version of casedGeoJSON, for layers built from lat/lng rings
function casedPolygon(latlngs, style) {
  return L.featureGroup([
    L.polygon(latlngs, { color: style.casing || MAP_CASING, weight: (style.weight || 1.5) + 2.5,
                         opacity: 0.95, fill: false, interactive: false, className: 'map-casing' }),
    L.polygon(latlngs, { ...style, className: `area-fill ${style.className || ''}`.trim() }),
  ]);
}

// Alert with no shape, only a location: a small outlined badge with "!",
// kept distinct from event circles (earthquakes) and diamonds (GDACS)
function alertBadgeIcon(color) {
  return L.divIcon({
    className: 'leaflet-marker-emoji',
    html: `<div class="alert-badge-pin" style="border-color:${color};color:${color}">!</div>`,
    iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -9],
  });
}

// Every descendant layer of a group (cased layers nest groups inside groups)
function eachLeafLayer(root, visit) {
  root.eachLayer(layer => (layer.eachLayer ? eachLeafLayer(layer, visit) : visit(layer)));
}

// Rasters that paint a continuous colour field. While any is on, area fills turn off.
// Drought is vector data but reads as a field: its nested classes turn into a
// tangle of outlines if stripped, so it takes part in the one-field rule instead.
const COLOUR_FIELDS = ['radar', 'rainviewer', 'dwd-radar', 'fmi-radar', 'imerg', 'sst', 'seaice', 'grace', 'smap-root', 'smap-surf', 'ozone', 'drought', 'airmass', 'geocolor'];

/* Infrared satellites have two styles. "Clouds only" (recoloured, clear ground
   transparent) sits under anything. "Enhanced" is NASA's/EUMETSAT's original
   colour table: more detail in cold cloud tops, but a full colour field, so it
   follows the one-field rule. The four satellites cover different regions and
   can always be on together. */
const IR_KEYS = ['goesw', 'goese', 'himawari', 'meteosat'];
let irStyle = 'clouds';
const isColourField = key => COLOUR_FIELDS.includes(key) || (irStyle === 'enhanced' && IR_KEYS.includes(key));
const fieldKeys = () => [...COLOUR_FIELDS, ...(irStyle === 'enhanced' ? IR_KEYS : [])];

/* One colour field at a time: two filled colour ramps on top of each other
   can't be read. Layers in the same set here can share the map because they
   don't overlap or were designed to stack (regional radars; ice over SST). */
const FIELD_COMPATIBLE = [['radar', 'dwd-radar', 'fmi-radar'], ['sst', 'seaice'], IR_KEYS];
const LAYER_NAMES = key => document.querySelector(`#toggle-${key} ~ .layer-name`)?.textContent || key;

function enforceSingleField(turnedOn, label = LAYER_NAMES(turnedOn)) {
  if (!isColourField(turnedOn)) return;
  const allowed = FIELD_COMPATIBLE.find(set => set.includes(turnedOn)) || [turnedOn];
  const replaced = fieldKeys().filter(key => !allowed.includes(key) && document.getElementById(`toggle-${key}`)?.checked);
  for (const key of replaced) {
    document.getElementById(`toggle-${key}`).checked = false;
    toggleLayer(key);
  }
  if (replaced.length) {
    showMapToast(`Showing ${label}. Turned off ${replaced.map(LAYER_NAMES).join(', ')}: one colour layer shows at a time.`);
  }
}

let _toastTimer;
function showMapToast(text) {
  if (!map) return;
  let toast = document.getElementById('map-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'map-toast';
    toast.className = 'map-toast';
    toast.setAttribute('role', 'status');
    map.getContainer().appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

/* ── Scenes: tested layer combinations for common tasks ────────────
   Each was checked on the map for readability. A scene only sets layers;
   it doesn't move the map. Changing any layer afterwards makes it "custom". */
const SCENES = {
  severe:   ['eas', 'radar', 'spc-d1', 'lsr', 'wind'],
  tropical: ['hur', 'hurprob', 'goesw', 'goese', 'himawari', 'wind'],
  winter:   ['eas', 'rainviewer', 'wind'],
  fire:     ['fwx-d1', 'drought', 'eonet', 'wind'],
  flood:    ['eas', 'gauge', 'radar'],
  geo:      ['eq', 'volc', 'gdacs', 'eonet', 'so2'],
  ocean:    ['sst', 'seaice', 'hur', 'wind'],
  europe:   ['meteoalarm', 'dwd-radar', 'fmi-radar', 'wind'],
};
let _applyingScene = false;

function applyScene(name) {
  const keys = name ? SCENES[name] : [];
  _applyingScene = true;
  document.querySelectorAll('input[id^="toggle-"]').forEach(checkbox => {
    const key = checkbox.id.slice('toggle-'.length);
    const want = keys.includes(key);
    if (checkbox.checked !== want) { checkbox.checked = want; toggleLayer(key); }
  });
  _applyingScene = false;
  markScene(name);
}

function markScene(name) {
  document.querySelectorAll('.scene-btn[data-scene]').forEach(button => {
    const on = button.dataset.scene === name;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
}

// The IR layer to show for a satellite in the current style
function irLayerFor(key, style = irStyle) {
  const layers = {
    goesw:    [goesWLayer, goesWEnhLayer],   goese:    [goesELayer, goesEEnhLayer],
    himawari: [himawariLayer, himawariEnhLayer], meteosat: [meteosatLayer, meteosatEnhLayer],
  }[key];
  return layers?.[style === 'enhanced' ? 1 : 0];
}

function setIrStyle(style) {
  irStyle = style;
  const select = document.getElementById('ir-style');
  if (select && select.value !== style) select.value = style;
  // Swap every visible satellite to the chosen style
  const visible = IR_KEYS.filter(key => document.getElementById(`toggle-${key}`)?.checked);
  for (const key of IR_KEYS) {
    for (const variant of ['clouds', 'enhanced']) {
      const layer = irLayerFor(key, variant);
      if (layer && map.hasLayer(layer) && (variant !== style || !visible.includes(key))) map.removeLayer(layer);
    }
    if (visible.includes(key)) map.addLayer(irLayerFor(key));
  }
  // Enhanced colours are a colour field: make room for them
  if (style === 'enhanced' && visible.length) enforceSingleField(visible[0], 'enhanced infrared');
  updateFieldState();
}

function updateFieldState() {
  if (!map) return;
  const on = key => document.getElementById(`toggle-${key}`)?.checked;
  const container = map.getContainer();
  container.classList.toggle('fields-on', fieldKeys().some(on));
  // Several outlook days at once: outlines only, told apart by line style
  container.classList.toggle('spc-multi', ['spc-d1', 'spc-d2', 'spc-d3'].filter(on).length > 1);
  container.classList.toggle('fwx-multi', ['fwx-d1', 'fwx-d2'].filter(on).length > 1);
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

let map, baseDark, baseSat, baseDarkLabels, baseSatLabels, goesWEnhLayer, goesEEnhLayer, himawariEnhLayer, meteosatEnhLayer, airmassLayer, geocolorLayer, eqLayer, easLayer, eonetLayer, droughtLayer, lsrLayer, gaugeLayer, volcLayer, gdacsLayer, meteoalarmLayer, wmoLayer, spcD1Layer, spcD2Layer, spcD3Layer, fwxD1Layer, fwxD2Layer, mscLayer, radarLayer, rainviewerLayer, imergLayer, goesWLayer, goesELayer, meteosatLayer, himawariLayer, graceLayer, smapRootLayer, smapSurfLayer, dwdRadarLayer, fmiRadarLayer, sstLayer, seaIceLayer, windLayer, ozoneLayer, so2Layer;

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

/* ══════════════════════════════════════════════════════
   RASTER RECOLOUR — repaint GIBS WMTS tiles with our own palettes
   ──────────────────────────────────────────────────────
   GIBS tiles are CORS-open (Access-Control-Allow-Origin: *), so each tile is
   drawn to a canvas, every pixel is mapped back to its data value through the
   product's GIBS colormap (RASTER_LUTS), and repainted from RASTER_PALETTES.
   Rasters are meant to be quiet "ground": no yellow/orange/red/magenta in the
   continuous fields, so the warm-coloured vector symbols stay readable.

   Pieces:
     RASTER_LUTS      colour → value tables, generated by build_luts.py
     RASTER_PALETTES  value → RGBA stops + legend (css gradient + labels)
     L.GridLayer.Recolor / recolorLayer(opts)
                      the layer. Options: url, nativeMaxZoom, lut, palette,
                      zIndex, opacity, attribution, maxZoom, plus optional
                      tolerance, greyAmbiguity, pixelated, cacheSize.
     rasterLegendHTML(key)  legend markup for index.html
   Plain script, no imports; needs Leaflet (global L) only when the layer
   class is defined, so the tables load fine without it.
══════════════════════════════════════════════════════ */

// BEGIN RASTER_LUTS (generated by build_luts.py — do not edit by hand)
const RASTER_LUTS = {
  // OMI_SO2_Lower_Troposphere (202 classes). Used only to validate tiles (SO2 keeps its own colours).
  so2: { units: 'DU', rgb: '082864083573083675083877083979083b7b083c7d083d7f083e8108408308418508428708438908458b08468d08488f084991084b93084c94084d96084e9808509a08519b09529c0a539d0b559f0c56a00d57a10e58a20f5aa3105ba4115ca5125da6135fa71460a81561a91662aa1764ab1865ac1966ad1a67ae1b69af1c6ab01d6bb11e6cb21f6eb3206fb32170b42271b52373b62474b62575b72676b82878b92979b92a7aba2b7bba2d7dbb2e7ebb3080bc3181bd3383be3484be3585bf3686c03888c13989c13a8ac23b8bc23d8dc33e8ec33f8fc44090c54292c64393c64594c74695c84896c94997c94b98ca4d99ca4f9bcb509ccb529dcc539ecd559fce56a0ce58a1cf5aa2cf5ca4d05da5d05fa6d160a7d262a8d363a9d365aad466abd468acd56aadd56caed66eafd670b1d772b2d774b3d876b4d878b5d97ab6d97cb7d97eb8d980b9da82bada84bbdb86bcdb88bedc8abfdc8cc0dd8ec1dd90c2de92c3de94c4df96c5df98c7e099c8e09bc9e09dcae09fcbe1a0cbe1a2cce2a4cce3a6cde4a7cde4a9cee5aacfe5acd0e6add0e6afd1e7b0d2e7b2d3e8b3d3e8b5d4e9b6d4e9b8d5eab9d5eabbd6ebbdd7ebbfd8ecc0d8ecc2d9edc3d9eec5daefc6daefc7dbefc8dcefc9ddf0caddf0cbdef0ccdff0cde0f1cee0f1cfe1f2d0e1f2d1e2f3d1e2f3d2e3f3d3e4f3d4e5f4d5e5f4d6e6f4d7e6f4d8e7f5d9e7f5dae8f5dbe9f5dceaf6ddeaf6deebf7dfebf7e0ecf8e1ecf8e2edf8e3eef8e4eff9e5eff9e6f0f9e7f0f9e8f1fae9f1faeaf2faebf3faecf4fbedf4fbeef5fceff5fcf0f6fdf1f6fdf2f7fdf3f8fdf4f9fef4f9fef5fafef6fafef7fbff',
    val: [2.0,2.075,2.225,2.375,2.525,2.675,2.825,2.975,3.125,3.275,3.425,3.575,3.725,3.875,4.025,4.175,4.325,4.475,4.625,4.775,4.925,5.075,5.225,5.375,5.525,5.675,5.825,5.975,6.125,6.275,6.425,6.575,6.725,6.875,7.025,7.175,7.325,7.475,7.625,7.775,7.925,8.075,8.225,8.375,8.525,8.675,8.825,8.975,9.125,9.275,9.425,9.575,9.725,9.875,10.025,10.175,10.325,10.475,10.625,10.775,10.925,11.075,11.225,11.375,11.525,11.675,11.825,11.975,12.125,12.275,12.425,12.575,12.725,12.875,13.025,13.175,13.325,13.475,13.625,13.775,13.925,14.075,14.225,14.375,14.525,14.675,14.825,14.975,15.125,15.275,15.425,15.575,15.725,15.875,16.025,16.175,16.325,16.475,16.625,16.775,16.925,17.075,17.225,17.375,17.525,17.675,17.825,17.975,18.125,18.275,18.425,18.575,18.725,18.875,19.025,19.175,19.325,19.475,19.625,19.775,19.925,20.075,20.225,20.375,20.525,20.675,20.825,20.975,21.125,21.275,21.425,21.575,21.725,21.875,22.025,22.175,22.325,22.475,22.625,22.775,22.925,23.075,23.225,23.375,23.525,23.675,23.825,23.975,24.125,24.275,24.425,24.575,24.725,24.875,25.025,25.175,25.325,25.475,25.625,25.775,25.925,26.075,26.225,26.375,26.525,26.675,26.825,26.975,27.125,27.275,27.425,27.575,27.725,27.875,28.025,28.175,28.325,28.475,28.625,28.775,28.925,29.075,29.225,29.375,29.525,29.675,29.825,29.975,30.125,30.275,30.425,30.575,30.725,30.875,31.025,31.175,31.325,31.475,31.625,31.775,31.925,32.0] },
  // GHRSST_L4_MUR_Sea_Surface_Temperature (215 classes)
  sst: { units: '°C', rgb: '2b001a2d001c30001f3300223500243800273b002b3f012e4201324501354801394b023d4e024151024555024958024d5b03515f035562035965035d6904616c046670056a73056e7606717806737906757a06777906777807777507757207746f07726b087067086e62086c5e08695a09675609655109634d0961490a5e450a5c410a5a3d0a58390a56350b54300b512c0b4f280b4d250c4c220d4b200e4b1e104d1e124e1e14511e16541e18571e1a5a1f1c5d1e1e601e21631f23661f25691f276c1f2a701f2c731f2e761f30791f327c1f357f1f3782203985203b88203d8b20408e20429120449420469721499b214b9e214ea12151a42254a72257aa235aad235db02460b32464b62567b9256abb266ebe2671c22775c52878c8287bcb297fce2982d12a85d42a88d72a8bda2b8edd2b92e02c95e32c98e62d9ce92e9fec2ea3ef2fa6f230aaf530acf42fadf02eaee82daede2badd029abbf27a8ab25a69823a48520a3711ea35d1ba54819a7351aaa251caf1720b30d26b7062dbb0137be0042c2004cc50057c90062cc006dcf0078d30083d7008eda0099de00a5e100b0e500bbe800c5ec00d0ef00dbf300e5f600edf700f3f700f8f500fcf300feef00ffea00ffe400ffdf00ffd900ffd400ffce00ffc900ffc400ffbf00ffb900ffb400ffaf00ffaa00ffa400ff9f00ff9900ff9400ff8e00ff8900ff8300fe7e00fd7a00fc7500fb7100fa6d00f86a00f66600f46200f25f00f05b00ee5700ec5300ea5000e84c00e64900e44500e24200e03e00de3b00dc3700da3300d83000d52d00d22a00ce2700ca2500c52200c02000bb1f00b51d00b01b00ab1900a61700a115009c14009712009110008c0e00870c00820a007c08007807007305006e03006b0200',
    val: [-0.075,0.075,0.225,0.375,0.525,0.675,0.825,0.975,1.125,1.275,1.425,1.575,1.725,1.875,2.025,2.175,2.325,2.475,2.625,2.775,2.925,3.075,3.225,3.375,3.525,3.675,3.825,3.975,4.125,4.275,4.425,4.575,4.725,4.875,5.025,5.175,5.325,5.475,5.625,5.775,5.925,6.075,6.225,6.375,6.525,6.675,6.825,6.975,7.125,7.275,7.425,7.575,7.725,7.875,8.025,8.175,8.325,8.475,8.625,8.775,8.925,9.075,9.225,9.375,9.525,9.675,9.825,9.975,10.125,10.275,10.425,10.575,10.725,10.875,11.025,11.175,11.325,11.475,11.625,11.775,11.925,12.075,12.225,12.375,12.525,12.675,12.825,12.975,13.125,13.275,13.425,13.575,13.725,13.875,14.025,14.175,14.325,14.475,14.625,14.775,14.925,15.075,15.225,15.375,15.525,15.675,15.825,15.975,16.125,16.275,16.425,16.575,16.725,16.875,17.025,17.175,17.325,17.475,17.625,17.775,17.925,18.075,18.225,18.375,18.525,18.675,18.825,18.975,19.125,19.275,19.425,19.575,19.725,19.875,20.025,20.175,20.325,20.475,20.625,20.775,20.925,21.075,21.225,21.375,21.525,21.675,21.825,21.975,22.125,22.275,22.425,22.575,22.725,22.875,23.025,23.175,23.325,23.475,23.625,23.775,23.925,24.075,24.225,24.375,24.525,24.675,24.825,24.975,25.125,25.275,25.425,25.575,25.725,25.875,26.025,26.175,26.325,26.475,26.625,26.775,26.925,27.075,27.225,27.375,27.525,27.675,27.825,27.975,28.125,28.275,28.425,28.575,28.725,28.875,29.025,29.175,29.325,29.475,29.625,29.775,29.925,30.075,30.225,30.375,30.525,30.675,30.825,30.975,31.125,31.275,31.425,31.575,31.725,31.9,32.075] },
  // GHRSST_L4_MUR_Sea_Ice_Concentration (101 classes)
  seaIce: { units: '%', rgb: '1111110e000e1c001c3200324000404e004e630063710071870087950095a300a3b800b8c600c6dc00dcea00eaf800f8f100ffe300ffcd00ffbf00ffb100ff9c00ff8e00ff7f00ff6a00ff5c00ff4700ff3900ff2a00ff1500ff0700ff0010ff0021ff0031ff004aff005aff0073ff0084ff0094ff00adff00bdff00ceff00e6ff00f7ff00faf100f6e300f1d400eabf00e5b100de9c00d98e00d47f00cd6a00c95c00c24700bd3900b82a00b11500ac070faf001eb4002db90044c10053c60062cb0078d20087d7009edf00ade400bce900d2f000e1f500f8fd00fff800ffea00ffd400ffc600ffb100ffa300ff9500ff7f00ff7100ff6300ff4e00ff4000ff2a00ff1c00ff0e00ff0909ff1a1aff3333ff4444ff5555ff6f6fff8080ff9999ffaaaaffbbbbffd5d5ffe6e6ffffff',
    val: [0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5,16.5,17.5,18.5,19.5,20.5,21.5,22.5,23.5,24.5,25.5,26.5,27.5,28.5,29.5,30.5,31.5,32.5,33.5,34.5,35.5,36.5,37.5,38.5,39.5,40.5,41.5,42.5,43.5,44.5,45.5,46.5,47.5,48.5,49.5,50.5,51.5,52.5,53.5,54.5,55.5,56.5,57.5,58.5,59.5,60.5,61.5,62.5,63.5,64.5,65.5,66.5,67.5,68.5,69.5,70.5,71.5,72.5,73.5,74.5,75.5,76.5,77.5,78.5,79.5,80.5,81.5,82.5,83.5,84.5,85.5,86.5,87.5,88.5,89.5,90.5,91.5,92.5,93.5,94.5,95.5,96.5,97.5,98.5,99.5,100] },
  // GOES-West_ABI_Band13_Clean_Infrared (238 classes)
  ir: { units: '°C', rgb: 'ffffff7f007f8c0d8799198ea52696b2339dbf40a5cc4cadd959b4e566bcf272c3ff7fcbe6e6e6ccccccb1b1b19b9b9b8181816666664c4c4c3636361b1b1b0505051a00003300004d0000660000800000990000b30000cc0000e60000ff0000ff1a00ff3300ff4d00ff6600ff8000ff9900ffb300ffcc00ffe600ffff00e6ff00ccff00b3ff0099ff0080ff0066ff004dff0033ff001aff0000ff0000ea0a00d41300bf1d00aa2600953000803a006a4300554d004056002a6000156900007300007d000d7a001a8100268800338f004096004c9d0059a40066ab0073b20080b9008cc00099c700a6ce00b2d500bfdc00cce300d9ea00e6f100f2f800ffffc5c5c5c4c4c4c2c2c2c1c1c1c0c0c0bfbfbfbdbdbdbcbcbcbbbbbbb9b9b9b8b8b8b7b7b7b5b5b5b4b4b4b3b3b3b2b2b2b0b0b0afafafaeaeaeacacacabababaaaaaaa9a9a9a7a7a7a6a6a6a5a5a5a3a3a3a2a2a2a1a1a19f9f9f9e9e9e9d9d9d9c9c9c9a9a9a9999999898989696969595959494949393939191919090908f8f8f8d8d8d8c8c8c8b8b8b8a8a8a8888888787878686868484848383838282828080807f7f7f7e7e7e7d7d7d7b7b7b7a7a7a7979797777777676767575757474747272727171717070706e6e6e6d6d6d6c6c6c6a6a6a6969696868686767676565656464646363636161616060605f5f5f5e5e5e5c5c5c5b5b5b5a5a5a5858585757575656565454545353535252525151514f4f4f4e4e4e4d4d4d4b4b4b4a4a4a4949494848484646464545454444444242424141414040403e3e3e3d3d3d3c3c3c3b3b3b3939393838383737373535353434343333333232323030302f2f2f2e2e2e2c2c2c2b2b2b2a2a2a2929292727272626262525252323232222222121211f1f1f1e1e1e1d1d1d1c1c1c1a1a1a1919191818181616161515151414141313131111111010100f0f0f0d0d0d0c0c0c0b0b0b090909080808070707060606040404030303020202010101',
    val: [-91.6,-90.6,-89.6,-88.6,-87.6,-86.6,-85.6,-84.6,-83.6,-82.6,-81.6,-80.6,-79.6,-78.6,-77.6,-76.6,-75.6,-74.6,-73.6,-72.6,-71.6,-70.6,-69.6,-68.6,-67.6,-66.6,-65.6,-64.6,-63.6,-62.6,-61.6,-60.6,-59.6,-58.6,-57.6,-56.6,-55.6,-54.6,-53.6,-52.6,-51.6,-50.6,-49.6,-48.6,-47.6,-46.6,-45.6,-44.6,-43.6,-42.6,-41.6,-40.6,-39.6,-38.6,-37.6,-36.6,-35.6,-34.6,-33.6,-32.6,-31.6,-30.85,-30.35,-29.85,-29.35,-28.85,-28.35,-27.85,-27.35,-26.85,-26.35,-25.85,-25.35,-24.85,-24.35,-23.85,-23.35,-22.85,-22.35,-21.85,-21.35,-20.85,-20.35,-19.85,-19.35,-18.85,-18.35,-17.85,-17.35,-16.85,-16.35,-15.85,-15.35,-14.85,-14.35,-13.85,-13.35,-12.85,-12.35,-11.85,-11.35,-10.85,-10.35,-9.85,-9.35,-8.85,-8.35,-7.85,-7.35,-6.85,-6.35,-5.85,-5.35,-4.85,-4.35,-3.85,-3.35,-2.85,-2.35,-1.85,-1.35,-0.85,-0.35,0.15,0.65,1.15,1.65,2.15,2.65,3.15,3.65,4.15,4.65,5.15,5.65,6.15,6.65,7.15,7.65,8.15,8.65,9.15,9.65,10.15,10.65,11.15,11.65,12.15,12.65,13.15,13.65,14.15,14.65,15.15,15.65,16.15,16.65,17.15,17.65,18.15,18.65,19.15,19.65,20.15,20.65,21.15,21.65,22.15,22.65,23.15,23.65,24.15,24.65,25.15,25.65,26.15,26.65,27.15,27.65,28.15,28.65,29.15,29.65,30.15,30.65,31.15,31.65,32.15,32.65,33.15,33.65,34.15,34.65,35.15,35.65,36.15,36.65,37.15,37.65,38.15,38.65,39.15,39.65,40.15,40.65,41.15,41.65,42.15,42.65,43.15,43.65,44.15,44.65,45.15,45.65,46.15,46.65,47.15,47.65,48.15,48.65,49.15,49.65,50.15,50.65,51.15,51.65,52.15,52.65,53.15,53.65,54.15,54.65,55.15,55.65,56.15,56.65,57.15] },
  // GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI (242 classes)
  grace: { units: 'cm', rgb: '0033ff0234ff0436ff0637ff0839ff0a3aff0c3cff0e3eff1040ff1341ff1543ff1745ff1a47ff1c49ff1e4aff204cff224dff244fff2651ff2852ff2a54ff2c55ff2e57ff3059ff325bff345cff375eff3960ff3b62ff3e64ff4065ff4267ff4469ff466aff486cff4a6dff4c6fff4e71ff5072ff5274ff5475ff5677ff5879ff5a7bff5d7dff5f7fff6180ff6482ff6684ff6885ff6a87ff6c89ff6e8aff708cff728dff748fff7691ff7892ff7a94ff7c96ff7f98ff8199ff849bff869dff899fff8ba1ff8da2ff8fa4ff91a5ff93a7ff95a9ff97aaff99acff9badff9dafff9fb1ffa1b3ffa3b4ffa6b6ffa8b8ffaabaffadbcffafbdffb1bfffb3c1ffb5c2ffb7c4ffb9c5ffbbc7ffbdc9ffbfcaffc1ccffc3cdffc5cfffc7d1ffc9d3ffccd5ffced7ffd0d8ffd3daffd5dcffd7ddffd9dfffdbe1ffdde2ffdfe4ffe1e5ffe3e7ffe5e9ffe7eaffe9ecffebeeffedf0fff0f1fff2f3fff4f5fff7f7fff9f9fffafafffcfbfefdfbfefefbfdfefbfcfffafafff9f9fff7f7fff5f5fff4f2fff2f0fff0eeffeeebffece9ffeae7ffe9e5ffe7e3ffe5e1ffe4dfffe2ddffe1dbffdfd9ffddd7ffdcd5ffdad3ffd9d1ffd7ceffd5ccffd3caffd1c7ffcfc5ffcec3ffccc1ffcabfffc9bdffc7bbffc5b9ffc4b7ffc2b5ffc1b3ffbfb1ffbdafffbcadffbaabffb8a8ffb7a6ffb5a4ffb3a1ffb19fffaf9dffad9bffac99ffaa97ffa995ffa793ffa591ffa48fffa28dffa18bff9f89ff9d87ff9c84ff9a82ff987fff967dff947aff9278ff9176ff8f74ff8d72ff8c70ff8a6eff896cff876aff8568ff8466ff8264ff8162ff7f5fff7d5dff7b5bff7958ff7756ff7654ff7452ff7250ff714eff6f4cff6d4aff6c48ff6a46ff6944ff6742ff6540ff643eff623cff6039ff5f37ff5d35ff5b32ff5930ff572eff552cff542aff5228ff5126ff4f24ff4d22ff4c20ff4a1eff491cff471aff4518ff4415ff4213ff4011ff3e0eff3c0cff3a0aff3908ff3706ff3604ff3402ff3300',
    val: [-30.125,-29.875,-29.625,-29.375,-29.125,-28.875,-28.625,-28.375,-28.125,-27.875,-27.625,-27.375,-27.125,-26.875,-26.625,-26.375,-26.125,-25.875,-25.625,-25.375,-25.125,-24.875,-24.625,-24.375,-24.125,-23.875,-23.625,-23.375,-23.125,-22.875,-22.625,-22.375,-22.125,-21.875,-21.625,-21.375,-21.125,-20.875,-20.625,-20.375,-20.125,-19.875,-19.625,-19.375,-19.125,-18.875,-18.625,-18.375,-18.125,-17.875,-17.625,-17.375,-17.125,-16.875,-16.625,-16.375,-16.125,-15.875,-15.625,-15.375,-15.125,-14.875,-14.625,-14.375,-14.125,-13.875,-13.625,-13.375,-13.125,-12.875,-12.625,-12.375,-12.125,-11.875,-11.625,-11.375,-11.125,-10.875,-10.625,-10.375,-10.125,-9.875,-9.625,-9.375,-9.125,-8.875,-8.625,-8.375,-8.125,-7.875,-7.625,-7.375,-7.125,-6.875,-6.625,-6.375,-6.125,-5.875,-5.625,-5.375,-5.125,-4.875,-4.625,-4.375,-4.125,-3.875,-3.625,-3.375,-3.125,-2.875,-2.625,-2.375,-2.125,-1.875,-1.625,-1.375,-1.125,-0.875,-0.625,-0.375,-0.125,0.125,0.375,0.625,0.875,1.125,1.375,1.625,1.875,2.125,2.375,2.625,2.875,3.125,3.375,3.625,3.875,4.125,4.375,4.625,4.875,5.125,5.375,5.625,5.875,6.125,6.375,6.625,6.875,7.125,7.375,7.625,7.875,8.125,8.375,8.625,8.875,9.125,9.375,9.625,9.875,10.125,10.375,10.625,10.875,11.125,11.375,11.625,11.875,12.125,12.375,12.625,12.875,13.125,13.375,13.625,13.875,14.125,14.375,14.625,14.875,15.125,15.375,15.625,15.875,16.125,16.375,16.625,16.875,17.125,17.375,17.625,17.875,18.125,18.375,18.625,18.875,19.125,19.375,19.625,19.875,20.125,20.375,20.625,20.875,21.125,21.375,21.625,21.875,22.125,22.375,22.625,22.875,23.125,23.375,23.625,23.875,24.125,24.375,24.625,24.875,25.125,25.375,25.625,25.875,26.125,26.375,26.625,26.875,27.125,27.375,27.625,27.875,28.125,28.375,28.625,28.875,29.125,29.375,29.625,29.875,30.125] },
  // SMAP_L4_Analyzed_Root_Zone_Soil_Moisture (255 classes)
  smapRoot: { units: 'm³/m³', rgb: 'ffa200ffa500ffa700ffaa00ffac00ffae00ffb100ffb300ffb500ffb800ffba00ffbd00ffbf00ffc100ffc400ffc600ffc800ffcb00ffcd00ffd000ffd200ffd400ffd700ffd900ffdb00ffde00ffe000ffe300ffe500ffe700ffea00ffec00ffee00fff100fff300fff600fff800fff900fffa00fffb00fffd00ffff00fffe00f9fc00f3f900edf600e7f300e1f000dbed00d5ea00d0e700cae400c4e100bede00b8db00b2d800acd500a6d200a0cf009acc0094c9008ec60088c30082c1007dbe0077bb0071b8006bb50065b2005faf0059ac0053a9004da60047a30041a0003b9d00359a002f97002a94002491001e8e00188b001288000c850006820000820000820600850c008813008b19008f1f00922500952c009832009b38009e3e00a14400a44b00a85100ab5700ae5d00b16400b46a00b77000ba7600bd7c00c18300c48900c78f00ca9500cd9b00d0a200d3a800d6ae00dab400ddbb00e0c100e3c700e6cd00e9d300ecda00efe000f3e600f6ec00f9f300fcf900feff00ffff00fdff00f9ff00f3ff00edff00e7ff00e1ff00dbff00d5ff00d0ff00caff00c4ff00beff00b8ff00b2ff00acff00a6ff00a0ff009aff0094ff008eff0088ff0082ff007dff0077ff0071ff006bff0065ff005fff0059ff0053ff004dff0047ff0041ff003bff0035ff002fff002aff0024ff001eff0018ff0012ff000cff0006ff0000ff0000fb0000f80000f40000f10000ed0000e90000e60000e20000df0000db0000d70000d40000d00000cd0000c90000c50000c20000be0000bb0000b70000b30000b00000ac0000a80000a50000a100009e00009a00009600009300008f00008c00008800008400008100007d00007a00007600007200006f00006b0000680000640202640404640606640808640a0a640c0c640e0e641010641212641414641616641818641a1a641c1c641e1e6420206422225a24245a26265a28285a2a2a5a2c2c5a2e2e5a30305a32325a34345a36365a38385a3a3a5a3c3c503e3e504040504242504444504646504848504a4a504c4c504e4e50505050',
    val: [0.0015,0.0045,0.007,0.0095,0.0125,0.0155,0.018,0.0205,0.0235,0.0265,0.029,0.0315,0.0345,0.0375,0.04,0.0425,0.0455,0.0485,0.051,0.0535,0.0565,0.0595,0.062,0.0645,0.0675,0.0705,0.073,0.0755,0.0785,0.0815,0.084,0.0865,0.0895,0.0925,0.095,0.0975,0.1005,0.1035,0.106,0.1085,0.1115,0.1145,0.1175,0.12,0.1225,0.1255,0.1285,0.131,0.1335,0.1365,0.1395,0.142,0.1445,0.1475,0.1505,0.153,0.1555,0.1585,0.1615,0.164,0.1665,0.1695,0.1725,0.175,0.1775,0.1805,0.1835,0.186,0.1885,0.1915,0.1945,0.197,0.1995,0.2025,0.2055,0.208,0.2105,0.2135,0.2165,0.219,0.2215,0.2245,0.2275,0.23,0.2325,0.2355,0.2385,0.2415,0.244,0.2465,0.2495,0.2525,0.255,0.2575,0.2605,0.2635,0.266,0.2685,0.2715,0.2745,0.277,0.2795,0.2825,0.2855,0.288,0.2905,0.2935,0.2965,0.299,0.3015,0.3045,0.3075,0.31,0.3125,0.3155,0.3185,0.321,0.3235,0.3265,0.3295,0.332,0.3345,0.3375,0.3405,0.343,0.3455,0.3485,0.3515,0.3545,0.357,0.3595,0.3625,0.3655,0.368,0.3705,0.3735,0.3765,0.379,0.3815,0.3845,0.3875,0.39,0.3925,0.3955,0.3985,0.401,0.4035,0.4065,0.4095,0.412,0.4145,0.4175,0.4205,0.423,0.4255,0.4285,0.4315,0.434,0.4365,0.4395,0.4425,0.445,0.4475,0.4505,0.4535,0.456,0.4585,0.4615,0.4645,0.4675,0.47,0.4725,0.4755,0.4785,0.481,0.4835,0.4865,0.4895,0.492,0.4945,0.4975,0.5005,0.503,0.5055,0.5085,0.5115,0.514,0.5165,0.5195,0.5225,0.525,0.5275,0.5305,0.5335,0.536,0.5385,0.5415,0.5445,0.547,0.5495,0.5525,0.5555,0.558,0.5605,0.5635,0.5665,0.569,0.5715,0.5745,0.5775,0.58,0.5825,0.5855,0.5885,0.5915,0.594,0.5965,0.5995,0.6025,0.605,0.6075,0.6105,0.6135,0.616,0.6185,0.6215,0.6245,0.627,0.6295,0.6325,0.6355,0.638,0.6405,0.6435,0.6465,0.649,0.6515,0.6545,0.6575,0.66,0.6625,0.6655,0.6685,0.671,0.6735,0.6765,0.6795,0.682,0.6845,0.6875,0.6905,0.693,0.6955,0.6985,0.7015] },
  // SMAP_L3_Passive_Day_Soil_Moisture (255 classes)
  smapSurf: { units: 'cm³/cm³', rgb: 'ffa200ffa500ffa700ffaa00ffac00ffae00ffb100ffb300ffb500ffb800ffba00ffbd00ffbf00ffc100ffc400ffc600ffc800ffcb00ffcd00ffd000ffd200ffd400ffd700ffd900ffdb00ffde00ffe000ffe300ffe500ffe700ffea00ffec00ffee00fff100fff300fff600fff800fff900fffa00fffb00fffd00ffff00fffe00f9fc00f3f900edf600e7f300e1f000dbed00d5ea00d0e700cae400c4e100bede00b8db00b2d800acd500a6d200a0cf009acc0094c9008ec60088c30082c1007dbe0077bb0071b8006bb50065b2005faf0059ac0053a9004da60047a30041a0003b9d00359a002f97002a94002491001e8e00188b001288000c850006820000820000820600850c008813008b19008f1f00922500952c009832009b38009e3e00a14400a44b00a85100ab5700ae5d00b16400b46a00b77000ba7600bd7c00c18300c48900c78f00ca9500cd9b00d0a200d3a800d6ae00dab400ddbb00e0c100e3c700e6cd00e9d300ecda00efe000f3e600f6ec00f9f300fcf900feff00ffff00fdff00f9ff00f3ff00edff00e7ff00e1ff00dbff00d5ff00d0ff00caff00c4ff00beff00b8ff00b2ff00acff00a6ff00a0ff009aff0094ff008eff0088ff0082ff007dff0077ff0071ff006bff0065ff005fff0059ff0053ff004dff0047ff0041ff003bff0035ff002fff002aff0024ff001eff0018ff0012ff000cff0006ff0000ff0000fb0000f80000f40000f10000ed0000e90000e60000e20000df0000db0000d70000d40000d00000cd0000c90000c50000c20000be0000bb0000b70000b30000b00000ac0000a80000a50000a100009e00009a00009600009300008f00008c00008800008400008100007d00007a00007600007200006f00006b0000680000640202640404640606640808640a0a640c0c640e0e641010641212641414641616641818641a1a641c1c641e1e6420206422225a24245a26265a28285a2a2a5a2c2c5a2e2e5a30305a32325a34345a36365a38385a3a3a5a3c3c503e3e504040504242504444504646504848504a4a504c4c504e4e50505050',
    val: [0.001,0.0035,0.006,0.008,0.0105,0.013,0.0155,0.018,0.02,0.0225,0.025,0.027,0.0295,0.032,0.034,0.0365,0.039,0.0415,0.044,0.046,0.0485,0.051,0.053,0.0555,0.058,0.06,0.0625,0.065,0.0675,0.07,0.072,0.0745,0.077,0.079,0.0815,0.084,0.086,0.0885,0.091,0.093,0.0955,0.098,0.1005,0.103,0.105,0.1075,0.11,0.112,0.1145,0.117,0.119,0.1215,0.124,0.1265,0.129,0.131,0.1335,0.136,0.138,0.1405,0.143,0.145,0.1475,0.15,0.1525,0.155,0.157,0.1595,0.162,0.164,0.1665,0.169,0.171,0.1735,0.176,0.1785,0.181,0.183,0.1855,0.188,0.19,0.1925,0.195,0.197,0.1995,0.202,0.2045,0.207,0.209,0.2115,0.214,0.216,0.2185,0.221,0.223,0.2255,0.228,0.23,0.2325,0.235,0.2375,0.24,0.242,0.2445,0.247,0.249,0.2515,0.254,0.256,0.2585,0.261,0.2635,0.266,0.268,0.2705,0.273,0.275,0.2775,0.28,0.282,0.2845,0.287,0.2895,0.292,0.294,0.2965,0.299,0.301,0.3035,0.306,0.308,0.3105,0.313,0.3155,0.318,0.32,0.3225,0.325,0.327,0.3295,0.332,0.334,0.3365,0.339,0.3415,0.344,0.346,0.3485,0.351,0.353,0.3555,0.358,0.36,0.3625,0.365,0.3675,0.37,0.372,0.3745,0.377,0.379,0.3815,0.384,0.386,0.3885,0.391,0.393,0.3955,0.398,0.4005,0.403,0.405,0.4075,0.41,0.412,0.4145,0.417,0.419,0.4215,0.424,0.4265,0.429,0.431,0.4335,0.436,0.438,0.4405,0.443,0.445,0.4475,0.45,0.4525,0.455,0.457,0.4595,0.462,0.464,0.4665,0.469,0.471,0.4735,0.476,0.4785,0.481,0.483,0.4855,0.488,0.49,0.4925,0.495,0.497,0.4995,0.502,0.5045,0.507,0.509,0.5115,0.514,0.516,0.5185,0.521,0.523,0.5255,0.528,0.53,0.5325,0.535,0.5375,0.54,0.542,0.5445,0.547,0.549,0.5515,0.554,0.556,0.5585,0.561,0.5635,0.566,0.568,0.5705,0.573,0.575,0.5775,0.58,0.582,0.5845,0.587,0.5895,0.592,0.594,0.5965,0.599,0.601] },
  // OMPS_Ozone_Total_Column (162 classes)
  ozone: { units: 'DU', rgb: '5e4fa23288bd348abc368cbb388eba3a91b93c93b83f96b74198b6439bb5459db447a0b349a2b24ca4b14ea6b050a9af52abae54aead56b0ac59b3ab5bb5aa5db8a95fbaa861bda763bfa666c2a568c3a46bc4a46ec5a471c6a474c7a477c8a47ac9a47dcba47fcca482cda485cea488cfa48bd0a48ed1a490d2a493d3a496d4a499d6a49cd7a49fd8a4a2d9a4a5daa4a8dba4abdda4addea3afdfa3b1e0a2b4e1a2b6e2a1b9e3a1bbe4a0bee5a0c0e69fc3e79fc5e89ec8e99ecaea9dcdeb9dcfec9cd2ed9cd4ee9bd7ef9bd9f09adcf19adef299e1f399e3f498e6f598e7f497e8f396e9f295eaf195ebf094ecef94edee93eeee93efed92f0ec92f1eb91f2ea91f2e990f3e890f4e78ff6e68ff7e58ef8e58ef9e48dfae38dfbe28cfce18cfde08bfee08bfddd89fddb87fdd985fdd783fdd581fdd380fdd17efdcf7dfdcd7bfdcb79fdc977fdc775fdc473fdc272fdc070fdbe6ffdbc6dfdba6bfdb869fdb668fdb466fdb264fdb062fdae61fcab5ffca85efba55dfba35cfaa05afa9d59fa9a58fa9857f99555f99254f88f52f88d51f78a50f7884ff7854ef7824df67f4bf67d4af57a49f57748f47446f47245f46f44f46d43f26b43f16944ef6744ee6545ed6345ec6146ea5f46e95d47e85b47e75948e55748e45549e25349e1514ae0504a9e0142',
    val: [98.75,101.25,103.75,106.25,108.75,111.25,113.75,116.25,118.75,121.25,123.75,126.25,128.75,131.25,133.75,136.25,138.75,141.25,143.75,146.25,148.75,151.25,153.75,156.25,158.75,161.25,163.75,166.25,168.75,171.25,173.75,176.25,178.75,181.25,183.75,186.25,188.75,191.25,193.75,196.25,198.75,201.25,203.75,206.25,208.75,211.25,213.75,216.25,218.75,221.25,223.75,226.25,228.75,231.25,233.75,236.25,238.75,241.25,243.75,246.25,248.75,251.25,253.75,256.25,258.75,261.25,263.75,266.25,268.75,271.25,273.75,276.25,278.75,281.25,283.75,286.25,288.75,291.25,293.75,296.25,298.75,301.25,303.75,306.25,308.75,311.25,313.75,316.25,318.75,321.25,323.75,326.25,328.75,331.25,333.75,336.25,338.75,341.25,343.75,346.25,348.75,351.25,353.75,356.25,358.75,361.25,363.75,366.25,368.75,371.25,373.75,376.25,378.75,381.25,383.75,386.25,388.75,391.25,393.75,396.25,398.75,401.25,403.75,406.25,408.75,411.25,413.75,416.25,418.75,421.25,423.75,426.25,428.75,431.25,433.75,436.25,438.75,441.25,443.75,446.25,448.75,451.25,453.75,456.25,458.75,461.25,463.75,466.25,468.75,471.25,473.75,476.25,478.75,481.25,483.75,486.25,488.75,491.25,493.75,496.25,498.75,501.25] },
};
// END RASTER_LUTS

// EUMETView MTG FCI IR10.5, style mtg_fd_ir105_hrfi_grayscale: a linear SLD
// ramp (quantity 1 → #fefefe … 255 → #010101, opaque, no reused colours).
// Level → °C was calibrated against time-matched GOES-East Band 13 over the
// tropical Atlantic (T ≈ 29.5 − 0.41·level); good to a few °C on the warm
// side, the cold end is extrapolated (see test_report.md).
RASTER_LUTS.mtgGrey = (() => {
  let rgb = '', val = [];
  for (let l = 1; l <= 254; l++) { const h = l.toString(16).padStart(2, '0'); rgb += h + h + h; val.push(+(29.5 - 0.41 * l).toFixed(2)); }
  return { units: '°C (approx.)', rgb, val };
})();

// Piecewise-linear RGBA ramp. stops: [[value, [r,g,b,a(0-1)]], ...] ascending.
// Two stops at (almost) the same value make a hard step.
function rasterRampColor(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
      const t = v1 === v0 ? 1 : (v - v0) / (v1 - v0);
      return c0.map((c, k) => c + (c1[k] - c) * t);
    }
  }
  return stops[stops.length - 1][1];
}

// Legend gradient: tick values are spread evenly along the bar (so they line
// up with the space-between `.mls-scale-labels`), the value axis in between is
// piecewise linear. `marks` draws thin light rules at given values.
function rasterLegendCss(stops, ticks, marks = []) {
  const n = ticks.length - 1;
  const pos = v => {
    if (v <= ticks[0]) return 0;
    for (let i = 1; i <= n; i++) if (v <= ticks[i]) return ((i - 1) + (v - ticks[i - 1]) / (ticks[i] - ticks[i - 1])) / n * 100;
    return 100;
  };
  const rgba = c => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+c[3].toFixed(2)})`;
  const vals = new Set(ticks);
  stops.forEach(([v]) => { if (v > ticks[0] && v < ticks[n]) vals.add(v); });
  for (let i = 0; i < n; i++) for (let k = 1; k < 4; k++) vals.add(ticks[i] + (ticks[i + 1] - ticks[i]) * k / 4);
  let pts = [...vals].sort((a, b) => a - b).map(v => [pos(v), rgba(rasterRampColor(stops, v))]);
  for (const m of marks) {
    const p = pos(m), c = rgba(rasterRampColor(stops, m)), w = 0.6, rule = 'rgba(236,239,244,.95)';
    pts = pts.filter(([q]) => Math.abs(q - p) > w);
    pts.push([p - w, c], [p - w, rule], [p + w, rule], [p + w, c]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return `linear-gradient(to right,${pts.map(([p, c]) => `${c} ${+p.toFixed(1)}%`).join(',')})`;
}

const RASTER_PALETTES = (() => {
  const P = {
    // SST: one teal/blue family, dark = cold, capped at medium lightness so
    // white/lavender lines stay visible. 26 °C (TC fuel) is ruled on the legend.
    sst: {
      units: '°C',
      stops: [[0, [12, 20, 40, .8]], [10, [18, 44, 82, .8]], [18, [22, 70, 112, .8]], [24, [26, 98, 128, .8]], [27, [30, 120, 132, .8]], [30, [44, 142, 138, .8]]],
      ticks: [0, 10, 18, 24, 26, 30], labels: ['0', '10', '18', '24', '26 TC', '30 °C'], marks: [26],
    },
    // Enhanced-IR "clouds only": warm/clear ground transparent, colder =
    // brighter and more opaque. Shared by GOES-West, GOES-East, Himawari.
    ir: {
      units: '°C',
      stops: [[-90, [255, 255, 255, .95]], [-60, [235, 242, 248, .9]], [-40, [196, 204, 212, .75]], [-20, [140, 146, 152, .5]], [0, [100, 104, 108, .18]], [10, [90, 90, 90, 0]]],
      ticks: [-90, -60, -40, -20, 0, 10], labels: ['−90', '−60', '−40', '−20', '0', '10 °C'],
    },
    // Sea ice: transparent below 15 % (the usual ice-edge threshold), pale
    // blue-grey → white at 100 %.
    seaIce: {
      units: '%',
      stops: [[0, [150, 168, 188, 0]], [14.9, [150, 168, 188, 0]], [15, [150, 168, 188, .45]], [50, [186, 200, 216, .7]], [85, [222, 230, 240, .85]], [100, [248, 250, 252, .95]]],
      ticks: [0, 15, 50, 85, 100], labels: ['0', '15', '50', '85', '100 %'],
    },
    // GRACE LWE anomaly (cm; negative = less water than the 2004–09 baseline).
    // Diverging brown (deficit) / blue (surplus); |v| < 3 cm transparent.
    grace: {
      units: 'cm',
      stops: [[-30, [98, 64, 38, .85]], [-15, [128, 92, 60, .72]], [-6, [156, 126, 96, .5]], [-3, [170, 146, 120, .28]], [-2.99, [170, 146, 120, 0]],
              [2.99, [112, 150, 180, 0]], [3, [112, 150, 180, .28]], [6, [88, 134, 176, .5]], [15, [58, 104, 162, .72]], [30, [34, 70, 136, .85]]],
      ticks: [-30, -15, -3, 3, 15, 30], labels: ['−30', '−15', '−3', '+3', '+15', '+30 cm'],
    },
    // SMAP soil moisture: dry brown → neutral grey → wet teal, muted. Values
    // above the last stop (GIBS's flat-grey top class) clamp to the wettest teal.
    smapRoot: {
      units: 'm³/m³',
      stops: [[0.04, [104, 72, 44, .82]], [0.12, [140, 104, 70, .75]], [0.2, [160, 146, 122, .62]], [0.26, [120, 146, 140, .62]], [0.32, [76, 138, 140, .72]], [0.42, [44, 114, 126, .8]], [0.55, [24, 86, 106, .88]]],
      ticks: [0.04, 0.12, 0.2, 0.26, 0.32, 0.42, 0.55], labels: ['0.04', '0.12', '0.20', '0.26', '0.32', '0.42', '≥0.55'],
    },
    // OMPS total ozone: single muted violet; low (ozone-hole, < 220 DU) is the
    // most saturated and opaque, typical/high values fade out.
    ozone: {
      units: 'DU',
      stops: [[100, [60, 28, 122, .88]], [200, [82, 52, 146, .8]], [220, [100, 76, 158, .7]], [240, [124, 108, 168, .5]], [300, [146, 138, 178, .34]], [400, [172, 168, 196, .24]], [500, [196, 194, 214, .18]]],
      ticks: [100, 220, 300, 400, 500], labels: ['100', '220 hole', '300', '400', '500 DU'], marks: [220],
    },
  };
  P.smapSurf = { ...P.smapRoot, units: 'm³/m³' };
  for (const k in P) {
    const p = P[k];
    p.legend = { css: rasterLegendCss(p.stops, p.ticks, p.marks), labels: p.labels };
  }
  return P;
})();

// Legend markup matching index.html's .mls-gradient-bar / .mls-scale-labels.
function rasterLegendHTML(key) {
  const lg = RASTER_PALETTES[key].legend;
  return `<div class="mls-gradient-bar" style="background:${lg.css}"></div>\n` +
         `<div class="mls-scale-labels">${lg.labels.map(l => `<span>${l}</span>`).join('')}</div>`;
}

// GIBS Band-13 IR grey ambiguity. The enhanced-IR table reuses greys for the
// −70…−80 °C band (230,204,…,5) and for warm surfaces (−19…+57 °C, 197→1).
// Tiles are bilinearly resampled, so every grey ≤ ~213 could be either.
// Pixels are resolved spatially: cold greys sit between the red (−60…−70) and
// magenta (−81…−91) bands, warm greys next to cyan/blue (−19…−31). Each
// ambiguous pixel takes a vote of classified pixels in a (2r+1)² window
// (cold evidence: value ≤ coldEvidence; warm evidence: warmEvidence ≤ value,
// non-grey), repeating passes with a growing window so resolved pixels vote
// too; anything still undecided (no evidence anywhere in the tile) falls back
// to warm (the common case, and the safe one: warm → transparent-ish rather
// than a bright false cloud). A final 3×3 majority pass removes lone flips.
const RASTER_IR_GREY = { coldMin: -81, coldMax: -69, warmMin: -20, maxLevel: 213,
                         coldEvidence: -58, warmEvidence: -36, radius: 4, maxRadius: 32, passes: 10 };

const RasterRecolor = (() => {
  const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const pack = c => {
    const r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]), a = Math.round(c[3] * 255);
    return (LITTLE ? ((a << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | a)) >>> 0;
  };

  // Parse a LUT once: typed arrays + exact-match map (+ grey band indexes).
  function prep(lut) {
    if (lut._p) return lut._p;
    const n = lut.val.length, rgb = new Uint8Array(n * 3), exact = new Map();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] = parseInt(lut.rgb.substr(i * 6 + k * 2, 2), 16);
      const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
      if (!exact.has(key)) exact.set(key, i);
    }
    lut._p = { n, rgb, val: Float32Array.from(lut.val), exact };
    return lut._p;
  }

  function nearest(p, r, g, b, idxs) {
    let best = -1, bd = Infinity;
    const list = idxs || null, m = list ? list.length : p.n;
    for (let j = 0; j < m; j++) {
      const i = list ? list[j] : j;
      const dr = p.rgb[i * 3] - r, dg = p.rgb[i * 3 + 1] - g, db = p.rgb[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return [best, bd];
  }

  // One engine per (lut, palette, options) — shared by GOES-W/E/Himawari so the
  // per-colour cache warms once. Cache: 24-bit colour → entry index into
  // parallel arrays (packed output, evidence class, warm/cold alternatives).
  const engines = new Map();
  function engine(lut, palette, tol, amb) {
    const id = [lut.rgb.length, lut.val[0], palette.stops.length, JSON.stringify(palette.stops), tol, !!amb].join('|');
    let e = engines.get(id);
    if (e) return e;
    const p = prep(lut);
    const vmin = palette.stops[0][0], vmax = palette.stops[palette.stops.length - 1][0], N = 4096;
    const table = new Uint32Array(N);
    for (let i = 0; i < N; i++) table[i] = pack(rasterRampColor(palette.stops, vmin + (vmax - vmin) * i / (N - 1)));
    const colour = v => table[v <= vmin ? 0 : v >= vmax ? N - 1 : Math.round((v - vmin) / (vmax - vmin) * (N - 1))];
    let warmG = null, coldG = null;
    if (amb) {
      warmG = []; coldG = [];
      for (let i = 0; i < p.n; i++) {
        const r = p.rgb[i * 3], g = p.rgb[i * 3 + 1], b = p.rgb[i * 3 + 2], v = p.val[i];
        if (r !== g || g !== b) continue;
        if (v >= amb.coldMin && v <= amb.coldMax) coldG.push(i);
        else if (v >= amb.warmMin) warmG.push(i);
      }
    }
    e = { p, colour, tol2: tol * tol, amb, warmG, coldG,
          cache: new Map(), px: [], cls: [], alt: [], hits: 0, misses: 0 };
    // cls: 0 = no data / rejected, 1 = warm evidence, 2 = cold evidence,
    //      3 = ambiguous grey, 4 = definite but not evidence
    e.classify = function (key) {
      const r = key >>> 16, g = (key >>> 8) & 255, b = key & 255;
      let i = p.exact.get(key), d = 0;
      if (i === undefined) [i, d] = nearest(p, r, g, b);
      let px = 0, c = 0, alt = null;
      if (i >= 0 && d <= e.tol2) {
        const v = p.val[i];
        const isGrey = !!amb && p.rgb[i * 3] === p.rgb[i * 3 + 1] && p.rgb[i * 3 + 1] === p.rgb[i * 3 + 2];
        if (isGrey && (r + g + b) / 3 <= amb.maxLevel) {
          // could be a warm-surface grey or a −70…−80 °C grey: keep both answers
          const wv = p.val[nearest(p, r, g, b, warmG)[0]], cv = p.val[nearest(p, r, g, b, coldG)[0]];
          px = colour(wv); c = 3; alt = [colour(wv), colour(cv), wv, cv];
        } else if (isGrey) {
          px = colour(v); c = 2;                 // 204/230 greys and white: only cold
        } else {
          px = colour(v);
          c = !amb ? 4 : v <= amb.coldEvidence ? 2 : v >= amb.warmEvidence ? 1 : 4;
        }
      }
      const idx = e.px.length;
      e.px.push(px); e.cls.push(c); e.alt.push(alt);
      e.cache.set(key, idx);
      return idx;
    };
    engines.set(id, e);
    return e;
  }

  // Recolour one RGBA ImageData in place. Returns stats for IR grey handling.
  function process(e, img) {
    const W = img.width, H = img.height, n = W * H;
    const u8 = img.data, u32 = new Uint32Array(u8.buffer, u8.byteOffset, n);
    const idxArr = new Int32Array(n);
    const cache = e.cache;
    let lastKey = -1, lastIdx = -1, amb = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = u8[o + 3];
      if (a === 0) { idxArr[i] = -1; continue; }
      const key = (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2];
      let idx;
      if (key === lastKey) idx = lastIdx;
      else {
        idx = cache.get(key);
        if (idx === undefined) { idx = e.classify(key); e.misses++; } else e.hits++;
        lastKey = key; lastIdx = idx;
      }
      idxArr[i] = idx;
      if (e.cls[idx] === 3) amb++;
    }
    let rejected = 0;
    for (let i = 0; i < n; i++) if (idxArr[i] >= 0 && e.cls[idxArr[i]] === 0) rejected++;
    const stats = { opaque: 0, rejected, ambiguous: amb, cold: 0, warmVote: 0, warmDefault: 0, passes: 0 };
    let resolved = null;   // per-pixel: 1 warm, 2 cold (only for ambiguous)
    if (e.amb && amb) {
      const S = W + 1;
      const state = new Uint8Array(n);   // evidence class per pixel
      const pend = [];
      for (let i = 0; i < n; i++) {
        const idx = idxArr[i];
        if (idx < 0) continue;
        const c = e.cls[idx];
        if (c === 1 || c === 2) state[i] = c;
        else if (c === 3) pend.push(i);
      }
      resolved = new Uint8Array(n);
      const satW = new Int32Array(S * (H + 1)), satC = new Int32Array(S * (H + 1));
      let todo = pend;
      for (let pass = 0; pass < e.amb.passes && todo.length; pass++) {
        // window grows 4,4,8,8,16,16,… so interiors of wide uniform grey areas
        // are reached in a few passes, while edge pixels still vote locally
        const R = Math.min(e.amb.maxRadius, e.amb.radius << (pass >> 1));
        stats.passes++;
        for (let y = 0; y < H; y++) {
          let rw = 0, rc = 0;
          for (let x = 0; x < W; x++) {
            const s = state[y * W + x];
            if (s === 1) rw++; else if (s === 2) rc++;
            satW[(y + 1) * S + x + 1] = satW[y * S + x + 1] + rw;
            satC[(y + 1) * S + x + 1] = satC[y * S + x + 1] + rc;
          }
        }
        const next = [], newly = [];
        for (const i of todo) {
          const x = i % W, y = (i / W) | 0;
          const x0 = x - R < 0 ? 0 : x - R, x1 = x + R + 1 > W ? W : x + R + 1;
          const y0 = y - R < 0 ? 0 : y - R, y1 = y + R + 1 > H ? H : y + R + 1;
          const w = satW[y1 * S + x1] - satW[y0 * S + x1] - satW[y1 * S + x0] + satW[y0 * S + x0];
          const c = satC[y1 * S + x1] - satC[y0 * S + x1] - satC[y1 * S + x0] + satC[y0 * S + x0];
          if (c > w) { newly.push(i, 2); stats.cold++; }
          else if (w > c) { newly.push(i, 1); stats.warmVote++; }
          else next.push(i);
        }
        for (let k = 0; k < newly.length; k += 2) { state[newly[k]] = newly[k + 1]; resolved[newly[k]] = newly[k + 1]; }
        todo = next;
        if (!newly.length && R >= e.amb.maxRadius) break;
      }
      stats.warmDefault = todo.length;
      // Despeckle: an ambiguous pixel outvoted by ≥ 5 of its 8 neighbours flips.
      stats.flipped = 0;
      const flips = [];
      for (const i of pend) {
        const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
        const mine = resolved[i] === 2 ? 2 : 1;
        let other = 0;
        for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = i + dy + dx, s = state[j] || (resolved[j] ? resolved[j] : (e.cls[idxArr[j]] === 3 ? 1 : 0));
          if (s && s !== mine) other++;
        }
        if (other >= 5) flips.push(i, mine === 2 ? 1 : 2);
      }
      for (let k = 0; k < flips.length; k += 2) resolved[flips[k]] = flips[k + 1];
      stats.flipped = flips.length / 2;
    }
    for (let i = 0; i < n; i++) {
      const idx = idxArr[i];
      if (idx < 0) continue;
      let px = e.px[idx];
      stats.opaque++;
      if (resolved && e.cls[idx] === 3) px = e.alt[idx][resolved[i] === 2 ? 1 : 0];
      if (e.debug) {   // diagnostic colours: red = grey→cold, blue = grey→warm by vote, green = warm by default, magenta = rejected colour
        const c = e.cls[idx];
        px = c === 0 ? 0xffff00ff : c !== 3 ? (px & 0x00ffffff) | 0x30000000 : resolved[i] === 2 ? 0xff0000ff : resolved[i] === 1 ? 0xffff0000 : 0xff00c000;
      }
      const a = u8[i * 4 + 3];
      if (a < 255 && px) {        // partially transparent source edge: scale alpha
        const pa = LITTLE ? px >>> 24 : px & 255, na = Math.round(pa * a / 255);
        px = LITTLE ? ((px & 0x00ffffff) | (na << 24)) >>> 0 : ((px & 0xffffff00) | na) >>> 0;
      }
      u32[i] = px;
    }
    // Colours no palette entry explains (bilinear blends across distant table
    // entries at sharp edges) would punch dark holes: fill them from the mean
    // (premultiplied) of their matched 8-neighbours.
    stats.filled = 0;
    if (rejected && !e.debug) {
      for (let i = 0; i < n; i++) {
        const idx = idxArr[i];
        if (idx < 0 || e.cls[idx] !== 0) continue;
        const x = i % W, y = (i / W) | 0;
        let sr = 0, sg = 0, sb = 0, sa = 0, k = 0;
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx, jd = idxArr[j];
          if (jd < 0 || e.cls[jd] === 0) continue;
          const o = j * 4, a = u8[o + 3];
          sr += u8[o] * a; sg += u8[o + 1] * a; sb += u8[o + 2] * a; sa += a; k++;
        }
        if (!k || !sa) continue;
        const o = i * 4;
        u8[o] = sr / sa; u8[o + 1] = sg / sa; u8[o + 2] = sb / sa; u8[o + 3] = sa / k;
        stats.filled++;
      }
    }
    return stats;
  }

  return { engine, process, prep };
})();

if (typeof L !== 'undefined') {
  L.GridLayer.Recolor = L.GridLayer.extend({
    options: {
      url: '',
      nativeMaxZoom: 6,      // deepest zoom GIBS publishes (Level6 / Level7)
      lut: null,             // RASTER_LUTS.<x>
      palette: null,         // RASTER_PALETTES.<x>
      tolerance: null,       // max RGB distance for a nearest-colour match (default: 40 for IR, 12 otherwise)
      greyAmbiguity: null,   // RASTER_IR_GREY for the Band-13 IR table (auto when lut === RASTER_LUTS.ir)
      pixelated: false,      // over-zoom: nearest-neighbour instead of smoothed upscaling
      cacheSize: 64,         // recoloured native tiles kept for over-zoom children
      keepColours: false,    // validate tiles against the LUT but draw the provider's own colours
    },

    initialize(options) {
      L.GridLayer.prototype.initialize.call(this, options);
      const o = this.options;
      if (o.greyAmbiguity === null) o.greyAmbiguity = (typeof RASTER_LUTS !== 'undefined' && o.lut === RASTER_LUTS.ir) ? RASTER_IR_GREY : false;
      if (o.tolerance === null) o.tolerance = o.greyAmbiguity ? 40 : 12;
      this._url = o.url;
      this._native = new Map();   // url -> Promise<canvas|null>, LRU by insertion order
      this._gen = 0;
      this.timings = [];          // ms of pure recolour work per native tile
      this.greyStats = { tiles: 0, ambiguous: 0, cold: 0, warmVote: 0, warmDefault: 0 };
      this._engine = RasterRecolor.engine(o.lut, o.palette, o.tolerance, o.greyAmbiguity || null);
    },

    // Same contract as L.TileLayer#setUrl (refreshGibsDailyLayers relies on _url).
    setUrl(url, noRedraw) {
      if (url === this._url && noRedraw === undefined) noRedraw = true;
      this._url = this.options.url = url;
      this._native.clear();
      if (!noRedraw) this.redraw();
      return this;
    },

    // Re-fetch everything (e.g. for 'default' = latest imagery).
    refresh() { this._native.clear(); return this.redraw(); },

    redraw() { this._gen++; return L.GridLayer.prototype.redraw.call(this); },

    // {x}/{y}/{z} for WMTS, or {bbox} (EPSG:3857 minx,miny,maxx,maxy) for a WMS GetMap URL.
    getTileUrl(c) {
      const d = { x: c.x, y: c.y, z: c.z, bbox: '' };
      if (this._url.indexOf('{bbox}') >= 0) {
        const E = 20037508.342789244, s = 2 * E / 2 ** c.z;
        d.bbox = [-E + c.x * s, E - (c.y + 1) * s, -E + (c.x + 1) * s, E - c.y * s].map(v => v.toFixed(2)).join(',');
      }
      return L.Util.template(this._url, d);
    },

    _nativeTile(src) {
      const url = this.getTileUrl(src);
      const hit = this._native.get(url);
      if (hit) { this._native.delete(url); this._native.set(url, hit); return hit; }
      const pr = new Promise(resolve => {
        /* GIBS misbehaves in two ways, and both are retried:
           • intermittent 404/500 for tiles that exist;
           • corrupt tiles south of about 55°S (Web Mercator only), where about
             half the responses are scrambled imagery from the wrong source.
           A corrupt tile is recognisable because almost none of its pixels are
           colours from the product's own colour table (measured: 99.5–100 %
           unmatched, against 0 % for genuine tiles). After the last attempt the
           tile is left empty rather than showing noise. */
        let attempt = 0;
        const retry = () => {
          if (attempt++ < 4) setTimeout(() => { img.src = url; }, 500 * attempt);
          else resolve(null);
        };
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const t0 = performance.now();
            const data = ctx.getImageData(0, 0, cv.width, cv.height);
            // keepColours: check a copy, leave the provider's pixels on the canvas
            const work = this.options.keepColours ? new ImageData(new Uint8ClampedArray(data.data), data.width, data.height) : data;
            const st = RasterRecolor.process(this._engine, work);
            if (st.opaque > 200 && st.rejected / st.opaque > 0.5) { this.corruptTiles = (this.corruptTiles || 0) + 1; retry(); return; }
            if (!this.options.keepColours) ctx.putImageData(data, 0, 0);
            const ms = performance.now() - t0;
            this.timings.push(ms); if (this.timings.length > 500) this.timings.shift();
            if (this.options.greyAmbiguity) {
              const g = this.greyStats; g.tiles++;
              g.ambiguous += st.ambiguous; g.cold += st.cold; g.warmVote += st.warmVote; g.warmDefault += st.warmDefault;
            }
            this.fire('tilerecolor', { url, ms, stats: st });
            resolve(cv);
          } catch (err) {           // tainted canvas / decode problem → empty tile
            console.warn('recolor failed', url, err);
            resolve(null);
          }
        };
        img.onerror = retry;
        img.src = url;
      });
      this._native.set(url, pr);
      while (this._native.size > this.options.cacheSize) this._native.delete(this._native.keys().next().value);
      pr.then(cv => { if (!cv) this._native.delete(url); });   // don't pin failures
      return pr;
    },

    createTile(coords, done) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x; tile.height = size.y;
      const z = Math.min(coords.z, this.options.nativeMaxZoom);
      const scale = 2 ** (coords.z - z);
      const src = { x: Math.floor(coords.x / scale), y: Math.floor(coords.y / scale), z };
      const gen = this._gen;
      this._nativeTile(src).then(cv => {
        if (gen !== this._gen) return;          // superseded by setUrl/redraw
        if (cv) {
          const ctx = tile.getContext('2d');
          ctx.imageSmoothingEnabled = !this.options.pixelated;
          const sw = cv.width / scale, sh = cv.height / scale;
          const ox = (coords.x - src.x * scale) * sw, oy = (coords.y - src.y * scale) * sh;
          ctx.drawImage(cv, ox, oy, sw, sh, 0, 0, size.x, size.y);
        }
        done(null, tile);                        // errors → empty tile, never a broken image
      });
      return tile;
    },

    timingSummary() {
      const t = [...this.timings].sort((a, b) => a - b);
      if (!t.length) return null;
      const q = f => +t[Math.min(t.length - 1, Math.floor(f * t.length))].toFixed(2);
      return { tiles: t.length, median: q(0.5), p90: q(0.9), max: q(1),
               mean: +(t.reduce((s, x) => s + x, 0) / t.length).toFixed(2) };
    },
  });

}

// Factory, mirroring L.tileLayer(url, opts).
function recolorLayer(options) { return new L.GridLayer.Recolor(options); }

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
    // Never taller than the map: long popups scroll inside
    const content = popupEl.querySelector('.leaflet-popup-content');
    if (content) { content.style.maxHeight = `${Math.max(120, mapRect.height - 60)}px`; content.style.overflowY = 'auto'; }
    const boxRect = box.getBoundingClientRect();
    let shift = 0;
    if (boxRect.left < mapRect.left + pad)        shift = mapRect.left + pad - boxRect.left;
    else if (boxRect.right > mapRect.right - pad) shift = mapRect.right - pad - boxRect.right;
    // The tip only stays attached while it sits under the box, clear of the rounded corners
    if (tip && Math.abs(shift) > boxRect.width / 2 - 24) tip.style.visibility = 'hidden';

    /* Same problem vertically: near the map's north edge, maxBounds stops the
       map from panning down far enough for a tall popup. Open it below the
       marker instead; if it fits neither way, pin it inside the map. */
    let dy = 0;
    if (boxRect.top < mapRect.top + pad) {
      const anchorY = (tip || box).getBoundingClientRect().bottom;   // where the tip points
      const source  = map._popup._source;
      let below = 10;                                                 // clear the clicked point
      if (source instanceof L.Marker) {
        const icon = source.options.icon.options;
        const size = L.point(icon.iconSize || [12, 12]), anchor = L.point(icon.iconAnchor || [size.x / 2, size.y / 2]);
        below = -(icon.popupAnchor?.[1] || 0) + (size.y - anchor.y) + 6;
      }
      const flippedTop = anchorY + below;
      dy = flippedTop + boxRect.height <= mapRect.bottom - pad
        ? flippedTop - boxRect.top                    // fits below the marker
        : mapRect.top + pad - boxRect.top;            // fits nowhere: pin to the top and scroll
      if (tip) tip.style.visibility = 'hidden';
    }
    if (shift || dy) parts.forEach(el => { el.style.transform = `translate(${Math.round(shift)}px, ${Math.round(dy)}px)`; });
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
    attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank">Esri</a> &mdash; Source: Esri, Vantor, Earthstar Geographics',
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
    pane: 'labels', maxZoom: 19,
    // The imagery credit doesn't cover the label data; the dark labels share the dark basemap's credit
    attribution: 'Labels: Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
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
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  goesWLayer = recolorLayer({
    url: `${_gibsBase}/GOES-West_ABI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.ir,
    palette: RASTER_PALETTES.ir,
    attribution: 'GOES-West IR &copy; <a href="https://www.nesdis.noaa.gov/" target="_blank">NOAA/NESDIS</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
    opacity: 1,
    zIndex: 4,
  });

  // NASA GIBS — GOES-East Band 13 Clean Infrared (covers Americas + Atlantic)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  goesELayer = recolorLayer({
    url: `${_gibsBase}/GOES-East_ABI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.ir,
    palette: RASTER_PALETTES.ir,
    attribution: 'GOES-East IR &copy; <a href="https://www.nesdis.noaa.gov/" target="_blank">NOAA/NESDIS</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
    opacity: 1,
    zIndex: 4,
  });

  // EUMETSAT EUMETView — MTG-I FCI IR 10.5 µm full disk (0°), 10-min cadence.
  // The operator's own service: CORS-enabled, no key, no quota. Omitting
  // `time` serves the latest frame. The grayscale style is a linear ramp with no
  // reused colours; RASTER_LUTS.mtgGrey maps it back to approximate °C
  // (calibrated against GOES-East) so it gets the same "clouds only" palette.
  meteosatLayer = recolorLayer({
    url: 'https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetMap&version=1.1.1' +
         '&layers=mtg_fd:ir105_hrfi&styles=mtg_fd:mtg_fd_ir105_hrfi_grayscale' +
         '&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox}',
    nativeMaxZoom: 8,
    lut: RASTER_LUTS.mtgGrey,
    palette: RASTER_PALETTES.ir,
    attribution: 'Meteosat MTG-I FCI &copy; <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a>',
    opacity: 1,
    zIndex: 4,
  });

  // NASA GIBS — Himawari AHI Band 13 Clean Infrared (East Asia / W Pacific),
  // 10-minute cadence.
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  himawariLayer = recolorLayer({
    url: `${_gibsBase}/Himawari_AHI_Band13_Clean_Infrared/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.ir,
    palette: RASTER_PALETTES.ir,
    attribution: 'Himawari AHI &copy; <a href="https://www.data.jma.go.jp/mscweb/en/index.html" target="_blank">JMA</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>',
    opacity: 1,
    zIndex: 4,
  });

  // ── Enhanced-colour IR: the providers' original colour tables, used when the
  // Satellite imagery style is "Enhanced". Same imagery as the clouds-only
  // layers above; a colour field, so it follows the one-field rule.
  const _irAttr = layer => layer.options.attribution;
  const _gibsIr = product => L.tileLayer(
    `${_gibsBase}/${product}/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    { opacity: 0.8, maxNativeZoom: 6, zIndex: 4 }
  );
  goesWEnhLayer    = _gibsIr('GOES-West_ABI_Band13_Clean_Infrared');
  goesEEnhLayer    = _gibsIr('GOES-East_ABI_Band13_Clean_Infrared');
  himawariEnhLayer = _gibsIr('Himawari_AHI_Band13_Clean_Infrared');
  goesWEnhLayer.options.attribution    = _irAttr(goesWLayer);
  goesEEnhLayer.options.attribution    = _irAttr(goesELayer);
  himawariEnhLayer.options.attribution = _irAttr(himawariLayer);
  meteosatEnhLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
    layers:      'mtg_fd:ir105_hrfi',
    styles:      'mtg_fd:mtg_fd_ir105_hrfi_style_02',   // EUMETSAT's enhanced-IR ramp
    format:      'image/png',
    transparent: true,
    opacity:     0.8,
    zIndex:      4,
    attribution: _irAttr(meteosatLayer),
  });

  // ── Air Mass RGB (GOES-West, GOES-East, Himawari): a composite of two
  // water-vapour channels, an ozone channel and IR. Shows dry versus moist
  // upper air, jet streams and warm/cold air masses. The three discs fit
  // together, so one toggle shows all of them. Opaque colour field.
  const _gibsComposite = (product, level, attribution) => L.tileLayer(
    `${_gibsBase}/${product}/default/default/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`,
    { opacity: 0.9, maxNativeZoom: level, zIndex: 3, attribution }
  );
  const _gibsCredit = (who, href) => `${who} &copy; <a href="${href}" target="_blank">${who.includes('Himawari') ? 'JMA' : 'NOAA/NESDIS'}</a> via <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">NASA GIBS</a>`;
  airmassLayer = L.layerGroup([
    _gibsComposite('Himawari_AHI_Air_Mass', 6, _gibsCredit('Himawari Air Mass', 'https://www.jma.go.jp/')),
    _gibsComposite('GOES-West_ABI_Air_Mass', 6, _gibsCredit('GOES-West Air Mass', 'https://www.nesdis.noaa.gov/')),
    _gibsComposite('GOES-East_ABI_Air_Mass', 6, _gibsCredit('GOES-East Air Mass', 'https://www.nesdis.noaa.gov/')),
  ]);

  // ── GeoColor (GOES-West, GOES-East): near true colour by day, infrared
  // cloud over a static night-lights background at night. Opaque colour field.
  geocolorLayer = L.layerGroup([
    _gibsComposite('GOES-West_ABI_GeoColor', 7, _gibsCredit('GOES-West GeoColor', 'https://www.nesdis.noaa.gov/')),
    _gibsComposite('GOES-East_ABI_GeoColor', 7, _gibsCredit('GOES-East GeoColor', 'https://www.nesdis.noaa.gov/')),
  ]);

  // NASA GIBS — GRACE-FO groundwater anomaly (global drought proxy, monthly)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  graceLayer = recolorLayer({
    url: `${_gibsBase}/GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.grace,
    palette: RASTER_PALETTES.grace,
    attribution: 'GRACE Groundwater &copy; <a href="https://grace.jpl.nasa.gov/" target="_blank">NASA/JPL GRACE</a> via NASA GIBS',
    opacity: 1,
    zIndex: 3,
  });

  // NASA GIBS — SMAP root-zone soil moisture (global, ~3-day lag)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  smapRootLayer = recolorLayer({
    url: `${_gibsBase}/SMAP_L4_Analyzed_Root_Zone_Soil_Moisture/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.smapRoot,
    palette: RASTER_PALETTES.smapRoot,
    attribution: 'SMAP Root Zone &copy; <a href="https://smap.jpl.nasa.gov/" target="_blank">NASA SMAP</a> via NASA GIBS',
    opacity: 1,
    zIndex: 3,
  });

  // NASA GIBS — SMAP surface soil moisture (global, daily passive microwave)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  smapSurfLayer = recolorLayer({
    url: `${_gibsBase}/SMAP_L3_Passive_Day_Soil_Moisture/default/default/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.smapSurf,
    palette: RASTER_PALETTES.smapSurf,
    attribution: 'SMAP Surface &copy; <a href="https://smap.jpl.nasa.gov/" target="_blank">NASA SMAP</a> via NASA GIBS',
    opacity: 1,
    zIndex: 3,
  });

  // NASA GIBS — GHRSST MUR sea surface temperature (1 km, daily L4 analysis)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  sstLayer = recolorLayer({
    url: `${_gibsBase}/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/${_gibsTms7}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 7,
    lut: RASTER_LUTS.sst,
    palette: RASTER_PALETTES.sst,
    attribution: 'SST &copy; <a href="https://podaac.jpl.nasa.gov/" target="_blank">NASA/JPL MUR</a> via NASA GIBS',
    opacity: 1,
    zIndex: 3,
  });

  // NASA GIBS — GHRSST MUR sea ice concentration (companion product to SST)
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  seaIceLayer = recolorLayer({
    url: `${_gibsBase}/GHRSST_L4_MUR_Sea_Ice_Concentration/default/default/${_gibsTms7}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 7,
    lut: RASTER_LUTS.seaIce,
    palette: RASTER_PALETTES.seaIce,
    attribution: 'Sea Ice &copy; <a href="https://podaac.jpl.nasa.gov/" target="_blank">NASA/JPL MUR</a> via NASA GIBS',
    opacity: 1,
    // above sstLayer (3) so ice always draws on top of the water beneath it
    zIndex: 4,
  });

  // ── Atmospheric composition (daily polar-orbiter products) ──
  // These are swath-based and assembled progressively, so recent days have
  // ragged western coverage. See GIBS_DAILY_OFFSET for the measured numbers.
  // Recoloured by value (see RASTER PALETTES): quiet ground that coloured symbols stay readable on
  ozoneLayer = recolorLayer({
    url: `${_gibsBase}/OMPS_Ozone_Total_Column/default/${gibsDayOffsetUTC(GIBS_DAILY_OFFSET)}/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.ozone,
    palette: RASTER_PALETTES.ozone,
    attribution: 'Ozone &copy; <a href="https://ozoneaq.gsfc.nasa.gov/" target="_blank">NASA OMPS / Suomi NPP</a> via NASA GIBS',
    opacity: 1,
    zIndex: 3,
  });

  // Through the recolour layer only for tile validation: GIBS serves corrupt
  // SO2 tiles in the far south, and this rejects and re-fetches them. SO2 keeps
  // its own single-hue colours.
  so2Layer = recolorLayer({
    url: `${_gibsBase}/OMI_SO2_Lower_Troposphere/default/${gibsDayOffsetUTC(GIBS_DAILY_OFFSET)}/${_gibsTms}/{z}/{y}/{x}.png`,
    nativeMaxZoom: 6,
    lut: RASTER_LUTS.so2,
    palette: { stops: [[0, [0, 0, 0, 0]], [1, [0, 0, 0, 0]]] },   // unused: keepColours
    keepColours: true,
    attribution: 'SO&#8322; &copy; <a href="https://aura.gsfc.nasa.gov/" target="_blank">NASA OMI / Aura</a> via NASA GIBS',
    opacity: 0.75,
    zIndex: 3,
  });

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
  windLayer       = L.layerGroup([], { attribution: 'Wind: NOAA METAR and NDBC buoys via <a href="https://www.arcgis.com/home/item.html?id=cb1886ff0a9d4156ba4d2fadd7e8a139" target="_blank">Esri Living Atlas</a>' });
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
  hurLayer        = L.layerGroup([], { attribution: 'Tropical cyclones: NHC, JTWC via <a href="https://www.arcgis.com/home/item.html?id=248e7b5827a34b248647afb012c58787" target="_blank">Esri Living Atlas</a>' });
  hurProbLayer    = L.layerGroup();

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
  // Switching a colour field on replaces any field it can't share the map with
  if (document.getElementById(`toggle-${which}`)?.checked) enforceSingleField(which);
  // Any manual change means the map no longer matches a scene
  if (!_applyingScene) markScene(null);
  // Dynamic layers (created async) — handle via shared lookup
  const dynamicMap = { rainviewer: rainviewerLayer };
  if (which in dynamicMap) {
    const layer = dynamicMap[which];
    const el = document.getElementById(`toggle-${which}`);
    if (layer) el?.checked ? map.addLayer(layer) : map.removeLayer(layer);
    // If checked but layer not yet loaded, the load function will add it when ready
    updateFieldState();
    updateMapCount();
    return;
  }
  const layers = { eq: eqLayer, eas: easLayer, lsr: lsrLayer, eonet: eonetLayer, drought: droughtLayer, gauge: gaugeLayer, volc: volcLayer, gdacs: gdacsLayer, meteoalarm: meteoalarmLayer, wmo: wmoLayer, 'spc-d1': spcD1Layer, 'spc-d2': spcD2Layer, 'spc-d3': spcD3Layer, 'fwx-d1': fwxD1Layer, 'fwx-d2': fwxD2Layer, msc: mscLayer, radar: radarLayer, imerg: imergLayer, airmass: airmassLayer, geocolor: geocolorLayer, grace: graceLayer, 'smap-root': smapRootLayer, 'smap-surf': smapSurfLayer, 'dwd-radar': dwdRadarLayer, 'fmi-radar': fmiRadarLayer, sst: sstLayer, seaice: seaIceLayer, wind: windLayer, hur: hurLayer, hurprob: hurProbLayer, ozone: ozoneLayer, so2: so2Layer, };
  const el = document.getElementById(`toggle-${which}`);
  if (IR_KEYS.includes(which)) {
    // Both styles exist; only the current one is ever on the map
    for (const variant of ['clouds', 'enhanced']) map.removeLayer(irLayerFor(which, variant));
    if (el?.checked) map.addLayer(irLayerFor(which));
  } else if (el && layers[which]) {
    el.checked ? map.addLayer(layers[which]) : map.removeLayer(layers[which]);
  }
  // Wind needs data the moment it's switched on (reuses a load under 5 min old)
  if (which === 'wind') {
    if (el?.checked) loadWind();
    else windLayer?.clearLayers();
  }
  // Wind probabilities are fetched only while shown, for the selected threshold
  if (which === 'hurprob') {
    if (el?.checked) loadHurricaneProbs();
    else hurProbLayer?.clearLayers();
  }
  updateFieldState();
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
  // Wind stations: exact ICAO/buoy ID, or name (only once loaded, i.e. layer used)
  let stationHits = 0;
  for (const obs of windData) {
    if (stationHits >= 3) break;
    const code = (obs.props.ICAO || obs.props.STATIONID || '').toLowerCase();
    const name = (obs.props.STATION_NAME || '').toLowerCase();
    if (code === q || (q.length >= 3 && name.includes(q))) {
      stationHits++;
      add('Wind', '#83c092', obs.props.STATION_NAME || `Buoy ${obs.props.STATIONID}`,
          [obs.props.ICAO, obs.props.COUNTRY].filter(Boolean).join(' · ') || 'NDBC buoy',
          () => flyToWindStation(obs));
    }
  }
  for (const event of gdacsData) {
    if (hits.length >= 13 + stationHits) break;
    if (`${event.name || ''} ${event.country || ''}`.toLowerCase().includes(q)) {
      add('GDACS', '#a7c080', event.name || event.type,
          event.country || '', () => flyToGDACS(event.guid));
    }
  }
  for (const volcano of vhpData) {
    if (hits.length >= 16 + stationHits) break;
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
// Ring colour by age: past hour white, past day amber, past week tan, older grey
function eqAgeColor(ageMs) {
  if (ageMs < 3_600_000)       return '#ffffff';
  if (ageMs < 86_400_000)      return '#f5b841';
  if (ageMs < 7 * 86_400_000)  return '#c9a66b';
  return '#9aa3a0';
}

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
    const radius = Math.max(4, mag * 3.8);
    const ageMs  = Date.now() - (props.time || 0);
    const isRecent = ageMs < 3600_000; // < 1 hour

    // Hollow rings: size = magnitude, colour = age (the USGS convention). Rings
    // keep severity colours free for alerts and never hide what's beneath.
    const ring = eqAgeColor(ageMs);
    const marker = L.circleMarker([lat, lon], {
      radius,
      color:       ring,
      weight:      isRecent ? 2.5 : 1.8,
      opacity:     0.95,
      fillColor:   ring,
      fillOpacity: 0.1,
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
    const eventName = props.event || '';
    // Colour = severity; line style = product type. Floods keep the severity
    // colour (green vanished into radar echoes) and get a blue edge instead.
    const color = sevColor[props.severity] || '#aaa';
    const flood = /flood/i.test(eventName);

    try {
      const layer = casedGeoJSON(alert.geometry, {
        style: {
          color,
          weight:      2,
          opacity:     0.9,
          fillColor:   color,
          fillOpacity: 0.12,
          dashArray:   ALERT_DASH[alertProductType(eventName)],
          casing:      flood ? '#3d7fc4' : undefined,
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

    // Category badge (dark rounded square + icon): a shape no other layer uses,
    // so EONET events don't read as earthquake rings or alert markers
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({
        html: `<div class="eonet-badge" style="border-color:${cat.color}">${cat.icon}</div>`,
        className: 'leaflet-marker-emoji',
        iconSize:   [22, 22],
        iconAnchor: [11, 11],
        popupAnchor:[0, -12]
      })
    });

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
// SPC storm report convention: tornado red, wind blue, hail green.
// Each type also has its own shape, and all are outlined dark, so they stay
// separable over green radar echoes.
const LSR_COLORS = { torn: '#ff4d4d', wind: '#4d9de0', hail: '#3cb371' };
const LSR_SHAPES = {
  torn: '<polygon points="7,13 1,2 13,2"/>',                     // ▼
  wind: '<rect x="2.5" y="2.5" width="9" height="9"/>',           // ■
  hail: '<circle cx="7" cy="7" r="5"/>',                          // ●
};

function lsrIcon(type) {
  const color = LSR_COLORS[type] || '#859289';
  return L.divIcon({
    className: 'leaflet-marker-emoji',
    html: `<svg width="14" height="14" viewBox="0 0 14 14"><g fill="${color}" stroke="#141a1d" stroke-width="1.4" stroke-linejoin="round">${LSR_SHAPES[type] || LSR_SHAPES.hail}</g></svg>`,
    iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -8],
  });
}
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
    L.marker([report.lat, report.lon], { icon: lsrIcon(report.type), zIndexOffset: report.type === 'torn' ? 150 : 0 })
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

// SPC's own categorical colours (their fill values; the official outlines are
// too dark for a dark basemap). General thunder is drawn without fill, since
// its pale green would sit on top of green radar echoes.
const SPC_RISK = {
  TSTM: { label: 'General Thunderstorms', color: '#c1e9c1', order: 1 },
  MRGL: { label: 'Marginal Risk',          color: '#66a366', order: 2 },
  SLGT: { label: 'Slight Risk',            color: '#ffe066', order: 3 },
  ENH:  { label: 'Enhanced Risk',          color: '#ffa366', order: 4 },
  MDT:  { label: 'Moderate Risk',          color: '#e06666', order: 5 },
  HIGH: { label: 'High Risk',              color: '#ee99ee', order: 6 },
};
// Day 1 solid, day 2 dashed, day 3 dotted, so stacked days stay distinguishable
const OUTLOOK_DAY_DASH = { 1: null, 2: '8 6', 3: '2 5' };

function _buildSpcLayer(geojson, layer, day) {
  layer.clearLayers();
  if (!geojson?.features?.length) return;
  // Sort lowest→highest risk so higher risk renders on top
  const features = [...geojson.features].sort((featA, featB) => {
    const orderA = SPC_RISK[featA.properties.LABEL]?.order ?? 0;
    const orderB = SPC_RISK[featB.properties.LABEL]?.order ?? 0;
    return orderA - orderB;
  });
  casedGeoJSON({ type: 'FeatureCollection', features }, {
    style(feature) {
      const label = feature.properties.LABEL;
      const col   = SPC_RISK[label]?.color ?? '#859289';
      return { color: col, weight: 1.8, opacity: 0.9, fillColor: col, fillOpacity: label === 'TSTM' ? 0 : 0.16,
               dashArray: OUTLOOK_DAY_DASH[day], className: 'spc-fill' };
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
    if (spcD1Layer) _buildSpcLayer(d1, spcD1Layer, 1);
    if (spcD2Layer) _buildSpcLayer(d2, spcD2Layer, 2);
    if (spcD3Layer) _buildSpcLayer(d3, spcD3Layer, 3);
  } catch (err) {
    console.warn('SPC outlook load failed:', err.message);
  }
}

/* ══════════════════════════════════════════════════════
   SPC FIRE WEATHER OUTLOOK — NOAA MapServer
══════════════════════════════════════════════════════ */

// SPC fire weather colours (Critical is pure red in SPC's service; softened
// slightly so it doesn't read as a tornado warning)
const FWX_RISK = {
  5:  { label: 'Elevated',           color: '#e69800' },
  8:  { label: 'Critical',           color: '#ff4d4d' },
  10: { label: 'Extremely Critical', color: '#e600a9' },
};
const FWX_DRY_COLOR = '#c98a4b';

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

function _buildFwxLayer(mainGJ, dryGJ, layer, day) {
  layer.clearLayers();

  // Main categorical risk (Elevated / Critical / Extremely Critical)
  if (mainGJ?.features?.length) {
    const features = [...mainGJ.features]
      .filter(feature => feature.properties.dn && FWX_RISK[feature.properties.dn])
      .sort((featA, featB) => (featA.properties.dn ?? 0) - (featB.properties.dn ?? 0));
    casedGeoJSON({ type: 'FeatureCollection', features }, {
      style(feature) {
        const risk = FWX_RISK[feature.properties.dn];
        const col  = risk?.color ?? '#859289';
        return { color: col, weight: 1.8, opacity: 0.9, fillColor: col, fillOpacity: 0.18,
                 dashArray: OUTLOOK_DAY_DASH[day], className: 'fwx-fill' };
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
      casedGeoJSON({ type: 'FeatureCollection', features: dryFeatures }, {
        style() {
          return { color: FWX_DRY_COLOR, weight: 2, opacity: 0.9, dashArray: '1 5', lineCap: 'round', fill: false };
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
    if (fwxD1Layer) _buildFwxLayer(d1main, d1dry, fwxD1Layer, 1);
    if (fwxD2Layer) _buildFwxLayer(d2main, d2dry, fwxD2Layer, 2);
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
  /* USDM's yellow → orange → red order, adapted for the dark basemap. The
     official D3/D4 (#e60000, #730000) get darker toward the top of the scale,
     which works on white but on dark grey made D4 look like "no drought". Here
     the worst levels are the most saturated and the most opaque. The areas are
     nested (a D4 area also sits inside D3, D2…), so each level's higher
     opacity lets it cover the ones beneath it. */
  { dm:0, label:'D0 — Abnormally Dry',    color:'#f4e04d', fill:0.30, bg:'#3b3a1f' },
  { dm:1, label:'D1 — Moderate Drought',  color:'#f6b74a', fill:0.42, bg:'#3d3526' },
  { dm:2, label:'D2 — Severe Drought',    color:'#f07c1e', fill:0.50, bg:'#3d3020' },
  { dm:3, label:'D3 — Extreme Drought',   color:'#e0352b', fill:0.58, bg:'#3d2222' },
  { dm:4, label:'D4 — Exceptional Drought',color:'#c2185b', fill:0.68, bg:'#3a1a28' },
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
  casedGeoJSON(droughtData, {
    style: feature => {
      const level = DM_LEVELS.find(entry => entry.dm === feature.properties?.DM);
      return {
        color:       level?.color || '#859289',
        weight:      1.2,
        opacity:     0.95,
        fillColor:   level?.color || '#859289',
        fillOpacity: level?.fill ?? 0.3,
        field:       true,
      };
    },
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
   SURFACE WIND — observed station barbs
   METAR airport stations (~5,650) and NDBC buoys (~930) worldwide via the
   Esri Living Atlas "Current Weather and Wind Station Data" feed. CORS-enabled,
   cached 5 min upstream. The whole set is two requests (~320 KB gzip) every
   10 minutes; panning and zooming only re-thin what is already loaded.
   Feed units: wind km/h, temperatures °F, pressure hPa, visibility m.
══════════════════════════════════════════════════════ */

const WIND_BASE = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/NOAA_METAR_current_wind_speed_direction_v1/FeatureServer';
const WIND_STATION_FIELDS = 'ICAO,STATION_NAME,COUNTRY,OBS_DATETIME,TEMP,DEW_POINT,R_HUMIDITY,WIND_DIRECT,WIND_SPEED,WIND_GUST,VISIBILITY,PRESSURE,SKY_CONDTN,FLT_CATEGORY';
const WIND_BUOY_FIELDS    = 'STATIONID,OBS_DATETIME,WIND_DIRECT,WIND_SPEED,WIND_GUST,AIR_TEMP,WATER_TEMP,DEWPOINT_TEMP,ATM_PRESSURE,WAVE_HEIGHT,DOM_WAVE_PERIOD,VISIBILITY';
const WIND_MAX_AGE_MS = 3 * 3_600_000;   // ~10% of reports are stale, some by weeks
const WIND_MAX_KMH    = 300;             // sanity cap for corrupt reports
const WIND_CELL_PX    = 64;              // one barb per cell of this size on screen

let windData = [];           // cleaned observations: { lat, lon, knots, dir, props, kind }
let _windLoadedAt = 0;
let _windDebounce = null;

const kmhToKt = kmh => kmh / 1.852;
const fToC    = f => (f - 32) * 5 / 9;

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
// Barbs are monochrome, the meteorological convention: the glyph already
// encodes speed, and colour stays free for alerts and categories drawn nearby.
const WIND_BARB_COLOR = '#ece8dc';

function windBarbIcon(knots, dirDeg) {
  const cx = 22, cy = 22, tipY = 5;
  const color = WIND_BARB_COLOR;
  let shapes = '';

  if (knots < 2 || dirDeg == null) {
    // Calm, or variable with no reported direction — open circle, no staff
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

  /* Only the glyph is clickable: the 44 px box ignores the pointer (CSS on
     .wind-barb-icon) and an invisible 9 px-wide copy of the strokes, rotated
     with the barb, takes the clicks. Clicks and double-clicks elsewhere in the
     box reach whatever lies underneath (storm reports, alert areas, the map). */
  const calm = knots < 2 || dirDeg == null;
  const hit = calm
    ? `<circle class="barb-hit" cx="${cx}" cy="${cy}" r="7" fill="transparent" stroke="transparent" stroke-width="3"/>`
    : `<g class="barb-hit" stroke="transparent" stroke-width="9" fill="transparent" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`;

  const html =
    `<svg width="44" height="44" viewBox="0 0 44 44" style="overflow:visible">` +
      `<g transform="rotate(${dirDeg ?? 0} ${cx} ${cy})">` +
        g('rgba(0,0,0,0.85)', 4.0, 'rgba(0,0,0,0.85)') +   // halo
        g(color, 1.6, color) +                             // glyph
        hit +
      `</g>` +
    `</svg>`;

  return L.divIcon({
    html,
    className:  'leaflet-marker-emoji wind-barb-icon',
    iconSize:   [44, 44],
    iconAnchor: [22, 22],
    popupAnchor:[0, -16],
  });
}

// Fetch every station and buoy (two requests), clean, and keep in windData
async function loadWind(force = false) {
  if (!map || !windLayer) return;
  // Only fetch while the layer is on, and not again within the feed's 5-min cache
  if (!document.getElementById('toggle-wind')?.checked) return;
  if (!force && windData.length && Date.now() - _windLoadedAt < 5 * 60_000) { plotWind(); return; }

  const query = (layerId, fields) => {
    const params = new URLSearchParams({ where: '1=1', outFields: fields, geometryPrecision: '3', f: 'geojson' });
    return fetch(`${WIND_BASE}/${layerId}/query?${params}`, { signal: AbortSignal.timeout(30000) })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(payload => { if (payload.error) throw new Error(payload.error.message); return payload.features || []; });
  };
  try {
    const [stations, buoys] = await Promise.all([query(0, WIND_STATION_FIELDS), query(1, WIND_BUOY_FIELDS)]);
    const now = Date.now();
    const clean = (features, kind) => features.flatMap(feature => {
      const props = feature.properties;
      const kmh   = props.WIND_SPEED;
      if (typeof kmh !== 'number' || kmh < 0 || kmh > WIND_MAX_KMH) return [];
      if (!props.OBS_DATETIME || now - props.OBS_DATETIME > WIND_MAX_AGE_MS) return [];
      // The feed occasionally includes a station with no location
      if (!Array.isArray(feature.geometry?.coordinates)) return [];
      const [lon, lat] = feature.geometry.coordinates;
      const dir = typeof props.WIND_DIRECT === 'number' ? props.WIND_DIRECT % 360 : null;
      return [{ lat, lon, knots: kmhToKt(kmh), dir, props, kind }];
    });
    windData = [...clean(stations, 'station'), ...clean(buoys, 'buoy')];
    _windLoadedAt = now;
  } catch (err) {
    console.warn('Wind stations load failed:', err.message);
    return;
  }
  plotWind();
  noteDataLoaded();
}

/* One barb per WIND_CELL_PX square. Cells are fixed to the map's pixel grid at
   the current zoom (not the screen), so panning never swaps which station
   represents a cell. Within a cell the station nearest the cell centre wins:
   representative and stable across refreshes, where "strongest wind" would
   exaggerate conditions when zoomed out. */
function plotWind() {
  if (!windLayer) return;
  windLayer.clearLayers();
  if (!windData.length) return;

  const zoom   = map.getZoom();
  const view   = map.getBounds().pad(0.1);
  const cells  = new Map();
  for (const obs of windData) {
    if (!view.contains([obs.lat, obs.lon])) continue;
    const pt  = map.project([obs.lat, obs.lon], zoom);
    const cx  = Math.floor(pt.x / WIND_CELL_PX), cy = Math.floor(pt.y / WIND_CELL_PX);
    const key = `${cx},${cy}`;
    const dx  = pt.x - (cx + 0.5) * WIND_CELL_PX, dy = pt.y - (cy + 0.5) * WIND_CELL_PX;
    const dist = dx * dx + dy * dy;
    const cell = cells.get(key);
    if (!cell) cells.set(key, { obs, dist, count: 1 });
    else {
      cell.count++;
      if (dist < cell.dist) { cell.obs = obs; cell.dist = dist; }
    }
  }

  for (const { obs, count } of cells.values()) {
    const marker = L.marker([obs.lat, obs.lon], {
      icon: windBarbIcon(obs.knots, obs.knots < 2 ? 0 : obs.dir),
      zIndexOffset: 300,
    });
    // Popup HTML is built on open, so thousands of hidden strings aren't made per pan
    marker.bindPopup(() => windPopupHtml(obs, count - 1));
    windLayer.addLayer(marker);
  }
}

function windPopupHtml(obs, hiddenNearby) {
  const props = obs.props;
  const row   = (label, value) => value == null || value === '' ? '' : `<div class="popup-row"><span>${label}</span><span>${value}</span></div>`;
  const temp  = f => typeof f === 'number' ? `${Math.round(fToC(f))} °C (${Math.round(f)} °F)` : null;
  const kt    = kmh => typeof kmh === 'number' && kmh > 0 ? `${Math.round(kmhToKt(kmh))} kt (${Math.round(kmh)} km/h)` : null;
  const wind  = obs.knots < 2 ? 'Calm'
    : `<span style="color:${windColor(obs.knots)};font-weight:600">${Math.round(obs.knots)} kt</span> ` +
      (obs.dir == null ? 'variable' : `from ${compassPoint(obs.dir)} (${Math.round(obs.dir)}°)`);
  const isBuoy = obs.kind === 'buoy';
  const title  = isBuoy ? `🌊 Buoy ${esc(props.STATIONID)}`
                        : `💨 ${esc(props.STATION_NAME || props.ICAO)}${props.ICAO ? ` <span style="opacity:.6">${esc(props.ICAO)}</span>` : ''}`;
  const sub    = isBuoy ? 'NDBC moored buoy' : esc(props.COUNTRY || '');
  // "Few Clouds at 270 meters AGL, Overcast Cloud Deck at 580 meters AGL" → "Few 270 m · Overcast 580 m"
  const sky = props.SKY_CONDTN ? props.SKY_CONDTN.split(/,\s*/).map(layer => layer
      .replace(/\s*Cloud(s| Deck)?\s*/i, ' ').replace(/\s*at\s+(\d+)\s*meters?\s*AGL/i, ' $1 m').replace(/\s+/g, ' ').trim())
      .join(' · ') : null;
  const vis    = typeof props.VISIBILITY === 'number' && props.VISIBILITY > 0
    ? `${props.VISIBILITY >= 16000 ? '16+' : (props.VISIBILITY / 1000).toFixed(1)} km` : null;
  return `<div class="popup-inner">
    <div class="popup-title">${title}</div>
    <div class="popup-sub">${sub}</div>
    ${row('Observed', fmtTime(new Date(props.OBS_DATETIME).toISOString()))}
    ${row('Wind', wind)}
    ${row('Gusts', kt(props.WIND_GUST))}
    ${row('Temperature', temp(isBuoy ? props.AIR_TEMP : props.TEMP))}
    ${row('Dew point', [temp(isBuoy ? props.DEWPOINT_TEMP : props.DEW_POINT), !isBuoy && typeof props.R_HUMIDITY === 'number' ? `${props.R_HUMIDITY}% RH` : null].filter(Boolean).join(' · ') || null)}
    ${isBuoy ? row('Water', temp(props.WATER_TEMP)) : ''}
    ${isBuoy && typeof props.WAVE_HEIGHT === 'number' ? row('Waves', `${props.WAVE_HEIGHT} m${props.DOM_WAVE_PERIOD ? ` every ${props.DOM_WAVE_PERIOD} s` : ''}`) : ''}
    ${row('Pressure', typeof (isBuoy ? props.ATM_PRESSURE : props.PRESSURE) === 'number' ? `${(isBuoy ? props.ATM_PRESSURE : props.PRESSURE).toFixed(1)} hPa` : null)}
    ${row('Visibility', [vis, !isBuoy && props.FLT_CATEGORY ? esc(props.FLT_CATEGORY) : null].filter(Boolean).join(' · ') || null)}
    ${isBuoy ? '' : row('Sky', sky ? esc(sky) : null)}
    ${hiddenNearby > 0 ? `<div class="popup-row" style="font-size:10px;color:var(--muted)">+${hiddenNearby} nearby station${hiddenNearby === 1 ? '' : 's'}, zoom in to see</div>` : ''}
    <div class="popup-row" style="font-size:10px;color:var(--muted)">Barb points into the wind · observed ${isBuoy ? 'at the buoy' : 'at 10 m'}</div>
  </div>`;
}

// Open a station's popup, zooming in far enough that it has its own cell
function flyToWindStation(obs) {
  ensureLayerOn('wind');
  map.flyTo([obs.lat, obs.lon], Math.max(map.getZoom(), 10), { duration: 1 });
  map.once('moveend', () => {
    clearTimeout(_windDebounce);     // the general moveend re-thin would close the popup
    plotWind();
    windLayer.eachLayer(marker => {
      const ll = marker.getLatLng();
      if (Math.abs(ll.lat - obs.lat) < 1e-6 && Math.abs(ll.lng - obs.lon) < 1e-6) marker.openPopup();
    });
  });
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
  return { color: '#a9b1ab', label: 'Statement' };
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
  casedGeoJSON({ type: 'FeatureCollection', features: mscData }, {
    style(feature) {
      const severity = mscSeverity(feature.properties.alert_type);
      return { color: severity.color, weight: 2, opacity: 0.9, fillColor: severity.color, fillOpacity: 0.12,
               dashArray: ALERT_DASH[severity.label.toLowerCase()] };
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
  // Polygons sit inside the cased group, so search every level
  eachLeafLayer(mscLayer, polygonLayer => {
    if (polygonLayer._mscId !== identifier) return;
    try {
      const bounds = polygonLayer.getBounds?.();
      if (bounds?.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 8, duration: 1 });
    } catch {}
    polygonLayer.openPopup();
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
  // Green means "no significant impact expected": a small outline-only diamond,
  // so dozens of green wildfire/flood notices don't bury Orange and Red alerts
  if (level === 'Green') {
    return L.divIcon({
      html: `<div class="gdacs-minor"><div style="border-color:${col}"><span style="color:${col}">${lbl}</span></div></div>`,
      className:   'leaflet-marker-emoji',
      iconSize:    [24, 24],
      iconAnchor:  [12, 12],
      popupAnchor: [0, -13],
    });
  }
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
    const marker = L.marker([event.lat, event.lon], {
      icon: gdacsMarkerIcon(event.type, event.level),
      zIndexOffset: { Red: 200, Orange: 100 }[event.level] || 0,   // significant alerts on top
    });
    marker._gdacsGuid = event.guid;
    marker.bindPopup(`<div class="popup-inner">
      <div class="popup-title">${icon} ${esc(event.name || lbl)}</div>
      <div class="popup-row"><span>Type</span><span>${esc(lbl)}</span></div>
      <div class="popup-row"><span>Alert</span><span style="color:${col};font-weight:600">${esc(event.level)}</span></div>
      ${event.country  ? `<div class="popup-row"><span>Country</span><span>${esc(event.country)}</span></div>` : ''}
      ${gdacsRows(event).map(([label, value, cls]) =>
        `<div class="popup-row"><span>${esc(label)}</span><span${cls ? ` class="${cls}"` : ''}>${esc(value)}</span></div>`).join('')}
      ${event.type === 'TC' && event.name ? `<div class="popup-row"><a href="#" onclick="flyToHurricane('${esc(event.name.replace(/-\d+$/, '').replace(/'/g, ''))}');return false">Show forecast track →</a></div>` : ''}
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
   TROPICAL CYCLONES — NHC (Atlantic, E/C Pacific) + JTWC (elsewhere)
   Esri Living Atlas "Active Hurricanes, Cyclones and Typhoons" feature
   service. CORS-enabled GeoJSON, cached 5 min upstream; advisories are
   issued every 3–6 h. Polygons are simplified server-side (0.02°), which
   cuts the wind-probability layers from ~870 KB to ~20 KB.
══════════════════════════════════════════════════════ */

const HUR_BASE  = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
const HUR_LAYER = { fcstPoints: 0, obsPoints: 1, fcstTrack: 2, obsTrack: 3, cone: 4, watches: 5 };
const HUR_PROB_LAYER = { 34: 7, 50: 8, 64: 9 };
const HUR_PROB_LEVELS = [10, 50, 90];          // contour thresholds drawn as outlines

// Saffir-Simpson class from sustained wind in knots
const HUR_CLASSES = [
  { max: 34,       label: 'Tropical Depression', short: 'TD', color: '#7fbbb3' },
  { max: 64,       label: 'Tropical Storm',      short: 'TS', color: '#a7c080' },
  { max: 83,       label: 'Category 1',          short: '1',  color: '#dbbc7f' },
  { max: 96,       label: 'Category 2',          short: '2',  color: '#e69875' },
  { max: 113,      label: 'Category 3',          short: '3',  color: '#e67e80' },
  { max: 137,      label: 'Category 4',          short: '4',  color: '#d699b6' },
  { max: Infinity, label: 'Category 5',          short: '5',  color: '#ff79c6' },
];
const HUR_WEAK = { label: 'Post-tropical / low', short: 'L', color: '#859289' };
const hurClass = kt => HUR_CLASSES.find(cls => kt < cls.max);

// NHC's own watch/warning colours: TS watch yellow, TS warning blue,
// hurricane watch pink, hurricane warning red. Watches are also dashed.
const HUR_WATCH = {
  TWA: { label: 'Tropical Storm Watch',   color: '#f2d94e', dash: '9 6' },
  TWR: { label: 'Tropical Storm Warning', color: '#4d8fe0', dash: null  },
  HWA: { label: 'Hurricane Watch',        color: '#ff8fd8', dash: '9 6' },
  HWR: { label: 'Hurricane Warning',      color: '#ff4d4d', dash: null  },
};

const hurAgency = basin => ['AL', 'EP', 'CP'].includes(basin) ? 'NHC' : 'JTWC';
const hurKmh    = kt => Math.round(kt * 1.852);

let hurData = { fcstPoints: [], obsPoints: [], fcstTrack: [], obsTrack: [], cone: [], watches: [] };
let hurLayer, hurProbLayer;

function hurQuery(layerId, { simplify = false, where = '1=1' } = {}) {
  const params = new URLSearchParams({ where, outFields: '*', f: 'geojson' });
  if (simplify) { params.set('maxAllowableOffset', '0.02'); params.set('geometryPrecision', '3'); }
  return fetch(`${HUR_BASE}/${layerId}/query?${params}`, { signal: AbortSignal.timeout(20000) })
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(payload => { if (payload.error) throw new Error(payload.error.message); return payload.features || []; })
    .then(features => features.filter(feature => feature.geometry?.coordinates));   // skip records with no location
}

/* ── Antimeridian ─────────────────────────────────────────────────
   A West Pacific track running 175°E → 175°W would otherwise draw a line
   across the whole map. Any storm with coordinates on both sides of ±180°
   is moved onto a continuous 0–360° longitude range. The map stops at 180°,
   so the part past the line is off-screen rather than smeared across it. */
function hurEachCoord(geometry, fn) {
  const walk = coords => typeof coords[0] === 'number' ? fn(coords) : coords.forEach(walk);
  if (geometry?.coordinates) walk(geometry.coordinates);
}

function hurCrossesDateline(features) {
  let east = false, west = false;
  for (const feature of features) hurEachCoord(feature.geometry, ([lon]) => {
    if (lon > 90) east = true; else if (lon < -90) west = true;
  });
  return east && west;
}

function hurShiftEast(feature) {
  hurEachCoord(feature.geometry, coord => { if (coord[0] < 0) coord[0] += 360; });
}

// Storm names that straddle the line, from every layer that carries a name
function hurFixDateline(data) {
  const byStorm = {};
  for (const features of Object.values(data)) {
    for (const feature of features) (byStorm[feature.properties.STORMNAME] ||= []).push(feature);
  }
  for (const features of Object.values(byStorm)) {
    if (hurCrossesDateline(features)) features.forEach(hurShiftEast);
  }
}

/* Forecast hour for each forecast point, stored as props._tau. NHC fills in
   TAU; JTWC storms have TAU 0 on every point, so for those it is worked out
   from VALIDTIME ("DD/HHMM" UTC) relative to the storm's first point. */
function hurAssignForecastHours(points) {
  const byStorm = {};
  for (const feature of points) (byStorm[feature.properties.STORMNAME] ||= []).push(feature);
  for (const features of Object.values(byStorm)) {
    if (features.some(f => f.properties.TAU > 0)) {
      features.forEach(f => { f.properties._tau = f.properties.TAU; });
      continue;
    }
    const adv = new Date(features[0].properties.ADVDATE || Date.now());
    const validMs = props => {
      const match = /^(\d{1,2})\/(\d{2})(\d{2})$/.exec(props.VALIDTIME || '');
      if (!match) return NaN;
      let month = adv.getUTCMonth();
      if (+match[1] < adv.getUTCDate() - 15) month++;          // valid time rolled into next month
      return Date.UTC(adv.getUTCFullYear(), month, +match[1], +match[2], +match[3]);
    };
    const times = features.map(f => validMs(f.properties));
    const first = Math.min(...times.filter(Number.isFinite));
    features.forEach((f, idx) => {
      f.properties._tau = Number.isFinite(times[idx]) ? Math.round((times[idx] - first) / 3_600_000) : 0;
    });
  }
}

async function loadHurricanes() {
  try {
    const entries = await Promise.all(Object.entries(HUR_LAYER).map(async ([key, id]) =>
      [key, await hurQuery(id, { simplify: key === 'cone' })]));
    const data = Object.fromEntries(entries);
    hurFixDateline(data);
    hurAssignForecastHours(data.fcstPoints);
    hurData = data;
  } catch (err) {
    console.warn('Tropical cyclone load failed:', err.message);
    return;
  }
  plotHurricanes();
  noteDataLoaded();
}

function hurTimeRow(label, ms) {
  return ms ? `<div class="popup-row"><span>${label}</span><span>${fmtTime(new Date(ms).toISOString())}</span></div>` : '';
}

function hurPressureRow(mb) {
  return mb > 0 && mb < 9999 ? `<div class="popup-row"><span>Pressure</span><span>${mb} mb</span></div>` : '';
}

function hurWindRows(kt, gust) {
  const cls = hurClass(kt);
  return `<div class="popup-row"><span>Max wind</span><span style="color:${cls.color};font-weight:600">${kt} kt (${hurKmh(kt)} km/h)</span></div>
    ${gust > 0 && gust < 9999 ? `<div class="popup-row"><span>Gusts</span><span>${gust} kt (${hurKmh(gust)} km/h)</span></div>` : ''}
    <div class="popup-row"><span>Class</span><span>${cls.label}</span></div>`;
}

function plotHurricanes() {
  if (!hurLayer) return;
  hurLayer.clearLayers();
  const { cone, obsTrack, fcstTrack, watches, obsPoints, fcstPoints } = hurData;

  // Cone first so tracks and points draw over it
  casedGeoJSON({ type: 'FeatureCollection', features: cone }, {
    style: { color: '#ffffff', weight: 1.4, opacity: 0.85, fillColor: '#ffffff', fillOpacity: 0.07 },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      layer.bindPopup(`<div class="popup-inner">
        <div class="popup-title">🌀 ${esc(props.STORMNAME)} — forecast cone</div>
        <div class="popup-sub">Probable path of the centre, not the size of the storm</div>
        <div class="popup-row"><span>Forecast period</span><span>${props.FCSTPRD} h</span></div>
        ${props.MAX_WIND ? `<div class="popup-row"><span>Peak forecast wind</span><span>${props.MAX_WIND} kt (${hurKmh(props.MAX_WIND)} km/h)</span></div>` : ''}
        ${props.MAX_LABEL ? `<div class="popup-row"><span>Peak at</span><span>${esc(props.MAX_LABEL)}</span></div>` : ''}
        <div class="popup-row"><span>Source</span><span>${hurAgency(props.BASIN)} advisory ${esc(props.ADVISNUM || '')}</span></div>
      </div>`);
    },
  }).addTo(hurLayer);

  // Coastal watches and warnings
  casedGeoJSON({ type: 'FeatureCollection', features: watches }, {
    style: feature => {
      const watch = HUR_WATCH[feature.properties.TCWW] || { color: '#dbbc7f', dash: null };
      return { color: watch.color, weight: 5, opacity: 0.95, dashArray: watch.dash, lineCap: 'butt' };
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      const label = HUR_WATCH[props.TCWW]?.label || props.TCWW;
      layer.bindPopup(`<div class="popup-inner">
        <div class="popup-title">🌀 ${esc(props.STORMNAME)}</div>
        <div class="popup-sub" style="color:${HUR_WATCH[props.TCWW]?.color || '#dbbc7f'}">${esc(label)}</div>
        <div class="popup-row"><span>Source</span><span>${hurAgency(props.BASIN)} advisory ${esc(props.ADVISNUM || '')}</span></div>
      </div>`);
    },
  }).addTo(hurLayer);

  // Past track: solid, coloured by the storm's stage on each segment
  L.geoJSON({ type: 'FeatureCollection', features: obsTrack }, {
    style: feature => {
      const { STORMTYPE: stage, SS: cat } = feature.properties;
      const color = /hurricane|typhoon/i.test(stage || '') ? HUR_CLASSES[Math.min(6, 1 + Math.max(1, cat || 1))].color
        : /storm/i.test(stage || '') ? HUR_CLASSES[1].color
        : /depression/i.test(stage || '') ? HUR_CLASSES[0].color : HUR_WEAK.color;
      return { color, weight: 2.5, opacity: 0.9 };
    },
    interactive: false,
  }).addTo(hurLayer);

  // Forecast track: dashed white centreline
  L.geoJSON({ type: 'FeatureCollection', features: fcstTrack }, {
    style: { color: '#ffffff', weight: 1.8, opacity: 0.85, dashArray: '5 5' },
    interactive: false,
  }).addTo(hurLayer);

  // Past positions: small dots
  for (const feature of obsPoints) {
    const props = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    const kt = props.INTENSITY || 0;
    const cls = /disturbance|low/i.test(props.STORMTYPE || '') ? HUR_WEAK : hurClass(kt);
    L.circleMarker([lat, lon], { radius: 3, weight: 1, color: '#1e2326', fillColor: cls.color, fillOpacity: 1 })
      .bindPopup(`<div class="popup-inner">
        <div class="popup-title">🌀 ${esc(props.STORMNAME)} — past position</div>
        <div class="popup-sub">${esc((props.STORMTYPE || '').replace(/\d+$/, ''))}</div>
        ${hurTimeRow('Time', props.DTG)}
        ${kt ? hurWindRows(kt, 0) : ''}
        ${hurPressureRow(props.MSLP)}
      </div>`)
      .addTo(hurLayer);
  }

  // Forecast positions: larger dots with the class letter/number
  for (const feature of fcstPoints) {
    const props = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    const post = /post/i.test(props.STORMSRC || '') || !props.MAXWIND;
    const cls  = post ? HUR_WEAK : hurClass(props.MAXWIND);
    const now  = props._tau === 0;
    const icon = L.divIcon({
      className: 'leaflet-marker-emoji',
      html: `<div class="hur-point${now ? ' hur-point-now' : ''}" style="background:${cls.color}">${cls.short}</div>`,
      iconSize: now ? [22, 22] : [16, 16],
      iconAnchor: now ? [11, 11] : [8, 8],
      popupAnchor: [0, -10],
    });
    const motion = props.TCDIR > 0 && props.TCDIR < 9999
      ? `<div class="popup-row"><span>Moving</span><span>${compassPoint(props.TCDIR)} at ${props.TCSPD} kt</span></div>` : '';
    L.marker([lat, lon], { icon, zIndexOffset: now ? 500 : 400 })
      .bindPopup(`<div class="popup-inner">
        <div class="popup-title">🌀 ${esc(props.STORMNAME)}${now ? '' : ` — +${props._tau} h`}</div>
        <div class="popup-sub" style="color:${cls.color}">${esc(props.TCDVLP || cls.label)} · ${esc(props.FLDATELBL || props.DATELBL || '')}</div>
        ${props.MAXWIND ? hurWindRows(props.MAXWIND, props.GUST) : ''}
        ${hurPressureRow(props.MSLP)}
        ${motion}
        <div class="popup-row"><span>Source</span><span>${hurAgency(props.BASIN)} advisory ${esc(props.ADVISNUM || '')}</span></div>
      </div>`)
      .addTo(hurLayer);
  }
}

/* ── Wind speed probabilities (5-day) ─────────────────────────────
   Drawn as outlines at 10/50/90% rather than filled bands, so they stay
   readable over SST, radar and other filled layers. Each band is a ring;
   its outer edge is the contour for that threshold. */
async function loadHurricaneProbs() {
  if (!hurProbLayer || !document.getElementById('toggle-hurprob')?.checked) return;
  const kt = document.getElementById('hurprob-kt')?.value || '34';
  let features;
  try {
    features = await hurQuery(HUR_PROB_LAYER[kt], { simplify: true, where: `PWIND120 IN (${HUR_PROB_LEVELS.join(',')})` });
  } catch (err) {
    console.warn('Wind probability load failed:', err.message);
    return;
  }
  // Probability features carry no storm name, so each is checked on its own
  for (const feature of features) if (hurCrossesDateline([feature])) hurShiftEast(feature);

  hurProbLayer.clearLayers();
  const weight = { 10: 1, 50: 1.6, 90: 2.4 };
  for (const feature of features) {
    const pct   = feature.properties.PWIND120;
    const polys = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    for (const [outer] of polys) {
      const latlngs = outer.map(([lon, lat]) => [lat, lon]);
      const line = L.polyline(latlngs, {
        color: '#e0b0f0', weight: weight[pct] || 1, opacity: 0.95,
        dashArray: pct === 10 ? '2 4' : null,
      }).bindTooltip(`${pct}% chance of ${kt} kt+ winds within 5 days`, { sticky: true });
      line.addTo(hurProbLayer);
      // Permanent label at the northernmost point of each contour
      const top = latlngs.reduce((best, pt) => pt[0] > best[0] ? pt : best, latlngs[0]);
      L.tooltip({ permanent: true, direction: 'center', className: 'hur-prob-label', interactive: false })
        .setLatLng(top).setContent(`${pct}%`).addTo(hurProbLayer);
    }
  }
  noteDataLoaded();
}

// Fly to a storm's current position (GDACS cyclone popups link here)
function flyToHurricane(name) {
  ensureLayerOn('hur');
  const key   = String(name).toLowerCase();
  const point = hurData.fcstPoints.find(f => f.properties.STORMNAME?.toLowerCase() === key && f.properties._tau === 0)
             || hurData.obsPoints.filter(f => f.properties.STORMNAME?.toLowerCase() === key).at(-1);
  const cone  = hurData.cone.find(f => f.properties.STORMNAME?.toLowerCase() === key);
  if (!map || (!point && !cone)) return;
  if (cone) map.flyToBounds(L.geoJSON(cone).getBounds(), { padding: [30, 30], maxZoom: 6, duration: 1 });
  else      map.flyTo([point.geometry.coordinates[1], point.geometry.coordinates[0]], 5, { duration: 1 });
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

// Set once the worker turns out not to have the /meteoalarm route (an older deploy)
let meteoBundleUnsupported = false;

/* One feed object (or null) per METEOALARM_COUNTRIES entry. The worker's
   /meteoalarm route bundles every country into one request; if it is missing
   or the bundle fails, fall back to one proxied request per country. */
async function fetchMeteoalarmFeeds() {
  if (PROXY_BASE && !meteoBundleUnsupported) {
    try {
      const response = await fetch(`${PROXY_BASE}/meteoalarm?countries=${METEOALARM_COUNTRIES.join(',')}`,
                                   { signal: AbortSignal.timeout(30000) });
      if (response.ok) {
        const bundle = await response.json();
        return METEOALARM_COUNTRIES.map(country => bundle[country] ?? null);
      }
      if (response.status === 400 || response.status === 404) meteoBundleUnsupported = true;
    } catch (err) {
      console.warn('Meteoalarm bundle failed, fetching per country:', err.message);
    }
  }
  const BASE = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-';
  return Promise.all(
    METEOALARM_COUNTRIES.map(country =>
      fetch(proxyUrl(BASE + country), { signal: AbortSignal.timeout(15000) })
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
    )
  );
}

async function loadMeteoalarm() {
  meteoalarmData = [];
  const feeds = await fetchMeteoalarmFeeds();
  feeds.forEach((feed, index) => {
    if (!feed?.warnings) return;
    const country = METEOALARM_COUNTRIES[index];
    feed.warnings.forEach(warning => {
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
      const poly = casedPolygon(warning.coords, {
        color: col, weight: 1.8, opacity: 0.9,
        fillColor: col, fillOpacity: 0.15,
      });
      poly._meteoId = warning.id;
      poly.bindPopup(_meteoPopup(warning));
      meteoalarmLayer.addLayer(poly);
    } else if (warning.centLat != null) {
      const marker = L.marker([warning.centLat, warning.centLon], { icon: alertBadgeIcon(col) });
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
      layer = L.marker([lat, lon], { icon: alertBadgeIcon(col) });
    } else {
      // L.geoJSON handles GeoJSON [lon,lat] → Leaflet [lat,lon] natively
      layer = casedGeoJSON(alert.geometry, {
        style: { color: col, weight: 1.8, opacity: 0.9, fillColor: col, fillOpacity: 0.14,
                 dashArray: ALERT_DASH[alertProductType(alert.event)] },
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
    flyFn:    alert.centLat != null ? `flyToWMO('${alert.id.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : null,
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
    flyFn:    event.lat != null ? `flyToGDACS('${event.guid.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : null,
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
  loadHurricanes();
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
setInterval(loadHurricanes,   600_000);  // Tropical cyclones — advisories every 3–6 h, feed cached 5 min
setInterval(loadHurricaneProbs, 600_000);  // Wind probabilities — no-ops while the layer is off
setInterval(() => loadWind(true), 600_000);  // Wind stations — 10 min (no-ops while layer is off)
setInterval(refreshGibsDailyLayers, 3600_000);  // re-point daily GIBS layers after a UTC date rollover
setInterval(loadRainviewer,   300_000);  // RainViewer refreshes frames ~every 5 min
setInterval(() => { buildGlobalSummary(); }, 60_000);   // Re-evaluate 1-hour window every minute

/* Loaders that go through the CORS worker share its daily request quota, so
   they pause while the tab is hidden. A refresh skipped in the background runs
   as soon as the tab is shown again, and the interval restarts from there. */
function refreshWhileVisible(loader, ms) {
  let timer, missed = false;
  const tick = () => { if (document.hidden) missed = true; else loader(); };
  const schedule = () => { clearInterval(timer); timer = setInterval(tick, ms); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !missed) return;
    missed = false;
    loader();
    schedule();
  });
  schedule();
}
refreshWhileVisible(loadGDACS,      600_000);  // GDACS global disasters — 10 min refresh
refreshWhileVisible(loadMeteoalarm, 600_000);  // Meteoalarm Europe — 10 min refresh
refreshWhileVisible(loadWMO,        600_000);  // WMO SWIC global alerts — 10 min refresh

// Live indicator: re-evaluate on a timer so it goes stale on its own, and
// react immediately to the browser's own connectivity events.
setInterval(refreshLiveIndicator, 30_000);
addEventListener('online',  refreshLiveIndicator);
addEventListener('offline', refreshLiveIndicator);
refreshLiveIndicator();

// Re-thin wind stations when the view settles: local only, no network.
// Re-thinning rebuilds every marker, which would close an open station popup
// (including when the popup's own auto-pan moves the map), so it waits until
// that popup is closed.
const _windPopupOpen = () => map._popup?.isOpen() && windLayer.hasLayer(map._popup._source);
map.on('moveend', () => {
  if (!document.getElementById('toggle-wind')?.checked || _windPopupOpen()) return;
  clearTimeout(_windDebounce);
  _windDebounce = setTimeout(plotWind, 150);
});
map.on('popupclose', event => {
  if (windLayer.hasLayer(event.popup._source) && document.getElementById('toggle-wind')?.checked) {
    clearTimeout(_windDebounce);
    _windDebounce = setTimeout(plotWind, 150);
  }
});
