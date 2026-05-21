'use strict';

/* ═══════════════════════════════════════════════════════════════
   GIS LAZIO — CRI  |  app.js
   ═══════════════════════════════════════════════════════════════ */

/* ─── CONFIG ──────────────────────────────────────────────────── */
const DATA_DIR = './data/';

const LAZIO_CENTER  = [41.88, 12.75];
const LAZIO_ZOOM    = 9;
const LAZIO_BOUNDS  = L.latLngBounds([40.55, 11.05], [42.95, 14.35]);

// Nominatim viewbox: minlon,minlat,maxlon,maxlat
const NOM_VIEWBOX = '11.05,40.55,14.35,42.95';

/* Layer definitions */
const LAYER_DEFS = [
  // ── Polygon: Admin ───────────────────────────────────────────
  {
    id: 'province',
    name: 'Province',
    file: 'province.geojson',
    type: 'polygon',
    group: 'admin',
    color: '#111',
    pane: 'provincePane',
    style: { color: '#111', weight: 2, fillOpacity: 0, opacity: 0.85 },
    defaultOn: true
  },
  {
    id: 'comuni',
    name: 'Comuni',
    file: 'comuni.geojson',
    type: 'polygon',
    group: 'admin',
    color: '#d97706',
    style: { color: '#d97706', weight: 0.9, fillOpacity: 0, opacity: 0.8 },
    defaultOn: false
  },
    {
    id: 'municipi_roma',
    name: 'Municipi di Roma',
    file: 'municipi.geojson',
    type: 'polygon',
    group: 'admin',
    color: '#d97706',
    style: { color: '#d97706', weight: 0.9, fillOpacity: 0, opacity: 0.8 },
    defaultOn: false
  },
  // ── Polygon: Operative ───────────────────────────────────────
  {
    id: 'comitati_cri',
    name: 'Comitati CRI',
    file: 'comitati_cri.geojson',
    type: 'polygon',
    group: 'ops',
    color: '#ec3740',
    style: { color: '#ec3740', weight: 2, fillColor: '#c8000a', fillOpacity: 0 },
    defaultOn: true
  },
  {
    id: 'asl',
    name: 'ASL',
    file: 'asl.geojson',
    type: 'polygon',
    group: 'ops',
    color: '#0d7e56',
    style: { color: '#0d7e56', weight: 2, fillColor: '#0d7e56', fillOpacity: 0 },
    defaultOn: false
  },
  // ── Points ───────────────────────────────────────────────────
  {
    id: 'sedi_cri',
    name: 'Sedi CRI',
    file: 'sedi_cri.geojson',
    type: 'point',
    group: 'poi',
    iconType: 'cri',
    color: '#c8000a',
    defaultOn: true
  },
  {
    id: 'ospedali',
    name: 'Ospedali',
    file: 'ospedali.geojson',
    type: 'point',
    group: 'poi',
    iconType: 'hospital',
    color: '#1565c0',
    defaultOn: false
  }
];

/* ─── STATE ───────────────────────────────────────────────────── */
let map;
let currentBM      = 'streets';
let basemapLayer   = null;
let maskLayer      = null;
let layers         = {};   // { id: L.GeoJSON }
let layerStatus    = {};   // { id: 'ok' | 'missing' | 'error' }
let unitaData      = null; // GeoJSON features for point-in-polygon
let clickMarker    = null;
let searchTimer    = null;

/* ─── CUSTOM PANES ────────────────────────────────────────────── */
function initPanes() {
  map.createPane('maskPane');
  map.getPane('maskPane').style.zIndex = 290;
  map.getPane('maskPane').style.pointerEvents = 'none';

  map.createPane('polyPane');
  map.getPane('polyPane').style.zIndex = 400;

  // Province on top of all other polygon layers
  map.createPane('provincePane');
  map.getPane('provincePane').style.zIndex = 420;
  map.getPane('provincePane').style.pointerEvents = 'none'; // let clicks pass through to map

  map.createPane('pointPane');
  map.getPane('pointPane').style.zIndex = 600;
}

/* ─── ICONS ───────────────────────────────────────────────────── */
function makeSvgIcon(type) {
  const fills = { cri: '#c8000a', hospital: '#1565c0' };
  const bg = fills[type] || fills.cri;

  const innerCRI = `
    <rect x="14" y="8"  width="8" height="20" rx="2" fill="white"/>
    <rect x="8"  y="14" width="20" height="8" rx="2" fill="white"/>`;

  const innerHosp = `
    <text x="18" y="24" text-anchor="middle" fill="white"
      font-size="14" font-weight="700" font-family="Outfit,sans-serif">H</text>`;

  const inner = type === 'cri' ? innerCRI : innerHosp;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="28" height="34">
    <defs>
      <filter id="ds-${type}">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.5"
          flood-color="#000" flood-opacity="0.32"/>
      </filter>
    </defs>
    <path d="M18 2C10.3 2 4 8.3 4 16c0 5.9 3.2 11 8.1 13.7L18 42l5.9-12.3C28.8 27 32 21.9 32 16 32 8.3 25.7 2 18 2z"
      fill="${bg}" filter="url(#ds-${type})"/>
    ${inner}
  </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize:   [28, 34],
    iconAnchor: [14, 34],
    popupAnchor:[0, -36]
  });
}

function makeHospitalIcon(bg) {
  const id = bg.replace('#', '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="28" height="34">
    <defs>
      <filter id="ds-h${id}">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity="0.32"/>
      </filter>
    </defs>
    <path d="M18 2C10.3 2 4 8.3 4 16c0 5.9 3.2 11 8.1 13.7L18 42l5.9-12.3C28.8 27 32 21.9 32 16 32 8.3 25.7 2 18 2z"
      fill="${bg}" filter="url(#ds-h${id})"/>
    <text x="18" y="24" text-anchor="middle" fill="white"
      font-size="14" font-weight="700" font-family="Outfit,sans-serif">H</text>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [28,34], iconAnchor: [14,34], popupAnchor: [0,-36] });
}

const ICONS = {
  cri:            makeSvgIcon('cri'),
  hospital:       makeSvgIcon('hospital'),   // fallback
  hospital_dea2:  makeHospitalIcon('#c8000a'),  // red   – DEA II
  hospital_dea1:  makeHospitalIcon('#c6e900'),  // yellow – DEA I
  hospital_ps:    makeHospitalIcon('#1565c0'),  // blue  – PS
  hospital_other: makeHospitalIcon('#6b7280'),  // gray  – unknown
};

/* ─── BASEMAPS ────────────────────────────────────────────────── */
const BASEMAP_TILES = {
  streets: () => L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>', subdomains: 'abcd', maxZoom: 19 }
  ),
  satellite: () => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP', maxZoom: 19 }
  ),
  topo: () => L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://opentopomap.org/">OpenTopoMap</a>', maxZoom: 17 }
  )
};

function setBasemap(id) {
  // Remove current tile layer
  if (basemapLayer) {
    map.removeLayer(basemapLayer);
    basemapLayer = null;
  }

  if (id === 'white') {
    document.getElementById('map').style.background = '#f0efed';
  } else {
    document.getElementById('map').style.background = '#e8e8e8';
    if (BASEMAP_TILES[id]) {
      basemapLayer = BASEMAP_TILES[id]();
      basemapLayer.addTo(map);
      basemapLayer.bringToBack();
    }
  }

  currentBM = id;

  // Update UI
  document.querySelectorAll('.bm-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.bm === id)
  );
}

/* ─── MAP INIT ────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', {
    center:               LAZIO_CENTER,
    zoom:                 LAZIO_ZOOM,
    minZoom:              7,
    maxZoom:              18,
    maxBounds:            LAZIO_BOUNDS,
    maxBoundsViscosity:   0.95,
    zoomControl:          false,
    attributionControl:   true
  });

  initPanes();

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  // Map click → territory popup
  map.on('click', onMapClick);
}

/* ─── LAYER LOADING ───────────────────────────────────────────── */
async function loadAllLayers() {
  showLoading(true);

  const results = await Promise.allSettled(
    LAYER_DEFS.map(def => loadSingleLayer(def))
  );

  showLoading(false);
}

async function loadSingleLayer(def) {
  try {
    const resp = await fetch(DATA_DIR + def.file);
    if (!resp.ok) {
      layerStatus[def.id] = 'missing';
      markLayerMissing(def.id);
      return { rawData: null, layer: null };
    }

    const data = await resp.json();
    let layer;

    if (def.type === 'polygon') {
      layer = L.geoJSON(data, {
        pane: def.pane || 'polyPane',
        style: def.style
        // clicks propagate naturally to map → onMapClick handles territory popup
      });
    } else if (def.type === 'point') {
      const icon = ICONS[def.iconType] || ICONS.cri;
      layer = L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
          let icon;
          if (def.id === 'ospedali') {
            const tip = (feature.properties?.Tipologia || '').trim();
            if      (tip === 'DEA II') icon = ICONS.hospital_dea2;
            else if (tip === 'DEA I')  icon = ICONS.hospital_dea1;
            else if (tip === 'PS')     icon = ICONS.hospital_ps;
            else                       icon = ICONS.hospital_other;
          } else {
            icon = ICONS[def.iconType] || ICONS.cri;
          }
          return L.marker(latlng, { icon, pane: 'pointPane' });
        },
        onEachFeature(feature, flayer) {
          const name = guessName(feature.properties || {}) || def.name;
          flayer.bindPopup(buildFeaturePopup(feature, def, name), { maxWidth: 260 });
          flayer.on('click', e => L.DomEvent.stopPropagation(e));
        }
      });
    }

    if (layer && def.defaultOn) layer.addTo(map);
    if (layer) layers[def.id] = layer;

    layerStatus[def.id] = 'ok';
    return { rawData: data, layer };

  } catch (err) {
    console.error(`Error loading ${def.file}:`, err);
    layerStatus[def.id] = 'error';
    markLayerMissing(def.id);
    return { rawData: null, layer: null };
  }
}

async function loadUnitaTerritoriali() {
  try {
    const resp = await fetch(DATA_DIR + 'unita_territoriali.geojson');
    if (!resp.ok) {
      console.warn('unita_territoriali.geojson non trovato — il lookup territoriale non sarà disponibile.');
      return;
    }
    unitaData = await resp.json();
    console.info(`✓ Unità territoriali caricate: ${unitaData.features.length} feature`);
  } catch (e) {
    console.warn('Impossibile caricare unita_territoriali:', e);
  }
}

/* ─── TERRITORY LOOKUP ────────────────────────────────────────── */
function queryTerritory(latlng) {
  if (!unitaData?.features) return null;
  const pt = turf.point([latlng.lng, latlng.lat]);

  for (const feature of unitaData.features) {
    if (!feature.geometry) continue;
    try {
      if (turf.booleanPointInPolygon(pt, feature)) {
        return feature.properties;
      }
    } catch (_) { /* skip */ }
  }
  return null;
}

function formatTerritoryInfo(props, label) {
  let html = '';

  if (label) {
    html += `<div class="ip-address">${escHtml(label)}</div>`;
  }

  const isRome = props.DEN_MUNICIPIO && props.DEN_MUNICIPIO.trim() !== '';

  const rows = [
    { key: 'Provincia',       val: props.DEN_PROV  ? `${props.DEN_PROV} (${props.SIGLA_PROV || '?'})` : null },
    { key: 'Comune',          val: props.COMUNE     || null },
    ...(isRome
      ? [{ key: 'Municipio', val: props.DEN_MUNICIPIO }]
      : []
    ),
    { key: 'Comitato CRI',    val: props.COMITATO_CRI     || null, highlight: true },
    { key: 'Canale Radio CRI',val: props.CANALE_RADIO_CRI || null },
    { key: 'ASL',             val: props.ASL               || null }
  ];

  html += '<div class="ip-rows">';
  for (const row of rows) {
    if (!row.val) continue;
    html += `<div class="ip-row${row.highlight ? ' highlight' : ''}">
      <span class="ip-label">${row.key}</span>
      <span class="ip-value">${escHtml(String(row.val))}</span>
    </div>`;
  }
  html += '</div>';

  return html;
}

/* ─── INFO PANEL ──────────────────────────────────────────────── */
function showInfoPanel(props, label = null) {
  const panel  = document.getElementById('info-panel');
  const body   = document.getElementById('ip-body');
  const title  = document.getElementById('ip-title');

  title.textContent = label || 'Posizione selezionata';
  body.innerHTML    = formatTerritoryInfo(props, null);

  panel.classList.remove('hidden');
  // Force reflow before adding 'open' for transition
  panel.getBoundingClientRect();
  panel.classList.add('open');
}

function hideInfoPanel() {
  const panel = document.getElementById('info-panel');
  panel.classList.remove('open');
  // Wait for transition, then hide
  setTimeout(() => panel.classList.add('hidden'), 280);

  if (clickMarker) {
    map.removeLayer(clickMarker);
    clickMarker = null;
  }
}

function showEmptyInfoPanel(message) {
  const panel = document.getElementById('info-panel');
  const body  = document.getElementById('ip-body');
  const title = document.getElementById('ip-title');

  title.textContent = 'Posizione';
  body.innerHTML    = `<p class="ip-empty">${message}</p>`;

  panel.classList.remove('hidden');
  panel.getBoundingClientRect();
  panel.classList.add('open');
}

/* ─── TERRITORY POPUP (map click) ────────────────────────────── */
function formatTerritoryPopup(props) {
  const isRome = !!(props.DEN_MUNICIPIO && props.DEN_MUNICIPIO.trim());

  const title    = isRome ? props.DEN_MUNICIPIO : (props.COMUNE || '—');
  const subtitle = isRome
    ? `Roma &middot; Prov. ${escHtml(props.SIGLA_PROV || 'RM')}`
    : `Prov. ${escHtml(props.DEN_PROV || '—')} (${escHtml(props.SIGLA_PROV || '—')})`;

  const rows = [
    ...(isRome ? [{ k: 'Comune', v: 'Roma' }] : []),
    { k: 'Comitato CRI',  v: props.COMITATO_CRI },
    { k: 'Canale Radio',  v: props.CANALE_RADIO_CRI },
    { k: 'ASL',           v: props.ASL }
  ].filter(r => r.v && String(r.v).trim());

  let html = `<div class="tp">
    <div class="tp-title">${escHtml(title)}</div>
    <div class="tp-sub">${subtitle}</div>`;

  if (rows.length) {
    html += '<div class="tp-rows">';
    for (const r of rows) {
      html += `<div class="tp-row">
        <span class="tp-k">${r.k}</span>
        <span class="tp-v">${escHtml(String(r.v))}</span>
      </div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ─── MAP CLICK ───────────────────────────────────────────────── */
function onMapClick(e) {
  const props = queryTerritory(e.latlng);

  if (!props) {
    // Only show a message if the territory layer is loaded but point is outside
    if (unitaData) {
      L.popup({ maxWidth: 240 })
        .setLatLng(e.latlng)
        .setContent('<div class="tp"><div class="tp-title" style="color:#aaa;font-weight:500">Fuori regione</div></div>')
        .openOn(map);
    }
    return;
  }

  L.popup({ maxWidth: 280, className: 'tp-popup' })
    .setLatLng(e.latlng)
    .setContent(formatTerritoryPopup(props))
    .openOn(map);
}

/* ─── SEARCH ──────────────────────────────────────────────────── */
function initSearch() {
  const input     = document.getElementById('search-input');
  const clearBtn  = document.getElementById('btn-search-clear');
  const dropdown  = document.getElementById('search-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.classList.toggle('hidden', q.length === 0);
    clearTimeout(searchTimer);

    if (q.length < 3) {
      dropdown.classList.add('hidden');
      return;
    }
    searchTimer = setTimeout(() => doSearch(q), 420);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSearch();
  });

  clearBtn.addEventListener('click', clearSearch);

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap') && !e.target.closest('#search-dropdown')) {
      dropdown.classList.add('hidden');
    }
  });
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-dropdown').classList.add('hidden');
  document.getElementById('btn-search-clear').classList.add('hidden');
  if (clickMarker) { map.removeLayer(clickMarker); clickMarker = null; }
}

async function doSearch(query) {
  const dropdown = document.getElementById('search-dropdown');
  dropdown.innerHTML = '<div class="sr-msg">Ricerca in corso…</div>';
  dropdown.classList.remove('hidden');

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', query + ' Lazio');
    url.searchParams.set('viewbox', NOM_VIEWBOX);
    url.searchParams.set('bounded', '0');
    url.searchParams.set('limit', '8');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'it');

    const resp    = await fetch(url.toString(), { headers: { 'Accept-Language': 'it' } });
    const results = await resp.json();

    // Prefer results within Lazio bounds
    const inLazio = results.filter(r => {
      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      return lat >= 40.55 && lat <= 42.95 && lon >= 11.05 && lon <= 14.35;
    });

    const toShow = inLazio.length > 0 ? inLazio.slice(0, 6) : results.slice(0, 4);
    renderSearchResults(toShow, inLazio.length === 0 && results.length > 0);

  } catch (err) {
    dropdown.innerHTML = '<div class="sr-msg" style="color:#c00">Errore di rete. Controlla la connessione.</div>';
  }
}

function renderSearchResults(results, outsideWarning) {
  const dropdown = document.getElementById('search-dropdown');

  if (results.length === 0) {
    dropdown.innerHTML = '<div class="sr-msg">Nessun risultato trovato.</div>';
    return;
  }

  let html = outsideWarning
    ? '<div class="sr-msg" style="color:#c00;font-size:11.5px;">⚠ Risultati fuori dalla regione Lazio</div>'
    : '';

  html += results.map(r => {
    const parts   = r.display_name.split(',');
    const mainStr = parts[0].trim();
    const ctxStr  = parts.slice(1, 3).join(',').trim();
    return `<div class="sr-item" data-lat="${r.lat}" data-lon="${r.lon}"
      data-name="${escHtml(r.display_name)}">
      <div class="sr-main">${escHtml(mainStr)}</div>
      <div class="sr-ctx">${escHtml(ctxStr)}</div>
    </div>`;
  }).join('');

  dropdown.innerHTML = html;

  dropdown.querySelectorAll('.sr-item').forEach(item => {
    item.addEventListener('click', () => {
      const latlng = L.latLng(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
      const name   = item.dataset.name;
      selectSearchResult(latlng, name);
    });
  });
}

function selectSearchResult(latlng, fullName) {
  const dropdown = document.getElementById('search-dropdown');
  const input    = document.getElementById('search-input');

  dropdown.classList.add('hidden');
  input.value = fullName.split(',')[0].trim();

  // Fly to location
  map.flyTo(latlng, Math.max(map.getZoom(), 13), { duration: 1.0 });

  // Remove previous marker
  if (clickMarker) { map.removeLayer(clickMarker); clickMarker = null; }

  const clickIcon = L.divIcon({
    html: '<div class="click-dot"></div>',
    className: '',
    iconSize: [14, 14], iconAnchor: [7, 7]
  });
  clickMarker = L.marker(latlng, { icon: clickIcon, interactive: false, pane: 'pointPane' }).addTo(map);

  // Show territory info (after map moves)
  const show = () => {
    const props = queryTerritory(latlng);
    if (props) {
      const shortLabel = fullName.split(',').slice(0, 2).join(',').trim();
      showInfoPanel(props, shortLabel);
    } else {
      const shortLabel = fullName.split(',').slice(0, 2).join(',').trim();
      showEmptyInfoPanel(
        unitaData
          ? `"${escHtml(shortLabel)}" non è coperta dai dati territoriali o si trova fuori dal Lazio.`
          : `Dati territoriali non disponibili. Carica <code>unita_territoriali.geojson</code> nella cartella <code>data/</code>.`
      );
      document.getElementById('ip-title').textContent = fullName.split(',')[0].trim();
    }
  };

  // Small timeout to let turf work after flyTo starts
  setTimeout(show, 100);
}

/* ─── SIDEBAR ─────────────────────────────────────────────────── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btnOpen = document.getElementById('btn-sb-open');
  const btnClose= document.getElementById('btn-sb-close');

  function openSidebar() {
    sidebar.classList.add('open');
    btnOpen.classList.add('hidden');
    document.body.classList.add('sb-open');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    btnOpen.classList.remove('hidden');
    document.body.classList.remove('sb-open');
  }

  btnOpen.addEventListener('click', openSidebar);
  btnClose.addEventListener('click', closeSidebar);

  // Start open → body has sb-open class
  document.body.classList.add('sb-open');

  // Basemap selector
  document.getElementById('bm-grid').addEventListener('click', e => {
    const btn = e.target.closest('.bm-btn');
    if (btn) setBasemap(btn.dataset.bm);
  });

  // Generate layer toggle rows
  buildLayerToggles();
}

/* Layer toggle markup is built here; actual checkbox event fires toggleLayer() */
function buildLayerToggles() {
  const groupMap = {
    admin: 'layer-admin',
    ops:   'layer-ops',
    poi:   'layer-poi'
  };

  for (const def of LAYER_DEFS) {
    const containerId = groupMap[def.group];
    if (!containerId) continue;
    const container = document.getElementById(containerId);
    if (!container) continue;

    const isPoly  = def.type === 'polygon';
    const swatch  = isPoly
      ? `<span class="layer-swatch poly" style="color:${def.color};border-color:${def.color};"></span>`
      : `<span class="layer-swatch dot" style="background:${def.color};"></span>`;

    container.insertAdjacentHTML('beforeend', `
      <div class="layer-row" id="lrow-${def.id}">
        <label class="layer-toggle" for="chk-${def.id}">
          <input type="checkbox" id="chk-${def.id}" ${def.defaultOn ? 'checked' : ''}>
          <span class="tgl-track"><span class="tgl-thumb"></span></span>
        </label>
        <div class="layer-meta">
          ${swatch}
          <span class="layer-name">${def.name}</span>
        </div>
      </div>
    `);

    document.getElementById(`chk-${def.id}`).addEventListener('change', e => {
      toggleLayer(def.id, e.target.checked);
    });
  }
}

function toggleLayer(id, visible) {
  const layer = layers[id];
  if (!layer) return;
  if (visible && !map.hasLayer(layer)) layer.addTo(map);
  if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
}

function markLayerMissing(id) {
  const row = document.getElementById(`lrow-${id}`);
  if (!row) return;
  const chk = document.getElementById(`chk-${id}`);
  if (chk) { chk.checked = false; chk.disabled = true; }
  const name = row.querySelector('.layer-name');
  if (name) {
    name.style.color = '#4e6a82';
    name.title = 'File dati non trovato nella cartella data/';
    name.textContent += ' (mancante)';
  }
}

/* ─── FEATURE POPUP BUILDER ───────────────────────────────────── */
const SKIP_KEYS = new Set([
  'id', 'ID', 'fid', 'FID', 'OBJECTID', 'objectid',
  'Shape_Area', 'Shape_Leng', 'shape_area', 'shape_leng',
  'SHAPE_AREA', 'SHAPE_LENG'
]);

function guessName(props) {
  const candidates = ['nome', 'NOME', 'name', 'NAME', 'descrizione',
    'DESCRIZIONE', 'denominazione', 'DENOMINAZIONE', 'titolo', 'TITOLO'];
  for (const c of candidates) {
    if (props[c] && String(props[c]).trim()) return String(props[c]).trim();
  }
  return null;
}

function buildFeaturePopup(feature, def, title) {
  const p = feature.properties || {};
  const entries = Object.entries(p)
    .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== null && v !== '' && v !== undefined)
    .slice(0, 10);

  let html = '<div class="fp">';

  const rest = entries.filter(([, v]) => String(v) !== title).slice(0, 8);
  for (const [k, v] of rest) {
    html += `<div class="fp-row">
      <span class="fp-k">${escHtml(k)}</span>
      <span class="fp-v">${escHtml(String(v))}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

/* ─── UTILITIES ───────────────────────────────────────────────── */
function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* ─── MAIN INIT ───────────────────────────────────────────────── */
async function init() {
  initMap();
  setBasemap('streets');  // default basemap
  initSidebar();
  initSearch();

  document.getElementById('btn-ip-close').addEventListener('click', hideInfoPanel);

  // Load data in parallel
  await Promise.all([
    loadAllLayers(),
    loadUnitaTerritoriali()
  ]);
}

document.addEventListener('DOMContentLoaded', init);