# 🎵 SoundVault – FLAC Music Downloader

Web app lokal untuk mencari dan mendownload musik berkualitas tinggi (FLAC, OPUS, M4A, MP3).

---

## ⚡ Cara Cepat Mulai

### 1. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 2. Jalankan server
```bash
python app.py
```

### 3. Buka browser
```
http://localhost:5000
```

---

## 🔧 Install FFmpeg (Wajib untuk FLAC/MP3/WAV)

Tanpa FFmpeg, hanya format **OPUS** yang tersedia.

### Windows (Cara Termudah)
1. Download dari: https://www.gyan.dev/ffmpeg/builds/
2. Pilih `ffmpeg-release-essentials.zip`
3. Extract ke `C:\ffmpeg\`
4. Pastikan ada file: `C:\ffmpeg\bin\ffmpeg.exe`
5. **Restart** `python app.py` → FFmpeg otomatis terdeteksi ✅

### Alternatif via winget
```powershell
winget install Gyan.FFmpeg
```

### Alternatif via Chocolatey
```powershell
choco install ffmpeg
```

---

## 📋 Format Audio

| Format | Kualitas | Butuh FFmpeg | Keterangan |
|--------|----------|:---:|---|
| **FLAC** | Lossless | ✅ | File terbesar, kualitas terbaik |
| **OPUS** | ~160kbps | ❌ | Native YouTube, ukuran kecil |
| **M4A**  | ~128kbps | ✅ | AAC, kompatibel luas |
| **MP3**  | 320kbps  | ✅ | Universal, ukuran sedang |

> **Catatan**: YouTube tidak menyimpan audio lossless. FLAC dari YouTube = audio Opus/AAC yang dikemas ulang ke container lossless. Tidak ada peningkatan kualitas dibanding OPUS.

---

## 🚀 Fitur

- 🔍 **Pencarian musik** langsung dari YouTube (yt-dlp)
- 🔗 **Paste URL langsung** untuk YouTube, SoundCloud, dll.
- 📊 **Progress bar real-time** via Server-Sent Events
- 🎵 **Antrian download** dengan status per lagu
- 🏷️ **Metadata otomatis** (judul, artis, thumbnail di-embed)
- 🗑️ **Auto-cleanup** file setelah 10 menit
- 📱 **Responsive** untuk mobile & desktop

---

## 📁 Struktur Folder

```
e:\flac\
├── app.py              # Flask backend
├── requirements.txt    # Python dependencies
├── README.md           # Dokumentasi ini
├── static/
│   ├── index.html      # Frontend SPA
│   ├── style.css       # Styling premium dark
│   └── app.js          # Frontend logic
└── downloads/          # Folder sementara (auto-dibuat)
```

---

## ⚠️ Disclaimer

Gunakan hanya untuk musik yang Anda miliki haknya atau yang berada di domain publik.
Hormati Terms of Service platform sumber dan hak cipta kreator konten.
