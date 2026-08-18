import os, uuid, json, time, shutil, threading, queue, re, traceback, subprocess
from pathlib import Path
from flask import (Flask, request, jsonify, send_file, Response,
                   send_from_directory, stream_with_context, redirect)
from werkzeug.exceptions import HTTPException
from flask_cors import CORS
import requests as http_req
import yt_dlp

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

# ─── Paths ────────────────────────────────────────────────────────────
DOWNLOAD_DIR = Path('downloads')
MUSIC_DIR    = Path('music')
CACHE_DIR    = Path('cache')
CONFIG_FILE  = Path('config.json')
SOURCES_FILE = Path('sources.json')

for _d in [DOWNLOAD_DIR, MUSIC_DIR, CACHE_DIR]:
    _d.mkdir(exist_ok=True)

# ─── Config & Sources ─────────────────────────────────────────────────
ADMIN_TOKENS = set()  # Active admin session tokens

def load_config():
    if CONFIG_FILE.exists():
        cfg = json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
        if 'admin_password' not in cfg:
            cfg['admin_password'] = 'admin123'
        if 'admin_secret_path' not in cfg:
            cfg['admin_secret_path'] = 'admin-c11cc-secret-9f8a7b6c'
            save_config(cfg)
        return cfg
    cfg = {
        'api_key': '',
        'music_dir': 'music',
        'admin_password': 'admin123',
        'admin_secret_path': 'admin-c11cc-secret-9f8a7b6c'
    }
    save_config(cfg)
    return cfg

def check_admin_auth(req):
    """Check if request has valid admin token or header"""
    token = req.headers.get('X-Admin-Token') or req.cookies.get('admin_token')
    if token and token in ADMIN_TOKENS:
        return True
    return False

def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not check_admin_auth(request):
            return jsonify({'error': 'Akses ditolak. Silakan login sebagai Admin.'}), 401
        return f(*args, **kwargs)
    return decorated

def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding='utf-8')

def load_sources():
    if SOURCES_FILE.exists():
        return json.loads(SOURCES_FILE.read_text(encoding='utf-8'))
    return []

def save_sources(sources):
    SOURCES_FILE.write_text(json.dumps(sources, indent=2, ensure_ascii=False), encoding='utf-8')

# ─── Google Drive helpers ─────────────────────────────────────────────
AUDIO_MIMES = {
    'audio/flac':'flac','audio/x-flac':'flac',
    'audio/mpeg':'mp3','audio/mp3':'mp3',
    'audio/mp4':'m4a','audio/x-m4a':'m4a',
    'audio/ogg':'ogg','audio/wav':'wav',
    'audio/x-wav':'wav','audio/webm':'webm',
    'audio/opus':'opus','audio/aac':'aac',
}
AUDIO_EXTS = {'.flac','.mp3','.m4a','.wav','.ogg','.opus','.webm','.aac','.wma'}

def is_audio(mime, name):
    return mime in AUDIO_MIMES or Path(name).suffix.lower() in AUDIO_EXTS

def get_fmt(mime, name):
    if mime in AUDIO_MIMES: return AUDIO_MIMES[mime]
    return Path(name).suffix.lower().lstrip('.') or 'audio'

def extract_folder_id(url):
    m = re.search(r'/folders/([a-zA-Z0-9_-]+)', url)
    return m.group(1) if m else None

def extract_file_id(url):
    m = re.search(r'/d/([a-zA-Z0-9_-]+)', url)
    if m: return m.group(1)
    m = re.search(r'id=([a-zA-Z0-9_-]+)', url)
    return m.group(1) if m else None

def parse_name(filename):
    stem = Path(filename).stem
    stem = re.sub(r'^\d+[\.\-\s]+', '', stem)
    parts = [p.strip() for p in stem.split(' - ')]
    if len(parts) >= 3:
        return {'artist': parts[0], 'album': parts[1], 'title': ' - '.join(parts[2:])}
    if len(parts) == 2:
        return {'artist': parts[0], 'album': '', 'title': parts[1]}
    return {'artist': '', 'album': '', 'title': stem}

def gdrive_list(folder_id, api_key, page_token=None):
    """List audio files in a Drive folder (non-recursive for simplicity)"""
    params = {
        'q': f"'{folder_id}' in parents and trashed=false",
        'fields': 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,modifiedTime)',
        'pageSize': 1000,
        'key': api_key,
    }
    if page_token:
        params['pageToken'] = page_token
    try:
        r = http_req.get('https://www.googleapis.com/drive/v3/files',
                         params=params, timeout=15)
        data = r.json()
        return data.get('files', []), data.get('nextPageToken')
    except Exception as e:
        return [], None

def gdrive_scan_folder_no_key(folder_id):
    """Deep recursive scraper for public Google Drive folder and all its subfolders without API Key"""
    visited = set()
    queue = [folder_id]
    all_tracks = []
    found_file_ids = set()

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }

    AUDIO_EXTS = {'flac', 'mp3', 'wav', 'm4a', 'ogg', 'opus', 'aac', 'wma'}

    while queue:
        current_fid = queue.pop(0)
        if current_fid in visited:
            continue
        visited.add(current_fid)

        url = f"https://drive.google.com/drive/folders/{current_fid}"
        try:
            r = http_req.get(url, headers=headers, timeout=15)
            html = r.text

            # Extract items: data-id="ID" ... aria-label="LABEL" or data-tooltip="LABEL"
            matches = re.findall(r'data-id="([a-zA-Z0-9_-]{25,45})"[^>]*?(?:aria-label|data-tooltip)="([^"]+)"', html)
            for fid, label in matches:
                if fid in visited or fid == current_fid:
                    continue

                # Strip trailing file type descriptors like " Audio", " Video", " Shared folder", etc.
                cleaned = re.sub(r'\s+(?:Audio|Video|Shared folder|Folder|Image|PDF|Text|Zip)$', '', label, flags=re.IGNORECASE).strip()

                if '.' in cleaned:
                    ext = cleaned.rsplit('.', 1)[-1].lower()
                    if ext in AUDIO_EXTS and fid not in found_file_ids:
                        found_file_ids.add(fid)
                        meta = parse_name(cleaned)
                        all_tracks.append({
                            'id': fid,
                            'filename': cleaned,
                            'title': meta['title'],
                            'artist': meta['artist'],
                            'album': meta['album'],
                            'format': ext,
                            'size': 0,
                            'thumbnail_id': None,
                            'modified': '',
                        })
                else:
                    # It's a subfolder ID -> queue for recursion
                    if fid not in visited and fid not in queue:
                        queue.append(fid)

            # Also check href="/drive/folders/SUBFOLDER_ID" for navigation subfolders
            subfolders_href = re.findall(r'/folders/([a-zA-Z0-9_-]{25,45})', html)
            for sfid in subfolders_href:
                if sfid not in visited and sfid not in queue and sfid != current_fid:
                    queue.append(sfid)

        except Exception as e:
            print(f"Error scraping folder {current_fid}:", e)

    return all_tracks



def gdrive_scan_folder(folder_id, api_key):
    """Recursively scan folder and return all audio tracks"""
    if not api_key:
        return gdrive_scan_folder_no_key(folder_id)

    tracks = []
    queue_ids = [folder_id]
    visited = set()

    while queue_ids:
        fid = queue_ids.pop(0)
        if fid in visited: continue
        visited.add(fid)

        page_token = None
        while True:
            files, next_tok = gdrive_list(fid, api_key, page_token)
            for f in files:
                mime = f.get('mimeType','')
                name = f.get('name','')
                if mime == 'application/vnd.google-apps.folder':
                    queue_ids.append(f['id'])
                elif is_audio(mime, name):
                    meta = parse_name(name)
                    tracks.append({
                        'id': f['id'],
                        'filename': name,
                        'title': meta['title'],
                        'artist': meta['artist'],
                        'album': meta['album'],
                        'format': get_fmt(mime, name),
                        'size': int(f.get('size', 0)),
                        'thumbnail_id': None,
                        'modified': f.get('modifiedTime',''),
                    })
            page_token = next_tok
            if not page_token:
                break
    
    # Fallback to web scraper if API key returned no tracks
    if not tracks:
        tracks = gdrive_scan_folder_no_key(folder_id)

    return tracks


def gdrive_file_meta(file_id, api_key):
    params = {'fields': 'id,name,mimeType,size', 'key': api_key}
    try:
        r = http_req.get(f'https://www.googleapis.com/drive/v3/files/{file_id}',
                         params=params, timeout=10)
        return r.json()
    except Exception:
        return {}

# ─── FFmpeg ───────────────────────────────────────────────────────────
def find_ffmpeg():
    import shutil as sh, glob
    found = sh.which('ffmpeg')
    if found: return found
    try:
        winget_paths = glob.glob(r'C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\**\ffmpeg.exe', recursive=True)
        if winget_paths: return winget_paths[0]
    except Exception:
        pass
    for p in [r'C:\ffmpeg\bin\ffmpeg.exe',
               r'C:\Program Files\ffmpeg\bin\ffmpeg.exe']:
        if os.path.exists(p): return p
    return None

FFMPEG_PATH_VAL  = find_ffmpeg()
FFMPEG_AVAILABLE = FFMPEG_PATH_VAL is not None

# ─── yt-dlp task state ────────────────────────────────────────────────
tasks      = {}
tasks_lock = threading.Lock()

def cleanup_task_dir(task_id, task_dir):
    try:
        if task_dir.exists(): shutil.rmtree(task_dir)
    except Exception: pass
    with tasks_lock: tasks.pop(task_id, None)

def startup_cleanup():
    if DOWNLOAD_DIR.exists():
        for item in DOWNLOAD_DIR.iterdir():
            if item.is_dir():
                try: shutil.rmtree(item)
                except Exception: pass

import time as _time

_STATIC_BUILD = str(int(_time.time()))

@app.before_request
def log_request_info():
    print(f"[REQ] {request.method} {request.path}", flush=True)

@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.errorhandler(Exception)
def handle_global_exception(e):
    if isinstance(e, HTTPException):
        return e
    print(f"[ERROR 500] Uncaught exception: {e}", flush=True)
    traceback.print_exc()
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Server Error', 'details': str(e)}), 500
    return "<h1>500 - Internal Server Error</h1><p>Terjadi kesalahan pada server. Silakan muat ulang halaman.</p>", 500

@app.route('/', strict_slashes=False)
def index():
    return send_from_directory('static', 'index.html')

@app.route('/player', strict_slashes=False)
def player():
    from flask import make_response
    resp = make_response(send_from_directory('static', 'player.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/admin', strict_slashes=False)
@app.route('/admin.html')
def admin_blocked():
    return {'error': 'Path /admin tidak ditemukan'}, 404

# Redirect old .html requests to clean URLs
@app.route('/index.html')
def redirect_index():
    return redirect('/', code=301)

@app.route('/player.html')
def redirect_player():
    return redirect('/player', code=301)







# ─── API: Status ──────────────────────────────────────────────────────
@app.route('/api/status')
def api_status():
    cfg = load_config()
    return jsonify({
        'ffmpeg_available': FFMPEG_AVAILABLE,
        'ffmpeg_path': FFMPEG_PATH_VAL,
        'api_key_set': bool(cfg.get('api_key')),
        'version': '2.0.0',
    })

# ─── API: Admin Auth & Config ──────────────────────────────────────────
@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    data = request.get_json() or {}
    password = data.get('password', '').strip()
    cfg = load_config()
    if password == cfg.get('admin_password', 'admin123'):
        token = str(uuid.uuid4())
        ADMIN_TOKENS.add(token)
        resp = jsonify({'ok': True, 'token': token})
        resp.set_cookie('admin_token', token, httponly=True, samesite='Lax', max_age=86400*7)
        return resp
    return jsonify({'error': 'Password admin salah'}), 401

@app.route('/api/admin/logout', methods=['POST'])
def api_admin_logout():
    token = request.headers.get('X-Admin-Token') or request.cookies.get('admin_token')
    if token in ADMIN_TOKENS:
        ADMIN_TOKENS.remove(token)
    resp = jsonify({'ok': True})
    resp.delete_cookie('admin_token')
    return resp

@app.route('/api/admin/change-password', methods=['POST'])
@admin_required
def api_admin_change_password():
    data = request.get_json() or {}
    new_pass = data.get('new_password', '').strip()
    if not new_pass or len(new_pass) < 4:
        return jsonify({'error': 'Password minimal 4 karakter'}), 400
    cfg = load_config()
    cfg['admin_password'] = new_pass
    save_config(cfg)
    return jsonify({'ok': True})

@app.route('/api/admin/config', methods=['GET','POST'])
@admin_required
def api_admin_config():
    if request.method == 'GET':
        cfg = load_config()
        safe = dict(cfg)
        safe.pop('admin_password', None)
        if safe.get('api_key'):
            safe['api_key'] = safe['api_key'][:8] + '...' + safe['api_key'][-4:]
        return jsonify(safe)
    data = request.get_json()
    cfg  = load_config()
    if 'api_key' in data: cfg['api_key'] = data['api_key']
    if 'music_dir' in data: cfg['music_dir'] = data['music_dir']
    if 'auto_scan_enabled' in data: cfg['auto_scan_enabled'] = bool(data['auto_scan_enabled'])
    if 'auto_scan_interval_minutes' in data: cfg['auto_scan_interval_minutes'] = int(data['auto_scan_interval_minutes'])
    save_config(cfg)
    return jsonify({'ok': True})

@app.route('/api/admin/scan-all', methods=['POST'])
@admin_required
def api_admin_scan_all():
    sources = load_sources()
    scanned_count = 0
    for s in sources:
        if s.get('enabled', True):
            threading.Thread(target=do_scan_source_backend, args=(s['id'],), daemon=True).start()
            scanned_count += 1
    return jsonify({'ok': True, 'count': scanned_count})

def do_scan_source_backend(source_id):
    """Background scanner worker for a source"""
    sources = load_sources()
    idx = next((i for i,s in enumerate(sources) if s['id']==source_id), None)
    if idx is None: return

    cfg = load_config()
    api_key = cfg.get('api_key','')
    src = sources[idx]
    src['status'] = 'scanning'
    save_sources(sources)
    try:
        if src['type'] == 'gdrive_folder':
            tracks = gdrive_scan_folder(src['folder_id'], api_key)
        else:
            meta = gdrive_file_meta(src['file_id'], api_key)
            name = meta.get('name','track')
            m = parse_name(name)
            tracks = [{
                'id': src['file_id'],
                'filename': name,
                'title': m['title'],
                'artist': m['artist'],
                'album': m['album'],
                'format': get_fmt(meta.get('mimeType',''), name),
                'size': int(meta.get('size',0)),
                'thumbnail_id': None,
                'modified': '',
            }]

        cache_f = CACHE_DIR / f"{source_id}.json"
        cache_f.write_text(json.dumps({'tracks': tracks, 'source_id': source_id},
                                      indent=2, ensure_ascii=False), encoding='utf-8')
        src['track_count'] = len(tracks)
        src['status'] = 'ready'
        src['last_scanned'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    except Exception as e:
        src['status'] = 'error'
        src['error'] = str(e)[:200]
    save_sources(sources)



# ─── API: Admin – Sources ─────────────────────────────────────────────
@app.route('/api/admin/sources', methods=['GET','POST'])
def api_admin_sources():
    if request.method == 'GET':
        is_admin = check_admin_auth(request)
        sources = load_sources()
        if not is_admin:
            return jsonify([{
                'id': s['id'],
                'name': s['name'],
                'color': s.get('color','#10b981'),
                'track_count': s.get('track_count', 0)
            } for s in sources if s.get('enabled', True)])
        return jsonify(sources)
    
    if not check_admin_auth(request):
        return jsonify({'error': 'Akses ditolak.'}), 401

    data = request.get_json()
    url  = data.get('url','').strip()
    name = data.get('name','').strip() or 'Drive Source'
    color = data.get('color','#10b981')

    folder_id = extract_folder_id(url)
    file_id   = extract_file_id(url) if not folder_id else None
    src_type  = 'gdrive_folder' if folder_id else ('gdrive_file' if file_id else None)

    if not src_type:
        return jsonify({'error': 'URL tidak valid. Gunakan link Google Drive folder atau file.'}), 400

    src = {
        'id': str(uuid.uuid4()),
        'name': name,
        'type': src_type,
        'url': url,
        'folder_id': folder_id,
        'file_id': file_id,
        'color': color,
        'enabled': True,
        'status': 'scanning',  # Auto-start scanning
        'track_count': 0,
        'last_scanned': None,
    }
    sources = load_sources()
    sources.append(src)
    save_sources(sources)

    # Immediately launch auto-scan in background thread
    t = threading.Thread(target=do_scan_source_backend, args=(src['id'],), daemon=True)
    t.start()

    return jsonify(src)

@app.route('/api/admin/sources/<source_id>', methods=['PUT','DELETE'])
@admin_required
def api_admin_source(source_id):
    sources = load_sources()
    idx = next((i for i,s in enumerate(sources) if s['id']==source_id), None)
    if idx is None:
        return jsonify({'error': 'Source tidak ditemukan'}), 404
    if request.method == 'DELETE':
        sources.pop(idx)
        save_sources(sources)
        cache_f = CACHE_DIR / f"{source_id}.json"
        if cache_f.exists(): cache_f.unlink()
        return jsonify({'ok': True})
    data = request.get_json()
    for key in ('name','color','enabled'):
        if key in data: sources[idx][key] = data[key]
    save_sources(sources)
    return jsonify(sources[idx])

@app.route('/api/admin/sources/<source_id>/scan', methods=['POST'])
@admin_required
def api_admin_scan(source_id):
    t = threading.Thread(target=do_scan_source_backend, args=(source_id,), daemon=True)
    t.start()
    return jsonify({'ok': True, 'status': 'scanning'})

# ─── API: Library ─────────────────────────────────────────────────────
@app.route('/api/library')
def api_library():
    """Return all tracks from all enabled sources"""
    sources = load_sources()
    all_tracks = []
    for src in sources:
        if not src.get('enabled', True): continue
        cache_f = CACHE_DIR / f"{src['id']}.json"
        if cache_f.exists():
            try:
                data = json.loads(cache_f.read_text(encoding='utf-8'))
                for t in data.get('tracks', []):
                    t['source_id']   = src['id']
                    t['source_name'] = src['name']
                    t['source_color']= src.get('color','#a855f7')
                    all_tracks.append(t)
            except Exception:
                pass

    # Sort by artist then title
    all_tracks.sort(key=lambda t: (t.get('artist','').lower(), t.get('title','').lower()))

    q = request.args.get('q','').lower()
    if q:
        all_tracks = [t for t in all_tracks if q in t.get('title','').lower()
                      or q in t.get('artist','').lower()
                      or q in t.get('album','').lower()]

    return jsonify({'tracks': all_tracks, 'total': len(all_tracks)})

@app.route('/api/library/stats')
def api_library_stats():
    sources = load_sources()
    total_tracks = 0
    total_size   = 0
    for src in sources:
        cache_f = CACHE_DIR / f"{src['id']}.json"
        if cache_f.exists():
            try:
                data = json.loads(cache_f.read_text(encoding='utf-8'))
                tracks = data.get('tracks', [])
                total_tracks += len(tracks)
                total_size   += sum(t.get('size',0) for t in tracks)
            except Exception:
                pass
    return jsonify({
        'sources': len(sources),
        'tracks': total_tracks,
        'size_bytes': total_size,
        'size_gb': round(total_size / 1e9, 2),
    })

# ─── API: Stream (Drive proxy + Instant Transcoding Engine) ────────────
@app.route('/api/stream/gdrive/<file_id>')
def api_stream_gdrive(file_id):
    cfg = load_config()
    api_key = cfg.get('api_key','')
    quality = request.args.get('quality', 'original').lower()

    if api_key:
        drive_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
    else:
        drive_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"

    # Handle Transcoded Quality (320k, 192k, 128k)
    if quality in ('320k', '192k', '128k') and FFMPEG_AVAILABLE:
        transcode_cache = CACHE_DIR / f"transcode_{file_id}_{quality}.mp3"
        if transcode_cache.exists() and transcode_cache.stat().st_size > 10000:
            return send_file(transcode_cache, mimetype='audio/mpeg', conditional=True)
        
        # Trigger background transcoding so future plays hit instant disk cache
        def bg_transcode():
            try:
                cmd = [FFMPEG_PATH_VAL, '-y', '-i', drive_url, '-vn', '-b:a', quality, '-f', 'mp3', str(transcode_cache)]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            except Exception as err:
                print(f"[BG TRANSCODE ERROR] {err}", flush=True)

        threading.Thread(target=bg_transcode, daemon=True).start()

    # Instant Original stream (<0.3s start latency)
    range_hdr  = request.headers.get('Range')
    fwd_headers = {'Range': range_hdr} if range_hdr else {}
    fwd_headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

    try:
        dr = http_req.get(drive_url, headers=fwd_headers, stream=True, timeout=30)
    except Exception as e:
        return jsonify({'error': str(e)}), 502

    def generate():
        for chunk in dr.iter_content(chunk_size=262144):
            if chunk: yield chunk

    mime = dr.headers.get('Content-Type', 'audio/flac')
    if 'text/html' in mime: mime = 'audio/flac'

    resp_headers = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
    }
    if 'Content-Length' in dr.headers:
        resp_headers['Content-Length'] = dr.headers['Content-Length']
    if 'Content-Range' in dr.headers:
        resp_headers['Content-Range'] = dr.headers['Content-Range']

    status = 206 if range_hdr else 200
    return Response(stream_with_context(generate()), status=status, headers=resp_headers)

# ─── API: Download from Drive ─────────────────────────────────────────
@app.route('/api/download/gdrive/<file_id>', methods=['GET', 'HEAD'])
def api_download_gdrive(file_id):
    cfg = load_config()
    api_key  = cfg.get('api_key','')
    save_local = request.args.get('save', 'false').lower() == 'true'

    # Auto-resolve exact filename from cache or query param
    filename = request.args.get('filename', '').strip()
    if not filename:
        for cache_f in CACHE_DIR.glob('*.json'):
            try:
                cdata = json.loads(cache_f.read_text(encoding='utf-8'))
                for t in cdata.get('tracks', []):
                    if t['id'] == file_id:
                        filename = t.get('filename')
                        break
            except Exception:
                pass
            if filename: break

    if not filename:
        filename = f"{file_id}.flac"

    mime = "audio/flac" if filename.endswith('.flac') else ("audio/mpeg" if filename.endswith('.mp3') else "application/octet-stream")

    if api_key:
        drive_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
    else:
        drive_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"

    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'}


    if save_local:
        dest = MUSIC_DIR / filename
        try:
            dr = http_req.get(drive_url, headers=headers, stream=True, timeout=60)
            with open(dest, 'wb') as f:
                for chunk in dr.iter_content(chunk_size=65536):
                    if chunk: f.write(chunk)
            return jsonify({'ok': True, 'saved_to': str(dest)})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        dr = http_req.get(drive_url, headers=headers, stream=True, timeout=30)
        def generate():
            for chunk in dr.iter_content(chunk_size=65536):
                if chunk: yield chunk
        
        # Sanitize filename for HTTP header
        safe_filename = filename.replace('"', '\\"')
        return Response(stream_with_context(generate()),
                        headers={
                            'Content-Disposition': f'attachment; filename="{safe_filename}"',
                            'Content-Type': mime,
                            'Content-Length': dr.headers.get('Content-Length',''),
                        })



# ─── API: Cover art (Embedded Audio Art + iTunes/Deezer Match) ───────────
@app.route('/api/art/gdrive/<file_id>')
def api_art_gdrive(file_id):
    print(f"[ART] Request for {file_id}", flush=True)
    art_cache = CACHE_DIR / f"art_{file_id}.jpg"
    if art_cache.exists() and art_cache.stat().st_size > 100:
        print(f"[ART] Serving from cache: {art_cache}", flush=True)
        return Response(art_cache.read_bytes(), content_type='image/jpeg')

    # Find track info from cache
    track_title = ''
    track_artist = ''
    for cache_f in CACHE_DIR.glob('*.json'):
        if cache_f.name.startswith('art_'): continue
        try:
            cdata = json.loads(cache_f.read_text(encoding='utf-8'))
            for t in cdata.get('tracks', []):
                if t.get('id') == file_id:
                    track_title = t.get('title', '')
                    track_artist = t.get('artist', '')
                    break
        except Exception:
            pass
        if track_title or track_artist: break

    cfg = load_config()
    api_key = cfg.get('api_key', '')

    # 1. Extract embedded artwork via Mutagen from initial 2MB stream
    try:
        if api_key:
            drive_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
        else:
            drive_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
        
        headers = {
            'Range': 'bytes=0-2097152',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        dr = http_req.get(drive_url, headers=headers, allow_redirects=True, timeout=10)
        if dr.status_code in (200, 206) and len(dr.content) > 1000:
            import io, mutagen
            mf = mutagen.File(io.BytesIO(dr.content))
            if mf is not None:
                img_bytes = None
                if hasattr(mf, 'pictures') and mf.pictures:
                    img_bytes = mf.pictures[0].data
                elif hasattr(mf, 'tags') and mf.tags:
                    for k, v in mf.tags.items():
                        if k.startswith('APIC'):
                            img_bytes = getattr(v, 'data', None)
                            if img_bytes: break
                elif hasattr(mf, 'get'):
                    covr = mf.get('covr')
                    if covr and len(covr) > 0:
                        img_bytes = bytes(covr[0])
                
                if img_bytes and len(img_bytes) > 500:
                    art_cache.write_bytes(img_bytes)
                    return Response(img_bytes, content_type='image/jpeg')
    except Exception:
        pass

    # 2. Match iTunes & Deezer for High-Res Cover Art (cleaned title/artist query)
    raw_q = f"{track_artist} {track_title}".strip()
    clean_q = re.sub(r'[_.-]+', ' ', raw_q).strip()
    
    if clean_q:
        # iTunes API
        try:
            r = http_req.get(f"https://itunes.apple.com/search?term={http_req.utils.quote(clean_q)}&media=music&limit=1", timeout=5).json()
            if r.get('results'):
                url = r['results'][0]['artworkUrl100'].replace('100x100bb.jpg', '600x600bb.jpg')
                img = http_req.get(url, timeout=5)
                if img.status_code == 200 and len(img.content) > 500:
                    art_cache.write_bytes(img.content)
                    return Response(img.content, content_type='image/jpeg')
        except Exception:
            pass

        # Deezer API
        try:
            r = http_req.get(f"https://api.deezer.com/search?q={http_req.utils.quote(clean_q)}", timeout=5).json()
            if r.get('data'):
                url = r['data'][0]['album']['cover_big']
                img = http_req.get(url, timeout=5)
                if img.status_code == 200 and len(img.content) > 500:
                    art_cache.write_bytes(img.content)
                    return Response(img.content, content_type='image/jpeg')
        except Exception:
            pass

    # 3. Fallback to Drive thumbnail
    thumb_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w500"
    try:
        img = http_req.get(thumb_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        if img.status_code == 200 and len(img.content) > 500:
            return Response(img.content, content_type=img.headers.get('Content-Type','image/jpeg'))
    except Exception:
        pass

    return '', 404


# ─── API: yt-dlp Search ───────────────────────────────────────────────
@app.route('/api/search')
def api_search():
    query = request.args.get('q','').strip()
    limit = min(int(request.args.get('limit',12)), 24)
    if not query:
        return jsonify({'error': 'Query tidak boleh kosong'}), 400
    ydl_opts = {'quiet':True,'no_warnings':True,'extract_flat':True,'skip_download':True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        results = []
        for e in (info.get('entries') or []):
            if not e: continue
            results.append({
                'id': e.get('id',''),
                'title': e.get('title','Unknown'),
                'uploader': e.get('uploader') or e.get('channel','Unknown'),
                'duration': e.get('duration'),
                'thumbnail': e.get('thumbnail') or f"https://i.ytimg.com/vi/{e.get('id','')}/hqdefault.jpg",
                'url': e.get('url') or f"https://www.youtube.com/watch?v={e.get('id','')}",
                'view_count': e.get('view_count'),
            })
        return jsonify({'results': results, 'query': query})
    except Exception as e:
        return jsonify({'error': str(e)[:300]}), 500

# ─── API: yt-dlp Info ─────────────────────────────────────────────────
@app.route('/api/info', methods=['POST'])
def api_info():
    data = request.get_json()
    url  = data.get('url','').strip()
    if not url:
        return jsonify({'error': 'URL tidak boleh kosong'}), 400
    ydl_opts = {'quiet':True,'no_warnings':True,'skip_download':True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return jsonify({
            'title': info.get('title','Unknown'),
            'uploader': info.get('uploader') or info.get('channel','Unknown'),
            'duration': info.get('duration'),
            'thumbnail': info.get('thumbnail'),
            'webpage_url': info.get('webpage_url', url),
            'is_playlist': info.get('_type') == 'playlist',
            'count': len(info.get('entries',[])) if info.get('_type')=='playlist' else 1,
        })
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 400

# ─── API: yt-dlp Download ─────────────────────────────────────────────
@app.route('/api/download', methods=['POST'])
def api_download():
    data = request.get_json()
    url  = data.get('url','').strip()
    fmt  = data.get('format','flac').lower()
    if not url:
        return jsonify({'error': 'URL tidak boleh kosong'}), 400
    valid_fmts = ['flac','opus','m4a','mp3','wav','best']
    if fmt not in valid_fmts: fmt = 'flac'
    needs_ffmpeg = fmt in ['flac','mp3','wav']
    if needs_ffmpeg and not FFMPEG_AVAILABLE: fmt = 'opus'

    task_id  = str(uuid.uuid4())
    task_dir = DOWNLOAD_DIR / task_id
    task_dir.mkdir(exist_ok=True)

    with tasks_lock:
        tasks[task_id] = {
            'status':'starting','progress':0,'speed':'','eta':'',
            'filename':None,'title':'','error':None,'format':fmt,
        }

    t = threading.Thread(target=download_task, args=(task_id, url, fmt, task_dir), daemon=True)
    t.start()
    return jsonify({'task_id': task_id, 'format': fmt, 'ffmpeg_available': FFMPEG_AVAILABLE})

def download_task(task_id, url, fmt, task_dir):
    def progress_hook(d):
        if d.get('status') == 'downloading':
            pct_str = d.get('_percent_str','0%').strip().replace('%','')
            try:    pct = float(pct_str)
            except: pct = 0
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id].update({'status':'downloading','progress':round(pct,1),
                                           'speed':d.get('_speed_str',''),'eta':d.get('_eta_str','')})
        elif d.get('status') == 'finished':
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id].update({'status':'processing','progress':95,'speed':'','eta':''})

    outtmpl = str(task_dir / '%(title)s.%(ext)s')
    if fmt in ('opus','best') or (fmt=='opus' and not FFMPEG_AVAILABLE):
        ydl_opts = {'format':'bestaudio/best','outtmpl':outtmpl,'quiet':True,
                    'no_warnings':True,'progress_hooks':[progress_hook]}
    else:
        codec_map = {'flac':'flac','mp3':'mp3','m4a':'m4a','wav':'wav'}
        codec = codec_map.get(fmt,'flac')
        quality = '0' if fmt in ('flac','wav') else '320' if fmt=='mp3' else '0'
        ydl_opts = {
            'format':'bestaudio/best','outtmpl':outtmpl,'quiet':True,'no_warnings':True,
            'progress_hooks':[progress_hook],
            'postprocessors':[
                {'key':'FFmpegExtractAudio','preferredcodec':codec,'preferredquality':quality},
                {'key':'EmbedThumbnail'},
                {'key':'FFmpegMetadata','add_metadata':True},
            ],
            'writethumbnail': True,
        }
        if FFMPEG_PATH_VAL:
            ydl_opts['ffmpeg_location'] = os.path.dirname(FFMPEG_PATH_VAL)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title','audio')

        files = list(task_dir.glob('*.*'))
        if not files: raise Exception('File tidak ditemukan setelah download')

        target = next((f for f in files if f.suffix.lstrip('.')==fmt), None)
        if not target: target = max(files, key=lambda f: f.stat().st_size)

        with tasks_lock:
            tasks[task_id].update({'status':'done','progress':100,
                                   'filename':target.name,'filepath':str(target),
                                   'title':title,'error':None})

        timer = threading.Timer(600, cleanup_task_dir, args=[task_id, task_dir])
        timer.daemon = True
        timer.start()
    except Exception as e:
        with tasks_lock:
            if task_id in tasks:
                tasks[task_id].update({'status':'error','error':str(e)[:500]})

@app.route('/api/progress/<task_id>')
def api_progress(task_id):
    def generate():
        last = None
        for _ in range(600):
            with tasks_lock:
                task = tasks.get(task_id)
            if task is None:
                yield f"data: {json.dumps({'status':'not_found'})}\n\n"; break
            cur = {k: task.get(k) for k in ('status','progress','speed','eta','filename','title','error','format')}
            if cur != last:
                yield f"data: {json.dumps(cur)}\n\n"
                last = cur.copy()
            if task['status'] in ('done','error'): break
            time.sleep(0.5)
    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@app.route('/api/file/<task_id>')
def api_file(task_id):
    with tasks_lock: task = tasks.get(task_id)
    if not task or task['status'] != 'done':
        return jsonify({'error': 'File tidak tersedia'}), 404
    fp = task.get('filepath')
    if not fp or not os.path.exists(fp):
        return jsonify({'error': 'File tidak ditemukan'}), 404
    return send_file(fp, as_attachment=True, download_name=task['filename'])

@app.route('/api/cleanup/<task_id>', methods=['DELETE'])
def api_cleanup(task_id):
    with tasks_lock: task = tasks.get(task_id)
    if task:
        cleanup_task_dir(task_id, DOWNLOAD_DIR / task_id)
    return jsonify({'ok': True})

# Serve root-level CSS/JS assets without intercepting multi-segment API routes
@app.route('/<filename>')
def serve_root_assets(filename):
    if filename.startswith('api'):
        return {'error': 'API route tidak ditemukan'}, 404
    clean_name = filename.rstrip('/')
    cfg = load_config()
    secret_path = cfg.get('admin_secret_path', 'admin-c11cc-secret-9f8a7b6c')
    static_dir = os.path.abspath('static')

    if clean_name in ('admin', 'admin.html'):
        return {'error': 'Path /admin tidak ditemukan'}, 404
    if clean_name == 'player':
        return send_from_directory(static_dir, 'player.html')
    if clean_name in (secret_path, f"{secret_path}.html"):
        return send_from_directory(static_dir, 'admin.html')

    if os.path.exists(os.path.join(static_dir, filename)):
        from flask import make_response
        resp = make_response(send_from_directory(static_dir, filename))
        if filename.endswith(('.css', '.js')):
            resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            resp.headers['Surrogate-Control'] = 'no-store'
        return resp
    return {'error': f'Path /{filename} tidak ditemukan'}, 404

def background_audio_cacher():
    time.sleep(3)
    print("[PRE-CACHE WORKER] Pre-caching audio tracks for instant playback...", flush=True)
    for cache_f in CACHE_DIR.glob('*.json'):
        if cache_f.name.startswith('art_'): continue
        try:
            cdata = json.loads(cache_f.read_text(encoding='utf-8'))
            for t in cdata.get('tracks', []):
                fid = t['id']
                for q in ['128k', '320k']:
                    t_file = CACHE_DIR / f"transcode_{fid}_{q}.mp3"
                    if not t_file.exists() or t_file.stat().st_size < 10000:
                        drive_url = f"https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t"
                        if FFMPEG_AVAILABLE:
                            cmd = [FFMPEG_PATH_VAL, '-y', '-i', drive_url, '-vn', '-b:a', q, '-f', 'mp3', str(t_file)]
                            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
                            print(f"[PRE-CACHE OK] {t.get('title')} ({q})", flush=True)
        except Exception:
            pass

def background_autoscan_worker():
    """Background worker thread that automatically scans all Google Drive sources for new music files"""
    time.sleep(12)
    while True:
        try:
            cfg = load_config()
            enabled = cfg.get('auto_scan_enabled', True)
            interval_mins = max(1, int(cfg.get('auto_scan_interval_minutes', 15)))

            if enabled:
                print(f"[AUTO-SCAN WORKER] Checking active sources for new music files...", flush=True)
                sources = load_sources()
                for s in sources:
                    if s.get('enabled', True):
                        do_scan_source_backend(s['id'])
                cfg['last_auto_scan'] = time.time()
                save_config(cfg)
                print(f"[AUTO-SCAN OK] Completed checking all active Google Drive sources.", flush=True)

        except Exception as e:
            print(f"[AUTO-SCAN ERROR] {e}", flush=True)

        cfg = load_config()
        interval_mins = max(1, int(cfg.get('auto_scan_interval_minutes', 15)))
        time.sleep(interval_mins * 60)

# ─── Run ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    startup_cleanup()
    threading.Thread(target=background_audio_cacher, daemon=True).start()
    threading.Thread(target=background_autoscan_worker, daemon=True).start()
    print("=" * 55)
    print("  [*] SoundVault v2.0  |  http://localhost:5000")
    print("=" * 55)
    print(f"  Downloader : http://localhost:5000/")
    print(f"  Player     : http://localhost:5000/player")
    print(f"  Admin      : http://localhost:5000/admin")
    print("=" * 55)
    if FFMPEG_AVAILABLE:
        print(f"  [OK] FFmpeg: {FFMPEG_PATH_VAL}")
    else:
        print("  [!]  FFmpeg tidak ditemukan")
    print("=" * 55)
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)
