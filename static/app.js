/* ═══════════════════════════════════════════════
   SoundVault – app.js
   Handles: Search, Download Panel, SSE Progress,
            Queue Management
   ═══════════════════════════════════════════════ */

'use strict';

// ─── State ──────────────────────────────────────
const state = {
  ffmpegAvailable: false,
  currentTrack: null,
  selectedFormat: 'flac',
  searchQuery: '',
  searchResults: [],
  queue: [],          // [{taskId, title, thumb, format, status, progress}]
  activeSSE: null,
};

// ─── DOM refs ────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  searchInput:     $('searchInput'),
  searchBtn:       $('searchBtn'),
  searchBox:       $('searchBox'),
  searchLoading:   $('searchLoading'),
  searchError:     $('searchError'),
  searchErrorMsg:  $('searchErrorMsg'),
  resultsSection:  $('resultsSection'),
  resultsGrid:     $('resultsGrid'),
  resultsTitle:    $('resultsTitle'),
  resultsCount:    $('resultsCount'),
  loadMoreBtn:     $('loadMoreBtn'),
  emptyState:      $('emptyState'),
  queueSection:    $('queueSection'),
  queueList:       $('queueList'),
  ffmpegBadge:     $('ffmpegBadge'),
  ffmpegOk:        $('ffmpegOk'),
  urlToggleBtn:    $('urlToggleBtn'),
  urlDirectWrap:   $('urlDirectWrap'),
  urlDirectInput:  $('urlDirectInput'),
  urlDirectBtn:    $('urlDirectBtn'),
  // Panel
  panelOverlay:    $('panelOverlay'),
  downloadPanel:   $('downloadPanel'),
  panelClose:      $('panelClose'),
  panelThumb:      $('panelThumb'),
  panelTitle:      $('panelTitle'),
  panelArtist:     $('panelArtist'),
  panelDuration:   $('panelDuration'),
  formatGrid:      $('formatGrid'),
  downloadBtn:     $('downloadBtn'),
  panelProgress:   $('panelProgress'),
  progressStatus:  $('progressStatus'),
  progressPct:     $('progressPct'),
  progressBarFill: $('progressBarFill'),
  progressSpeed:   $('progressSpeed'),
  progressEta:     $('progressEta'),
  noFfmpegNote:    $('noFfmpegNote'),
};

// ─── Helpers ─────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e9) return (n/1e9).toFixed(1) + ' M views';
  if (n >= 1e6) return (n/1e6).toFixed(1) + ' Jt views';
  if (n >= 1e3) return (n/1e3).toFixed(0) + ' Rb views';
  return n + ' views';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showEl(...els) { els.forEach(e => e && e.classList.remove('hidden')); }
function hideEl(...els) { els.forEach(e => e && e.classList.add('hidden')); }

// ─── Init ─────────────────────────────────────────
async function init() {
  await fetchStatus();
  bindEvents();
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.ffmpegAvailable = data.ffmpeg_available;

    if (state.ffmpegAvailable) {
      showEl(DOM.ffmpegOk);
    } else {
      showEl(DOM.ffmpegBadge);
      showEl(DOM.noFfmpegNote);
      // Disable formats that need FFmpeg
      ['fmt-flac','fmt-mp3','fmt-wav'].forEach(id => {
        const btn = $(id);
        if (btn) btn.classList.add('disabled');
      });
      // Set default to opus
      setFormat('opus');
    }
  } catch (e) {
    console.warn('Status check failed:', e);
  }
}

// ─── Events ───────────────────────────────────────
function bindEvents() {
  // Search
  DOM.searchBtn.addEventListener('click', () => doSearch());
  DOM.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // Search tags
  document.querySelectorAll('.search-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const q = tag.dataset.q;
      DOM.searchInput.value = q;
      doSearch(q);
    });
  });

  // URL toggle
  DOM.urlToggleBtn.addEventListener('click', () => {
    DOM.urlDirectWrap.classList.toggle('hidden');
    DOM.urlToggleBtn.textContent = DOM.urlDirectWrap.classList.contains('hidden')
      ? '🔗 Paste URL langsung'
      : '🔗 Tutup URL input';
  });

  DOM.urlDirectBtn.addEventListener('click', fetchDirectUrl);
  DOM.urlDirectInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchDirectUrl(); });

  // Panel
  DOM.panelClose.addEventListener('click', closePanel);
  DOM.panelOverlay.addEventListener('click', closePanel);

  // Format buttons
  DOM.formatGrid.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      setFormat(btn.dataset.fmt);
    });
  });

  // Download
  DOM.downloadBtn.addEventListener('click', startDownload);

  // Keyboard: Escape closes panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
  });
}

// ─── Search ───────────────────────────────────────
async function doSearch(overrideQuery) {
  const q = (overrideQuery || DOM.searchInput.value).trim();
  if (!q) return;

  state.searchQuery = q;
  DOM.searchInput.value = q;

  // Reset UI
  hideEl(DOM.emptyState, DOM.resultsSection, DOM.searchError);
  showEl(DOM.searchLoading);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
    const data = await res.json();

    hideEl(DOM.searchLoading);

    if (data.error) {
      showError(data.error);
      return;
    }

    state.searchResults = data.results || [];
    renderResults(state.searchResults, q);

  } catch (err) {
    hideEl(DOM.searchLoading);
    showError('Gagal terhubung ke server. Pastikan app.py berjalan.');
  }
}

function renderResults(results, query) {
  if (!results || results.length === 0) {
    showEl(DOM.emptyState);
    DOM.emptyState.querySelector('h2').textContent = 'Tidak ada hasil';
    DOM.emptyState.querySelector('p').textContent = `Tidak ditemukan hasil untuk "${query}"`;
    return;
  }

  DOM.resultsTitle.textContent = `Hasil untuk "${query}"`;
  DOM.resultsCount.textContent = `${results.length} lagu`;
  DOM.resultsGrid.innerHTML = '';

  results.forEach((track, i) => {
    const card = buildMusicCard(track, i);
    DOM.resultsGrid.appendChild(card);
  });

  showEl(DOM.resultsSection);
}

function buildMusicCard(track, index) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.style.animationDelay = `${index * 0.05}s`;

  const thumbSrc = track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
  const duration = fmtDuration(track.duration);
  const views = fmtViews(track.view_count);

  card.innerHTML = `
    <div class="card-thumb-wrap">
      <img class="card-thumb" src="${thumbSrc}" alt="${escHtml(track.title)}"
           loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg'"/>
      <div class="card-overlay">
        <div class="play-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      ${duration ? `<span class="card-duration">${duration}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(track.title)}</div>
      <div class="card-artist">${escHtml(track.uploader)}</div>
      ${views ? `<div class="card-views">${views}</div>` : ''}
    </div>
  `;

  card.addEventListener('click', () => openPanel(track));
  return card;
}

// ─── Direct URL ───────────────────────────────────
async function fetchDirectUrl() {
  const url = DOM.urlDirectInput.value.trim();
  if (!url) return;

  DOM.urlDirectBtn.disabled = true;
  DOM.urlDirectBtn.textContent = 'Mengambil…';

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
    } else {
      const track = {
        id: '',
        title: data.title,
        uploader: data.uploader,
        duration: data.duration,
        thumbnail: data.thumbnail,
        url: data.webpage_url || url,
        view_count: data.view_count,
      };
      openPanel(track);
    }
  } catch (e) {
    showError('Gagal mengambil info dari URL tersebut.');
  } finally {
    DOM.urlDirectBtn.disabled = false;
    DOM.urlDirectBtn.textContent = 'Ambil Info';
  }
}

// ─── Panel ────────────────────────────────────────
function openPanel(track) {
  state.currentTrack = track;

  DOM.panelThumb.src = track.thumbnail || '';
  DOM.panelTitle.textContent = track.title;
  DOM.panelArtist.textContent = track.uploader || '';
  DOM.panelDuration.textContent = track.duration ? `⏱ ${fmtDuration(track.duration)}` : '';

  // Reset progress
  hideEl(DOM.panelProgress);
  DOM.downloadBtn.disabled = false;
  DOM.downloadBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Download
  `;

  showEl(DOM.panelOverlay, DOM.downloadPanel);
  document.body.style.overflow = 'hidden';
}

function closePanel() {
  hideEl(DOM.panelOverlay, DOM.downloadPanel);
  document.body.style.overflow = '';
}

function setFormat(fmt) {
  state.selectedFormat = fmt;
  DOM.formatGrid.querySelectorAll('.format-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.fmt === fmt);
  });
}

// ─── Download ─────────────────────────────────────
async function startDownload() {
  const track = state.currentTrack;
  if (!track) return;

  DOM.downloadBtn.disabled = true;
  DOM.downloadBtn.textContent = 'Memulai…';

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: track.url,
        format: state.selectedFormat,
      }),
    });
    const data = await res.json();

    if (data.error) {
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.textContent = '⚠ ' + data.error.slice(0, 50);
      return;
    }

    const taskId = data.task_id;
    const usedFormat = data.format;

    // Add to queue
    const queueItem = addToQueue(taskId, track, usedFormat);

    // Show progress in panel
    showEl(DOM.panelProgress);
    DOM.progressBarFill.style.width = '0%';
    DOM.progressPct.textContent = '0%';
    DOM.progressStatus.textContent = 'Memulai download…';

    // Start SSE
    listenProgress(taskId, queueItem);

  } catch (e) {
    DOM.downloadBtn.disabled = false;
    DOM.downloadBtn.textContent = 'Download';
    showError('Gagal memulai download: ' + e.message);
  }
}

function listenProgress(taskId, queueItem) {
  if (state.activeSSE) state.activeSSE.close();

  const evtSrc = new EventSource(`/api/progress/${taskId}`);
  state.activeSSE = evtSrc;

  evtSrc.onmessage = (e) => {
    const d = JSON.parse(e.data);

    // Update panel progress
    const pct = d.progress || 0;
    DOM.progressBarFill.style.width = pct + '%';
    DOM.progressPct.textContent = pct.toFixed(0) + '%';

    const statusMap = {
      starting:    'Memulai…',
      downloading: 'Mendownload…',
      processing:  'Memproses audio…',
      done:        'Selesai! ✓',
      error:       'Gagal',
    };
    DOM.progressStatus.textContent = statusMap[d.status] || d.status;
    if (d.speed) DOM.progressSpeed.textContent = d.speed;
    if (d.eta)   DOM.progressEta.textContent   = 'ETA: ' + d.eta;

    // Update queue item
    updateQueueItem(queueItem, d);

    if (d.status === 'done') {
      evtSrc.close();
      // Trigger file download
      triggerFileDownload(taskId);
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.innerHTML = `✓ Terdownload!`;
      setTimeout(() => {
        DOM.downloadBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Lagi
        `;
        DOM.downloadBtn.disabled = false;
      }, 3000);
    }

    if (d.status === 'error') {
      evtSrc.close();
      DOM.progressStatus.textContent = '⚠ Error: ' + (d.error || 'Unknown');
      DOM.progressBarFill.style.background = '#ef4444';
      DOM.downloadBtn.disabled = false;
      DOM.downloadBtn.textContent = 'Coba Lagi';
    }
  };

  evtSrc.onerror = () => {
    evtSrc.close();
    DOM.progressStatus.textContent = 'Koneksi terputus';
  };
}

function triggerFileDownload(taskId) {
  const a = document.createElement('a');
  a.href = `/api/file/${taskId}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
  // Cleanup after delay
  setTimeout(() => fetch(`/api/cleanup/${taskId}`, { method: 'DELETE' }), 30000);
}

// ─── Queue ────────────────────────────────────────
function addToQueue(taskId, track, format) {
  const item = { taskId, track, format, status: 'starting', progress: 0 };
  state.queue.unshift(item);

  showEl(DOM.queueSection);
  renderQueue();
  return item;
}

function updateQueueItem(item, d) {
  item.status = d.status;
  item.progress = d.progress || 0;
  renderQueue();
}

function renderQueue() {
  DOM.queueList.innerHTML = '';
  state.queue.forEach(item => {
    const el = buildQueueEl(item);
    DOM.queueList.appendChild(el);
  });
}

function buildQueueEl(item) {
  const { taskId, track, format, status, progress } = item;
  const thumb = track.thumbnail || '';
  const statusLabel = { starting:'Starting', downloading:'Downloading', processing:'Processing', done:'Done', error:'Error' };
  const badgeClass = { starting:'downloading', downloading:'downloading', processing:'processing', done:'done', error:'error' };

  const el = document.createElement('div');
  el.className = 'queue-item';
  el.innerHTML = `
    <img class="qi-thumb" src="${thumb}" alt="" onerror="this.style.display='none'" />
    <div class="qi-info">
      <div class="qi-title">${escHtml(track.title)}</div>
      <div class="qi-meta">${escHtml(track.uploader || '')} · ${format.toUpperCase()}</div>
      ${(status === 'downloading' || status === 'processing') ? `
        <div class="qi-progress-bar" style="margin-top:6px">
          <div class="qi-progress-fill" style="width:${progress}%"></div>
        </div>` : ''}
    </div>
    <div class="qi-right">
      <span class="qi-badge ${badgeClass[status] || 'downloading'}">${statusLabel[status] || status}</span>
      ${status === 'done' ? `<button class="qi-download-btn" onclick="triggerFileDownload('${taskId}')">↓ Simpan</button>` : ''}
    </div>
  `;
  return el;
}

// ─── Error display ────────────────────────────────
function showError(msg) {
  DOM.searchErrorMsg.textContent = msg;
  showEl(DOM.searchError);
  hideEl(DOM.searchLoading);
}

// ─── Escape HTML ──────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Bootstrap ───────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
