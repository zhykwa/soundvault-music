/* ═══════════════════════════════════════════════════
   SoundVault – Player JS  (Green Theme Edition)
   ═══════════════════════════════════════════════════ */
'use strict';

const $ = id => document.getElementById(id);

/* ─── DOM REFERENCES ─────────────────────────────── */
const DOM = {
  searchInput:      $('searchInput'),
  libSearchInput:   $('libSearchInput'),
  sourceChips:      $('sourceChips'),
  trackList:        $('trackList'),
  trackCount:       $('trackCount'),
  centerSongsList:  $('centerSongsList'),
  emptyLibrary:     $('emptyLibrary'),
  gridSection:      $('gridSection'),
  filterBreadcrumb: $('filterBreadcrumb'),
  fbLabel:          $('fbLabel'),
  fbValue:          $('fbValue'),
  btnClearFilter:   $('btnClearFilter'),


  // Hero card (center top)
  heroCoverImg:     $('heroCoverImg'),
  heroCoverFallback:$('heroCoverFallback'),
  heroTag:          $('heroTag'),
  heroTitle:        $('heroTitle'),
  heroSubtitle:     $('heroSubtitle'),
  heroPlayBtn:      $('heroPlayBtn'),
  heroPlayIcon:     $('heroPlayIcon'),
  heroPauseIcon:    $('heroPauseIcon'),

  // Right panel
  rpHeaderTitle:    $('rpHeaderTitle'),
  rpCoverWrap:      $('rpCoverWrap'),
  rpCoverFallback:  $('rpCoverFallback'),
  coverArt:         $('coverArt'),
  npTitle:          $('npTitle'),
  npArtist:         $('npArtist'),
  npAlbum:          $('npAlbum'),
  npFormat:         $('npFormat'),
  npSource:         $('npSource'),
  npSourceText:     $('npSourceText'),
  vizCanvas:        $('vizCanvas'),

  // Bottom bar
  pbArt:            $('pbArt'),
  pbFallback:       $('pbFallback'),
  pbTitle:          $('pbTitle'),
  pbArtist:         $('pbArtist'),

  // Controls
  btnPlay:          $('btnPlay'),
  playIcon:         $('playIcon'),
  pauseIcon:        $('pauseIcon'),
  btnPrev:          $('btnPrev'),
  btnNext:          $('btnNext'),
  btnShuffle:       $('btnShuffle'),
  btnRepeat:        $('btnRepeat'),
  btnRewind:        $('btnRewind'),
  btnForward:       $('btnForward'),
  progressTrack:    $('progressTrack'),
  progressFill:     $('progressFill'),
  timeCurrent:      $('timeCurrent'),
  timeTotal:        $('timeTotal'),
  volSlider:        $('volSlider'),
  qualitySelect:    $('qualitySelect'),
  btnDownloadCurrent: $('btnDownloadCurrent'),
  toastContainer:   $('toastContainer'),
};

/* ─── AUDIO ENGINE ───────────────────────────────── */
const audio = new Audio();
audio.crossOrigin = 'anonymous';
let audioCtx    = null;
let analyser    = null;
let sourceNode  = null;
let vizInited   = false;
let vizRafId    = null;

/* ─── STATE ──────────────────────────────────────── */
let libraryTracks        = [];
let filteredTracks       = [];
let currentIndex         = -1;
let currentSrcFilter     = 'all';
let currentTabFilter     = 'all';
let selectedArtistFilter = null;
let selectedAlbumFilter  = null;
let selectedQuality      = localStorage.getItem('soundvault_quality') || 'original';
let isPlaying            = false;
let isShuffle            = false;
let repeatMode           = 0;   // 0=off  1=all  2=one

/* ═══════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════ */
async function init() {
  bindEvents();
  setupAudio();
  await loadSources();
  await loadLibrary();
}

/* ═══════════════════════════════════════════════════
   EVENT BINDING
   ═══════════════════════════════════════════════════ */
function bindEvents() {
  // Search inputs
  DOM.searchInput.addEventListener('input', () => {
    filterAndRender();
  });
  if (DOM.libSearchInput) {
    DOM.libSearchInput.addEventListener('input', () => {
      filterAndRender();
    });
  }

  // Hero play button
  DOM.heroPlayBtn.addEventListener('click', () => {
    if (currentIndex === -1 && filteredTracks.length > 0) {
      playTrack(0);
    } else {
      togglePlay();
    }
  });

  // Bottom bar controls
  DOM.btnPlay.addEventListener('click', () => {
    if (currentIndex === -1 && filteredTracks.length > 0) {
      playTrack(0);
    } else {
      togglePlay();
    }
  });
  DOM.btnPrev.addEventListener('click', playPrev);
  DOM.btnNext.addEventListener('click', playNext);
  DOM.btnRewind && DOM.btnRewind.addEventListener('click', () => {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
  DOM.btnForward && DOM.btnForward.addEventListener('click', () => {
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
  });

  // Shuffle
  DOM.btnShuffle.addEventListener('click', () => {
    isShuffle = !isShuffle;
    DOM.btnShuffle.classList.toggle('active', isShuffle);
    toast(isShuffle ? '🔀 Acak: Aktif' : '🔀 Acak: Matikan');
  });

  // Repeat
  DOM.btnRepeat.addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    DOM.btnRepeat.classList.toggle('active', repeatMode > 0);
    const msgs = ['Ulangi: Matikan', 'Ulangi: Semua', 'Ulangi: Satu Lagu'];
    toast(msgs[repeatMode]);
  });

  // Progress bar seek
  DOM.progressTrack.addEventListener('click', e => {
    if (!audio.duration) return;
    const rect = DOM.progressTrack.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  // Volume
  DOM.volSlider.addEventListener('input', e => {
    audio.volume = parseFloat(e.target.value);
  });

  // Download current
  DOM.btnDownloadCurrent.addEventListener('click', () => {
    if (currentIndex >= 0 && filteredTracks[currentIndex]) {
      const t = filteredTracks[currentIndex];
      const url = `/api/download/gdrive/${t.id}?filename=${encodeURIComponent(t.filename || '')}`;
      window.location.href = url;
      toast(`📥 Mengunduh: ${t.title || t.filename}`);
    }
  });

  // Clear specific artist/album filter button
  if (DOM.btnClearFilter) {
    DOM.btnClearFilter.addEventListener('click', () => {
      selectedArtistFilter = null;
      selectedAlbumFilter  = null;
      currentTabFilter     = 'all';
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === 'all');
      });
      filterAndRender();
    });
  }

  // Center panel tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTabFilter = btn.dataset.tab || 'all';

      // Reset specific entity filters when manually clicking tabs
      if (currentTabFilter !== 'songs') {
        selectedArtistFilter = null;
        selectedAlbumFilter  = null;
      }
      filterAndRender();
    });
  });

  // Heart / like buttons (visual only)
  const heartBtns = document.querySelectorAll('#rpHeartBtn, #bpLikeBtn');
  heartBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('liked');
      heartBtns.forEach(b => b.classList.toggle('liked', btn.classList.contains('liked')));
      toast(btn.classList.contains('liked') ? '💚 Ditambahkan ke Favorit' : '♡ Dihapus dari Favorit');
    });
  });

  // Quality selector
  if (DOM.qualitySelect) {
    DOM.qualitySelect.value = selectedQuality;
    DOM.qualitySelect.addEventListener('change', (e) => {
      selectedQuality = e.target.value;
      localStorage.setItem('soundvault_quality', selectedQuality);
      const qualityNames = {
        'original': 'Lossless (Asli)',
        '320k': 'HD (320 kbps)',
        '192k': 'Medium (192 kbps)',
        '128k': 'Hemat Data (128 kbps)'
      };
      toast(`⚙️ Kualitas Audio: ${qualityNames[selectedQuality] || selectedQuality}`);

      if (currentIndex >= 0 && filteredTracks[currentIndex]) {
        const t = filteredTracks[currentIndex];
        const wasPlaying = isPlaying;
        const curTime = audio.currentTime || 0;
        
        audio.src = `/api/stream/gdrive/${t.id}?quality=${selectedQuality}`;
        audio.currentTime = curTime;
        if (wasPlaying) {
          audio.play().catch(err => console.warn('Quality switch play:', err));
          setPlayState(true);
        }
      }
    });
  }
}

/* ═══════════════════════════════════════════════════
   AUDIO SETUP
   ═══════════════════════════════════════════════════ */
function setupAudio() {
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    DOM.progressFill.style.width = `${pct}%`;
    DOM.timeCurrent.textContent = fmtTime(audio.currentTime);
  });

  audio.addEventListener('loadedmetadata', () => {
    DOM.timeTotal.textContent = fmtTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    if (repeatMode === 2) {
      audio.currentTime = 0;
      audio.play();
    } else {
      playNext();
    }
  });

  audio.addEventListener('error', (e) => {
    console.error('Audio playback error:', audio.error);
    // If CORS blocked WebAudio, retry without crossOrigin attribute
    if (audio.crossOrigin) {
      console.warn('Retrying playback without CORS restriction...');
      audio.crossOrigin = null;
      audio.load();
      audio.play().catch(err => console.error('Fallback play failed:', err));
    } else {
      toast('⚠ Gagal memutar lagu. Periksa koneksi internet Anda.', 'error');
      setPlayState(false);
    }
  });
}

/* ═══════════════════════════════════════════════════
   20-BAND LOGARITHMIC EQUALIZER VISUALIZER (20Hz - 20,000Hz)
   Reference: Studio Audio Spectrum Analyzer Logarithmic Scale
   ═══════════════════════════════════════════════════ */
const NUM_BANDS = 20;
const F_MIN     = 20;     // 20 Hz
const F_MAX     = 20000;  // 20,000 Hz

// Precompute 20 Logarithmic Frequency Boundaries
const logBoundaries = new Float32Array(NUM_BANDS + 1);
for (let i = 0; i <= NUM_BANDS; i++) {
  logBoundaries[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / NUM_BANDS);
}

const bandValues = new Float32Array(NUM_BANDS);
const bandPeaks  = new Float32Array(NUM_BANDS);
const peakDecay  = new Float32Array(NUM_BANDS);

function initVisualizer() {
  if (vizInited) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048; // 1024 bins resolution
    analyser.smoothingTimeConstant = 0.78;
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    vizInited = true;
    drawViz();
  } catch (e) {
    console.warn('AudioContext visualizer init skipped:', e);
  }
}

let vizDataArray = null;
let cachedCw = 0, cachedCh = 0;

function drawViz() {
  if (!isPlaying) {
    if (vizRafId) {
      cancelAnimationFrame(vizRafId);
      vizRafId = null;
    }
    return;
  }
  vizRafId = requestAnimationFrame(drawViz);

  const canvas = DOM.vizCanvas;
  if (!canvas || !canvas.clientWidth) return;
  const ctx = canvas.getContext('2d');

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw !== cachedCw || ch !== cachedCh) {
    canvas.width  = cw;
    canvas.height = ch;
    cachedCw = cw; cachedCh = ch;
  }

  // Clear background with dark slate finish
  ctx.fillStyle = '#0b1329';
  ctx.fillRect(0, 0, cw, ch);

  // Subtle horizontal dB grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let g = 0.25; g < 1; g += 0.25) {
    ctx.beginPath();
    ctx.moveTo(0, ch * g);
    ctx.lineTo(cw, ch * g);
    ctx.stroke();
  }

  // Calculate 20 Logarithmic Frequency Bands (20Hz - 20,000Hz)
  if (analyser) {
    const binCount = analyser.frequencyBinCount;
    if (!vizDataArray || vizDataArray.length !== binCount) {
      vizDataArray = new Uint8Array(binCount);
    }
    analyser.getByteFrequencyData(vizDataArray);

    const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
    const nyquist = sampleRate / 2;
    const hzPerBin = nyquist / binCount;

    for (let k = 0; k < NUM_BANDS; k++) {
      const fStart = logBoundaries[k];
      const fEnd   = logBoundaries[k + 1];
      const binStart = Math.max(0, Math.floor(fStart / hzPerBin));
      const binEnd   = Math.min(binCount - 1, Math.ceil(fEnd / hzPerBin));

      let sum = 0;
      let maxVal = 0;
      let count = 0;
      for (let i = binStart; i <= binEnd; i++) {
        const v = vizDataArray[i];
        sum += v;
        if (v > maxVal) maxVal = v;
        count++;
      }
      const rawVal = count > 0 ? (sum / count) * 0.5 + maxVal * 0.5 : 0;
      // Headroom Gain Control: Smoothly scale down so middle bars don't clip at top ceiling
      const eqBoost = 0.72 + (k / NUM_BANDS) * 0.35;
      const targetVal = Math.min(195, rawVal * eqBoost);

      bandValues[k] += (targetVal - bandValues[k]) * 0.32;
    }
  } else {
    // Synthetic fallback animation with headroom limit
    const time = (audio.currentTime || Date.now() / 1000);
    for (let k = 0; k < NUM_BANDS; k++) {
      const wave = Math.sin(time * 5 + k * 0.35) * 0.35 + Math.cos(time * 9 - k * 0.7) * 0.25 + 0.45;
      bandValues[k] = wave * 140;
    }
  }

  // Draw 20 Clean Emerald Equalizer Bars (Matching Reference Style)
  const labelHeight = 16;
  const barAreaHeight = ch - labelHeight - 6;
  const maxAllowedHeight = barAreaHeight * 0.72; // 72% Max Height limit for 28% top breathing room
  const padding = 3.5;
  const totalPadding = padding * (NUM_BANDS + 1);
  const barWidth = (cw - totalPadding) / NUM_BANDS;

  for (let k = 0; k < NUM_BANDS; k++) {
    const val = bandValues[k];
    const h = Math.max(3, (val / 200) * maxAllowedHeight);
    const x = padding + k * (barWidth + padding);
    const y = barAreaHeight - h + 2;

    // Clean Emerald Green Gradient matching reference image style
    const grad = ctx.createLinearGradient(0, barAreaHeight, 0, y);
    grad.addColorStop(0, '#15803d');
    grad.addColorStop(0.5, '#22c55e');
    grad.addColorStop(1, '#4ade80');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, h, 2);
    ctx.fill();
  }

  // Draw Reference Logarithmic Frequency Labels matching reference image
  // Markers: 20Hz, 50Hz, 100Hz, 200Hz, 500Hz, 1kHz, 2kHz, 5kHz, 10kHz, 20kHz
  const refLabels = [
    { freq: 20,    txt: '20Hz' },
    { freq: 50,    txt: '50Hz' },
    { freq: 100,   txt: '100' },
    { freq: 200,   txt: '200' },
    { freq: 500,   txt: '500' },
    { freq: 1000,  txt: '1kHz' },
    { freq: 2000,  txt: '2kHz' },
    { freq: 5000,  txt: '5kHz' },
    { freq: 10000, txt: '10k' },
    { freq: 20000, txt: '20k' },
  ];

  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  refLabels.forEach(lbl => {
    const posPct = Math.log10(lbl.freq / F_MIN) / Math.log10(F_MAX / F_MIN);
    const bandIdx = Math.min(NUM_BANDS - 1, Math.max(0, Math.round(posPct * (NUM_BANDS - 1))));
    const labelX = padding + bandIdx * (barWidth + padding) + barWidth / 2;
    ctx.fillText(lbl.txt, labelX, ch - 3);
  });
}

/* ═══════════════════════════════════════════════════
   DATA LOADING
   ═══════════════════════════════════════════════════ */
async function loadSources() {
  try {
    const res   = await fetch('/api/admin/sources');
    const srcs  = await res.json();

    DOM.sourceChips.innerHTML = '<button class="chip active" data-source="all">Semua</button>';

    srcs.forEach(src => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.source = src.id;
      btn.textContent = src.name;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentSrcFilter = src.id;
        filterAndRender();
      });
      DOM.sourceChips.appendChild(btn);
    });

    DOM.sourceChips.querySelector('[data-source="all"]').addEventListener('click', e => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      currentSrcFilter = 'all';
      filterAndRender();
    });
  } catch (e) {
    console.warn('loadSources:', e);
  }
}

async function loadLibrary() {
  try {
    const res  = await fetch('/api/library');
    const data = await res.json();
    libraryTracks = data.tracks || [];
    filterAndRender();
  } catch (e) {
    toast('Gagal memuat library', 'error');
  }
}

/* ═══════════════════════════════════════════════════
   FILTER & RENDER
   ═══════════════════════════════════════════════════ */
function filterAndRender() {
  const q = (DOM.searchInput.value || '').toLowerCase().trim();
  const lq = (DOM.libSearchInput ? DOM.libSearchInput.value : '').toLowerCase().trim();
  const query = q || lq;

  // Filter breadcrumb UI
  if (DOM.filterBreadcrumb) {
    if (selectedArtistFilter || selectedAlbumFilter) {
      DOM.filterBreadcrumb.classList.remove('hidden');
      if (selectedArtistFilter) {
        DOM.fbLabel.textContent = 'Artis:';
        DOM.fbValue.textContent = selectedArtistFilter;
      } else if (selectedAlbumFilter) {
        DOM.fbLabel.textContent = 'Album:';
        DOM.fbValue.textContent = selectedAlbumFilter;
      }
    } else {
      DOM.filterBreadcrumb.classList.add('hidden');
    }
  }

  // Calculate filtered tracks
  filteredTracks = libraryTracks.filter(t => {
    const matchSrc = currentSrcFilter === 'all' || t.source_id === currentSrcFilter;

    const matchQ = !query ||
      (t.title  && t.title.toLowerCase().includes(query))  ||
      (t.artist && t.artist.toLowerCase().includes(query)) ||
      (t.album  && t.album.toLowerCase().includes(query));

    let matchArtist = !selectedArtistFilter || (t.artist && t.artist.toLowerCase() === selectedArtistFilter.toLowerCase());
    let matchAlbum  = !selectedAlbumFilter  || (t.album  && t.album.toLowerCase() === selectedAlbumFilter.toLowerCase());

    let matchTab = true;
    const fmt = (t.format || '').toLowerCase();
    if (currentTabFilter === 'flac') {
      matchTab = fmt === 'flac';
    } else if (currentTabFilter === 'mp3') {
      matchTab = fmt !== 'flac';
    }

    return matchSrc && matchQ && matchArtist && matchAlbum && matchTab;
  });

  renderAll(filteredTracks);
}

/* ─── RENDER: left list + center table or grid ───── */
function renderAll(tracks) {
  tracks = tracks || [];
  if (DOM.trackList) DOM.trackList.innerHTML = '';
  if (DOM.centerSongsList) DOM.centerSongsList.innerHTML = '';
  if (DOM.gridSection) DOM.gridSection.innerHTML = '';

  const count = tracks.length;
  if (DOM.trackCount) DOM.trackCount.textContent = count ? `${count} lagu` : '–';

  // Toggle empty state
  if (DOM.emptyLibrary) {
    if (!count) {
      DOM.emptyLibrary.classList.remove('hidden');
    } else {
      DOM.emptyLibrary.classList.add('hidden');
    }
  }

  // Render left sidebar list (always shows matching tracks)
  tracks.forEach((track, idx) => {
    const isCur      = idx === currentIndex;
    const isThisPlay = isCur && isPlaying;
    const fmt        = (track.format || 'audio').toLowerCase();
    const fmtClass   = ['flac','mp3','wav','opus'].includes(fmt) ? fmt : '';
    const artUrl     = track.id ? `/api/art/gdrive/${track.id}` : '';

    const item = document.createElement('div');
    item.className = `lib-item${isCur ? ' active' : ''}`;
    item.innerHTML = `
      <div class="lib-thumb">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" opacity="0.4">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
        ${artUrl ? `<img src="${artUrl}" alt="" onerror="this.style.display='none'" loading="lazy"/>` : ''}
      </div>
      <div class="lib-info">
        <div class="lib-title">${esc(track.title || track.filename)}</div>
        <div class="lib-subtitle">${esc(track.artist || 'Unknown Artist')}${track.album ? ' · ' + esc(track.album) : ''}</div>
      </div>
      <div class="lib-actions">
        <span class="fmt-tag ${fmtClass}">${fmt.toUpperCase()}</span>
        <button class="lib-play-btn ${isThisPlay ? 'playing' : ''}" title="${isThisPlay ? 'Jeda' : 'Putar'}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
            ${isThisPlay
              ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
              : '<path d="M8 5v14l11-7z"/>'}
          </svg>
        </button>
        <button class="lib-dl-btn" title="Download">↓</button>
      </div>
    `;

    item.querySelector('.lib-play-btn').addEventListener('click', e => {
      e.stopPropagation();
      isCur ? togglePlay() : playTrack(idx);
    });
    item.querySelector('.lib-dl-btn').addEventListener('click', e => {
      e.stopPropagation();
      const url = `/api/download/gdrive/${track.id}?filename=${encodeURIComponent(track.filename || '')}`;
      window.location.href = url;
      toast(`📥 Mengunduh: ${track.title || track.filename}`);
    });
    item.addEventListener('click', () => {
      isCur ? togglePlay() : playTrack(idx);
    });

    DOM.trackList.appendChild(item);
  });

  // Decide center view: GRID vs SONGS TABLE
  const songsSection = document.querySelector('.songs-section');

  if (currentTabFilter === 'artists') {
    // ── ARTISTS GRID VIEW ──
    if (songsSection) songsSection.classList.add('hidden');
    if (DOM.gridSection) DOM.gridSection.classList.remove('hidden');

    const artistMap = {};
    tracks.forEach(t => {
      const a = t.artist || 'Unknown Artist';
      if (!artistMap[a]) artistMap[a] = { name: a, tracks: [], sampleTrack: t };
      artistMap[a].tracks.push(t);
    });

    Object.values(artistMap).forEach(artObj => {
      const card = document.createElement('div');
      card.className = 'artist-card';
      const initial = artObj.name.charAt(0).toUpperCase();
      const sampleArt = artObj.sampleTrack.id ? `/api/art/gdrive/${artObj.sampleTrack.id}` : '';

      card.innerHTML = `
        <div class="artist-avatar">
          ${sampleArt ? `<img src="${sampleArt}" alt="${esc(artObj.name)}" onerror="this.parentElement.innerHTML='${initial}'"/>` : initial}
        </div>
        <div class="artist-name">${esc(artObj.name)}</div>
        <div class="artist-sub">${artObj.tracks.length} Lagu</div>
      `;

      card.addEventListener('click', () => {
        selectedArtistFilter = artObj.name;
        selectedAlbumFilter  = null;
        currentTabFilter     = 'all';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'all'));
        filterAndRender();
      });

      if (DOM.gridSection) DOM.gridSection.appendChild(card);
    });

  } else if (currentTabFilter === 'albums') {
    // ── ALBUMS GRID VIEW ──
    if (songsSection) songsSection.classList.add('hidden');
    if (DOM.gridSection) DOM.gridSection.classList.remove('hidden');

    const albumMap = {};
    tracks.forEach(t => {
      const alb = t.album || 'Single / Collection';
      if (!albumMap[alb]) albumMap[alb] = { name: alb, artist: t.artist || 'Various Artists', sampleTrack: t, count: 0 };
      albumMap[alb].count++;
    });

    Object.values(albumMap).forEach(albObj => {
      const card = document.createElement('div');
      card.className = 'album-card';
      const artUrl = albObj.sampleTrack.id ? `/api/art/gdrive/${albObj.sampleTrack.id}` : '';

      card.innerHTML = `
        <div class="album-cover-wrap">
          <svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30" opacity="0.3">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
          ${artUrl ? `<img src="${artUrl}" alt="${esc(albObj.name)}" onerror="this.style.display='none'"/>` : ''}
        </div>
        <div class="album-title">${esc(albObj.name)}</div>
        <div class="album-artist">${esc(albObj.artist)} · ${albObj.count} lagu</div>
      `;

      card.addEventListener('click', () => {
        selectedAlbumFilter  = albObj.name;
        selectedArtistFilter = null;
        currentTabFilter     = 'all';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'all'));
        filterAndRender();
      });

      if (DOM.gridSection) DOM.gridSection.appendChild(card);
    });

  } else {
    // ── SONGS TABLE VIEW (All, Songs, FLAC, MP3) ──
    if (DOM.gridSection) DOM.gridSection.classList.add('hidden');
    if (songsSection) songsSection.classList.remove('hidden');

    tracks.forEach((track, idx) => {
      const isCur      = idx === currentIndex;
      const isThisPlay = isCur && isPlaying;
      const fmt        = (track.format || 'audio').toLowerCase();
      const fmtClass   = ['flac','mp3','wav','opus'].includes(fmt) ? fmt : '';
      const artUrl     = track.id ? `/api/art/gdrive/${track.id}` : '';

      const row = document.createElement('div');
      row.className = `song-row${isCur ? ' active' : ''}`;
      row.innerHTML = `
        <div class="srow-num">${isThisPlay ? '♫' : isCur ? '▶' : idx + 1}</div>
        <div class="srow-title">
          <div class="srow-thumb">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" opacity="0.35">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            ${artUrl ? `<img src="${artUrl}" alt="" onerror="this.style.display='none'" loading="lazy"/>` : ''}
          </div>
          <div class="srow-info">
            <div class="srow-name">${esc(track.title || track.filename)}</div>
            <div class="srow-sub">${esc(track.artist || 'Unknown Artist')}${track.album ? ' · ' + esc(track.album) : ''}</div>
          </div>
        </div>
        <div class="srow-fmt"><span class="fmt-tag ${fmtClass}">${fmt.toUpperCase()}</span></div>
        <div class="srow-fmt"><span class="srow-album-txt">${esc(track.album || '–')}</span></div>
        <div class="srow-action">
          <button class="row-dl-btn" title="Download">↓</button>
        </div>
      `;

      row.querySelector('.row-dl-btn').addEventListener('click', e => {
        e.stopPropagation();
        const url = `/api/download/gdrive/${track.id}?filename=${encodeURIComponent(track.filename || '')}`;
        window.location.href = url;
        toast(`📥 Mengunduh: ${track.title || track.filename}`);
      });
      row.addEventListener('click', () => {
        isCur ? togglePlay() : playTrack(idx);
      });

      if (DOM.centerSongsList) DOM.centerSongsList.appendChild(row);
    });
  }
}

function setMarqueeTitle(el, text) {
  if (!el) return;
  const escaped = esc(text);
  if (text.length > 20) {
    el.innerHTML = `<div class="marquee-track"><span class="marquee-content">${escaped}</span><span class="marquee-content" aria-hidden="true">${escaped}</span></div>`;
    el.classList.add('has-marquee');
  } else {
    el.textContent = text;
    el.classList.remove('has-marquee');
  }
}

/* ═══════════════════════════════════════════════════
   PLAY TRACK
   ═══════════════════════════════════════════════════ */
function playTrack(idx) {
  if (idx < 0 || idx >= filteredTracks.length) return;

  currentIndex = idx;
  const t = filteredTracks[idx];

  // Set audio source with quality selection
  audio.src = `/api/stream/gdrive/${t.id}?quality=${selectedQuality}`;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  initVisualizer();

  const p = audio.play();
  if (p) p.catch(e => console.warn('Playback autoplay block:', e));
  setPlayState(true);

  // ── Update metadata across all panels ──
  const title  = t.title  || t.filename || '–';
  const artist = t.artist || 'Unknown Artist';
  const album  = t.album  || '';
  const fmt    = (t.format || 'AUDIO').toUpperCase();

  // Hero card
  DOM.heroTag.textContent      = 'Sedang Diputar';
  setMarqueeTitle(DOM.heroTitle, title);
  DOM.heroSubtitle.innerHTML   = `<strong>${esc(artist)}</strong>${album ? ' · ' + esc(album) : ''}`;

  // Right panel
  setMarqueeTitle(DOM.rpHeaderTitle, title);
  setMarqueeTitle(DOM.npTitle, title);
  DOM.npArtist.textContent      = artist;
  DOM.npAlbum.textContent       = album ? `Album: ${album}` : '';
  DOM.npFormat.textContent      = fmt;
  DOM.npFormat.classList.remove('hidden');
  DOM.npSource.textContent      = t.source_name || 'Drive';
  DOM.npSource.classList.remove('hidden');
  if (DOM.npSourceText) {
    const sr = t.sample_rate ? `${(t.sample_rate / 1000).toFixed(1)} kHz` : '';
    const bits = t.bits_per_sample ? `${t.bits_per_sample}-bit` : '';
    const qualityTxt = [bits, sr, fmt].filter(Boolean).join(' · ');
    const sizeTxt = t.size_formatted ? ` (${t.size_formatted})` : (t.size ? ` (${(t.size / 1048576).toFixed(1)} MB)` : '');

    DOM.npSourceText.innerHTML = `
      <div class="rp-info-details" style="display:flex;flex-direction:column;gap:6px;font-size:0.81rem;color:var(--text-sub);line-height:1.5;">
        <div><strong style="color:var(--text)">Judul:</strong> ${esc(title)}</div>
        <div><strong style="color:var(--text)">Penyanyi:</strong> ${esc(artist)}</div>
        ${album ? `<div><strong style="color:var(--text)">Album:</strong> ${esc(album)}</div>` : ''}
        ${t.genre ? `<div><strong style="color:var(--text)">Genre:</strong> ${esc(t.genre)}</div>` : ''}
        ${t.year ? `<div><strong style="color:var(--text)">Rilis:</strong> ${esc(t.year)}</div>` : ''}
        <div><strong style="color:var(--text)">Kualitas:</strong> <span style="color:var(--green-dark);font-weight:700;">${esc(qualityTxt || fmt)}</span>${sizeTxt}</div>
        <div><strong style="color:var(--text)">Sumber:</strong> ${esc(t.source_name || 'Google Drive')}</div>
      </div>
    `;
  }

  // Bottom bar
  setMarqueeTitle(DOM.pbTitle, title);
  DOM.pbArtist.textContent = `${artist}${album ? ' · ' + album : ''}`;

  // Download button
  DOM.btnDownloadCurrent.classList.remove('hidden');

  // ── Cover art ──
  const artUrl = `/api/art/gdrive/${t.id}`;
  loadCoverArt(artUrl);

  // Browser tab title
  document.title = `♫ ${title} – SoundVault`;

  // Lightweight active state update
  updateTrackRowState();
}

function loadCoverArt(url) {
  // Right panel large cover
  DOM.coverArt.onload = () => {
    DOM.coverArt.classList.remove('hidden');
    DOM.rpCoverFallback && DOM.rpCoverFallback.classList.add('hidden');
  };
  DOM.coverArt.onerror = () => {
    DOM.coverArt.classList.add('hidden');
    DOM.rpCoverFallback && DOM.rpCoverFallback.classList.remove('hidden');
  };
  DOM.coverArt.src = url;

  // Hero card cover
  if (DOM.heroCoverImg) {
    DOM.heroCoverImg.onload = () => {
      DOM.heroCoverImg.classList.remove('hidden');
      DOM.heroCoverFallback && DOM.heroCoverFallback.classList.add('hidden');
    };
    DOM.heroCoverImg.onerror = () => {
      DOM.heroCoverImg.classList.add('hidden');
      DOM.heroCoverFallback && DOM.heroCoverFallback.classList.remove('hidden');
    };
    DOM.heroCoverImg.src = url;
  }

  // Bottom bar mini art
  DOM.pbArt.onload  = () => { DOM.pbArt.classList.remove('hidden'); DOM.pbFallback.classList.add('hidden'); };
  DOM.pbArt.onerror = () => { DOM.pbArt.classList.add('hidden');    DOM.pbFallback.classList.remove('hidden'); };
  DOM.pbArt.src = url;
}

/* ═══════════════════════════════════════════════════
   PLAYBACK CONTROLS
   ═══════════════════════════════════════════════════ */
function togglePlay() {
  if (audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    audio.play().catch(e => console.warn(e));
    setPlayState(true);
  } else {
    audio.pause();
    setPlayState(false);
  }
}

function setPlayState(playing) {
  isPlaying = playing;

  // Bottom bar icons
  DOM.playIcon.classList.toggle('hidden', playing);
  DOM.pauseIcon.classList.toggle('hidden', !playing);

  // Hero card icons
  DOM.heroPlayIcon.classList.toggle('hidden', playing);
  DOM.heroPauseIcon.classList.toggle('hidden', !playing);

  // Start or stop visualizer RAF loop
  if (playing) {
    if (!vizRafId && analyser) drawViz();
  } else {
    if (vizRafId) {
      cancelAnimationFrame(vizRafId);
      vizRafId = null;
    }
  }

  // Update active track UI state lightweightly without DOM reflow
  updateTrackRowState();
}

function updateTrackRowState() {
  if (DOM.trackList) {
    const items = DOM.trackList.querySelectorAll('.lib-item');
    items.forEach((item, idx) => {
      const isCur = idx === currentIndex;
      const isThisPlay = isCur && isPlaying;
      item.classList.toggle('active', isCur);
      const playBtn = item.querySelector('.lib-play-btn');
      if (playBtn) {
        playBtn.classList.toggle('playing', isThisPlay);
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
          ${isThisPlay ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}
        </svg>`;
      }
    });
  }

  if (DOM.centerSongsList) {
    const rows = DOM.centerSongsList.querySelectorAll('.song-row');
    rows.forEach((row, idx) => {
      const isCur = idx === currentIndex;
      const isThisPlay = isCur && isPlaying;
      row.classList.toggle('active', isCur);
      const numCell = row.querySelector('.srow-num');
      if (numCell) {
        numCell.textContent = isThisPlay ? '♫' : (isCur ? '▶' : idx + 1);
      }
    });
  }
}

function playPrev() {
  if (!filteredTracks.length) return;
  let idx = currentIndex - 1;
  if (idx < 0) idx = filteredTracks.length - 1;
  playTrack(idx);
}

function playNext() {
  if (!filteredTracks.length) return;
  let idx;
  if (isShuffle) {
    idx = Math.floor(Math.random() * filteredTracks.length);
  } else {
    idx = currentIndex + 1;
    if (idx >= filteredTracks.length) {
      if (repeatMode === 1) idx = 0;
      else return;
    }
  }
  playTrack(idx);
}

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── START ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
