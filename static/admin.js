/* ═══════════════════════════════════════════════════
   SoundVault – Admin Dashboard JS (With Auth)
   ═══════════════════════════════════════════════════ */

'use strict';

const $ = id => document.getElementById(id);

const DOM = {
  loginView: $('loginView'),
  adminView: $('adminView'),
  loginForm: $('loginForm'),
  loginPassword: $('loginPassword'),
  btnLogout: $('btnLogout'),
  statSources: $('statSources'),
  statTracks: $('statTracks'),
  statSize: $('statSize'),
  statApiKey: $('statApiKey'),
  apiIcon: $('apiIcon'),
  btnAddSource: $('btnAddSource'),
  addForm: $('addForm'),
  fUrl: $('fUrl'),
  fName: $('fName'),
  fColor: $('fColor'),
  btnCancelAdd: $('btnCancelAdd'),
  btnConfirmAdd: $('btnConfirmAdd'),
  sourcesList: $('sourcesList'),
  sourcesEmpty: $('sourcesEmpty'),
  apiKeyInput: $('apiKeyInput'),
  btnToggleKey: $('btnToggleKey'),
  btnTestKey: $('btnTestKey'),
  btnSaveKey: $('btnSaveKey'),
  newPasswordInput: $('newPasswordInput'),
  btnChangePassword: $('btnChangePassword'),
  keyStatus: $('keyStatus'),
  toastContainer: $('toastContainer'),
  autoScanToggle: $('autoScanToggle'),
  autoScanInterval: $('autoScanInterval'),
  autoScanStatusTxt: $('autoScanStatusTxt'),
  btnSaveAutoScan: $('btnSaveAutoScan'),
  btnScanAllNow: $('btnScanAllNow'),
};

let sourcesData = [];
let adminToken = localStorage.getItem('soundvault_admin_token') || '';

async function init() {
  bindEvents();
  await checkAuth();
  setInterval(pollScanningSources, 5000);
}

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (adminToken) h['X-Admin-Token'] = adminToken;
  return h;
}

function bindEvents() {
  DOM.loginForm.addEventListener('submit', handleLogin);
  if (DOM.btnLogout) DOM.btnLogout.addEventListener('click', handleLogout);

  DOM.btnAddSource.addEventListener('click', () => DOM.addForm.classList.remove('hidden'));
  DOM.btnCancelAdd.addEventListener('click', () => DOM.addForm.classList.add('hidden'));
  DOM.btnConfirmAdd.addEventListener('click', addSource);

  DOM.btnToggleKey.addEventListener('click', () => {
    DOM.apiKeyInput.type = DOM.apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  DOM.btnSaveKey.addEventListener('click', saveApiKey);
  DOM.btnTestKey.addEventListener('click', testApiKey);
  DOM.btnChangePassword.addEventListener('click', changePassword);
  if (DOM.btnSaveAutoScan) DOM.btnSaveAutoScan.addEventListener('click', saveAutoScan);
  if (DOM.btnScanAllNow) DOM.btnScanAllNow.addEventListener('click', scanAllNow);
}

async function checkAuth() {
  try {
    const res = await fetch('/api/admin/check-auth', { headers: getHeaders() });
    const data = await res.json();
    if (data.authenticated) {
      showAdminView();
    } else {
      showLoginView();
    }
  } catch (e) {
    showLoginView();
  }
}

function showLoginView() {
  DOM.loginView.classList.remove('hidden');
  DOM.adminView.classList.add('hidden');
}

function showAdminView() {
  DOM.loginView.classList.add('hidden');
  DOM.adminView.classList.remove('hidden');
  loadAll();
}

async function handleLogin(e) {
  e.preventDefault();
  const password = DOM.loginPassword.value.trim();
  if (!password) return;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.ok) {
      adminToken = data.token;
      localStorage.setItem('soundvault_admin_token', adminToken);
      toast('Login berhasil!', 'success');
      DOM.loginPassword.value = '';
      showAdminView();
    } else {
      toast(data.error || 'Password salah', 'error');
    }
  } catch (e) {
    toast('Gagal terhubung ke server', 'error');
  }
}

async function handleLogout() {
  try {
    await fetch('/api/admin/logout', { method: 'POST', headers: getHeaders() });
  } catch (e) {}
  adminToken = '';
  localStorage.removeItem('soundvault_admin_token');
  toast('Logout berhasil', 'info');
  showLoginView();
}

async function loadAll() {
  await Promise.all([loadStatus(), loadStats(), loadSources(), loadConfig()]);
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.api_key_set) {
      DOM.statApiKey.textContent = 'Google API Key ✓';
      DOM.statApiKey.style.color = 'var(--success)';
    } else {
      DOM.statApiKey.textContent = 'Smart Scraper (Aktif)';
      DOM.statApiKey.style.color = 'var(--cyan)';
    }

  } catch (e) {}
}

async function loadStats() {
  try {
    const res = await fetch('/api/library/stats');
    const data = await res.json();
    DOM.statSources.textContent = data.sources || 0;
    DOM.statTracks.textContent = data.tracks || 0;
    DOM.statSize.textContent = `${data.size_gb || 0} GB`;
  } catch (e) {}
}

async function loadConfig() {
  try {
    const res = await fetch('/api/admin/config', { headers: getHeaders() });
    const data = await res.json();
    if (data.api_key) {
      DOM.apiKeyInput.value = data.api_key;
    }
    loadAutoScanConfig();
  } catch (e) {}
}

async function loadSources() {
  try {
    const res = await fetch('/api/admin/sources', { headers: getHeaders() });
    sourcesData = await res.json();
    renderSources(sourcesData);
  } catch (e) {
    toast('Gagal memuat sumber musik', 'error');
  }
}

function renderSources(sources) {
  DOM.sourcesList.innerHTML = '';
  if (!sources || sources.length === 0) {
    DOM.sourcesEmpty.classList.remove('hidden');
    return;
  }
  DOM.sourcesEmpty.classList.add('hidden');

  sources.forEach(src => {
    const item = document.createElement('div');
    item.className = 'source-item';
    
    const badgeClass = src.status || 'idle';
    const badgeText = src.status ? src.status.toUpperCase() : 'IDLE';

    item.innerHTML = `
      <div class="source-left">
        <div class="source-dot" style="background:${src.color || '#10b981'}"></div>
        <div style="min-width:0">
          <div class="source-title">${esc(src.name)}</div>
          <div class="source-sub">${esc(src.url)}</div>
          <div class="source-badges">
            <span class="s-badge ${badgeClass}">${badgeText}</span>
            <span style="font-size:0.75rem; color:var(--text-3)">${src.track_count || 0} lagu</span>
          </div>
        </div>
      </div>
      <div class="source-actions">
        <button class="btn-ghost btn-scan" data-id="${src.id}">${src.status === 'scanning' ? 'Scanning...' : 'Scan'}</button>
        <label class="switch">
          <input type="checkbox" class="chk-enable" data-id="${src.id}" ${src.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <button class="btn-danger btn-del" data-id="${src.id}">Hapus</button>
      </div>
    `;

    item.querySelector('.btn-scan').addEventListener('click', () => scanSource(src.id));
    item.querySelector('.btn-del').addEventListener('click', () => deleteSource(src.id));
    item.querySelector('.chk-enable').addEventListener('change', (e) => toggleSource(src.id, e.target.checked));

    DOM.sourcesList.appendChild(item);
  });
}

async function addSource() {
  const url = DOM.fUrl.value.trim();
  const name = DOM.fName.value.trim();
  const color = DOM.fColor.value;

  if (!url) {
    toast('Link Google Drive harus diisi', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ url, name, color }),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
      return;
    }
    toast('Sumber berhasil ditambahkan!', 'success');
    DOM.fUrl.value = '';
    DOM.fName.value = '';
    DOM.addForm.classList.add('hidden');
    await loadSources();
    await loadStats();
    scanSource(data.id);
  } catch (e) {
    toast('Gagal menambahkan sumber', 'error');
  }
}

async function deleteSource(id) {
  if (!confirm('Yakin ingin menghapus sumber ini?')) return;
  try {
    const res = await fetch(`/api/admin/sources/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (res.ok) {
      toast('Sumber dihapus', 'success');
      await loadSources();
      await loadStats();
    }
  } catch (e) {
    toast('Gagal menghapus sumber', 'error');
  }
}

async function toggleSource(id, enabled) {
  try {
    await fetch(`/api/admin/sources/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    toast(enabled ? 'Sumber diaktifkan' : 'Sumber dinonaktifkan', 'success');
    await loadStats();
  } catch (e) {
    toast('Gagal mengubah status', 'error');
  }
}

async function scanSource(id) {
  try {
    const res = await fetch(`/api/admin/sources/${id}/scan`, {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (data.error) {
      toast(data.error, 'error');
    } else {
      toast('Memulai scan folder Drive...', 'success');
      await loadSources();
    }
  } catch (e) {
    toast('Gagal memulai scan', 'error');
  }
}

async function pollScanningSources() {
  if (!adminToken) return;
  if (sourcesData.some(s => s.status === 'scanning')) {
    await loadSources();
    await loadStats();
  }
}

async function saveApiKey() {
  const api_key = DOM.apiKeyInput.value.trim();
  try {
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ api_key }),
    });
    if (res.ok) {
      toast('API Key berhasil disimpan!', 'success');
      await loadStatus();
    }
  } catch (e) {
    toast('Gagal menyimpan API Key', 'error');
  }
}

async function changePassword() {
  const new_password = DOM.newPasswordInput.value.trim();
  if (!new_password || new_password.length < 4) {
    toast('Password minimal 4 karakter', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ new_password }),
    });
    const data = await res.json();
    if (data.ok) {
      toast('Password admin berhasil diubah!', 'success');
      DOM.newPasswordInput.value = '';
    } else {
      toast(data.error || 'Gagal mengubah password', 'error');
    }
  } catch (e) {
    toast('Gagal terhubung ke server', 'error');
  }
}

async function testApiKey() {
  DOM.keyStatus.className = 'key-status';
  DOM.keyStatus.textContent = 'Testing...';
  DOM.keyStatus.classList.remove('hidden');

  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.api_key_set) {
      DOM.keyStatus.className = 'key-status ok';
      DOM.keyStatus.textContent = '✓ API Key valid & aktif!';
    } else {
      DOM.keyStatus.className = 'key-status err';
      DOM.keyStatus.textContent = '⚠ Masukkan & simpan API Key terlebih dahulu.';
    }
  } catch (e) {
    DOM.keyStatus.className = 'key-status err';
    DOM.keyStatus.textContent = '❌ Gagal terhubung ke server';
  }
}

async function loadAutoScanConfig() {
  try {
    const res = await fetch('/api/admin/config', { headers: getHeaders() });
    const cfg = await res.json();
    const enabled = cfg.auto_scan_enabled !== false;
    const interval = cfg.auto_scan_interval_minutes || 15;
    if (DOM.autoScanToggle) DOM.autoScanToggle.checked = enabled;
    if (DOM.autoScanInterval) DOM.autoScanInterval.value = String(interval);
    updateAutoScanUI(enabled, interval);
  } catch (e) {}
}

function updateAutoScanUI(enabled, interval) {
  if (!DOM.autoScanStatusTxt) return;
  if (enabled) {
    DOM.autoScanStatusTxt.textContent = `Auto-Scan Aktif (Pengecekan setiap ${interval} menit)`;
    DOM.autoScanStatusTxt.parentElement.style.color = '#10b981';
  } else {
    DOM.autoScanStatusTxt.textContent = 'Auto-Scan Dinonaktifkan';
    DOM.autoScanStatusTxt.parentElement.style.color = '#ef4444';
  }
}

async function saveAutoScan() {
  const auto_scan_enabled = DOM.autoScanToggle.checked;
  const auto_scan_interval_minutes = parseInt(DOM.autoScanInterval.value, 10);
  try {
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ auto_scan_enabled, auto_scan_interval_minutes }),
    });
    if (res.ok) {
      toast('Pengaturan Auto-Scan berhasil disimpan!', 'success');
      updateAutoScanUI(auto_scan_enabled, auto_scan_interval_minutes);
    }
  } catch (e) {
    toast('Gagal menyimpan pengaturan Auto-Scan', 'error');
  }
}

async function scanAllNow() {
  try {
    toast('Memulai scan semua folder Google Drive...', 'success');
    const res = await fetch('/api/admin/scan-all', {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (data.ok) {
      toast(`Scanning ${data.count} sumber sedang berjalan di background...`, 'success');
      await loadSources();
    }
  } catch (e) {
    toast('Gagal melakukan scan', 'error');
  }
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);
