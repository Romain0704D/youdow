/**
 * YouDow – app.js
 *
 * Tab 1 (Download):
 *   YouTube URL → oEmbed metadata → format picker → Cobalt API → download
 *
 * Tab 2 (Crop):
 *   Local file upload → HTML5 video preview → dual-handle time range →
 *   FFmpeg.wasm (single-threaded core, no SharedArrayBuffer needed) → download
 */

/* =========================================================
   Helpers
   ========================================================= */

/** Extract YouTube video ID from any common URL form. */
function extractVideoId(url) {
  const re =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(re);
  return m ? m[1] : null;
}

/** Format seconds → "m:ss" or "h:mm:ss". */
function fmtTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** Parse "m:ss" or "h:mm:ss" (or bare seconds) → seconds. */
function parseTime(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/* =========================================================
   TAB SWITCHING
   ========================================================= */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

/* =========================================================
   TAB 1 – DOWNLOAD
   ========================================================= */

const COBALT_API = 'https://api.cobalt.tools/';

const state = {
  videoId: null,
  videoTitle: '',
  mode: 'auto',
  quality: '1080',
  ext: 'mp4',
};

const urlInput   = document.getElementById('urlInput');
const fetchBtn   = document.getElementById('fetchBtn');
const urlError   = document.getElementById('urlError');
const videoCard  = document.getElementById('videoCard');
const thumbnail  = document.getElementById('thumbnail');
const playBtn    = document.getElementById('playBtn');
const embedWrap  = document.getElementById('embedWrap');
const videoEmbed = document.getElementById('videoEmbed');
const videoTitleEl  = document.getElementById('videoTitle');
const videoAuthorEl = document.getElementById('videoAuthor');
const downloadBtn   = document.getElementById('downloadBtn');
const dlProgress    = document.getElementById('dlProgress');
const dlBar         = document.getElementById('dlBar');
const dlStatus      = document.getElementById('dlStatus');
const dlMsg         = document.getElementById('dlMsg');

/* ----- Show / hide messages ----- */
function setUrlError(msg) {
  urlError.textContent = msg;
}

function setDlMsg(msg, type) {
  dlMsg.textContent = msg;
  dlMsg.className = `status-msg ${type}`;
}

function setDlProgress(pct, label) {
  dlBar.style.width = `${pct}%`;
  dlStatus.textContent = label;
  dlProgress.classList.remove('hidden');
}

/* ----- Format cards ----- */
document.querySelectorAll('.fmt').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.fmt').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    state.mode    = card.dataset.mode;
    state.quality = card.dataset.quality;
    state.ext     = card.dataset.ext;
  });
});

/* ----- Fetch video info (oEmbed) ----- */
async function fetchVideoInfo(rawUrl) {
  setUrlError('');
  const vid = extractVideoId(rawUrl);
  if (!vid) {
    setUrlError('URL YouTube invalide. Vérifiez le lien et réessayez.');
    return;
  }

  state.videoId = vid;
  fetchBtn.disabled = true;
  fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement…';
  videoCard.classList.add('hidden');
  setDlMsg('', '');

  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`
    );
    if (!oembed.ok) throw new Error('Vidéo introuvable ou privée.');
    const data = await oembed.json();

    state.videoTitle = data.title;

    /* Thumbnail – try maxres, fall back to hq.
       encodeURIComponent guards against any unexpected characters in vid. */
    const safeVid = encodeURIComponent(vid);
    thumbnail.src = `https://img.youtube.com/vi/${safeVid}/maxresdefault.jpg`;
    thumbnail.onerror = () => {
      thumbnail.src = `https://img.youtube.com/vi/${safeVid}/hqdefault.jpg`;
    };

    videoTitleEl.textContent = data.title;

    /* Build author line safely – avoid innerHTML with untrusted API data */
    const authorIcon = document.createElement('i');
    authorIcon.className = 'fas fa-user';
    videoAuthorEl.textContent = '';
    videoAuthorEl.appendChild(authorIcon);
    videoAuthorEl.appendChild(
      document.createTextNode(' ' + (data.author_name || 'Inconnu'))
    );

    /* Reset embed */
    embedWrap.classList.add('hidden');
    playBtn.style.display = '';
    videoEmbed.src = '';

    videoCard.classList.remove('hidden');
    videoCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    setUrlError(`Erreur : ${err.message}`);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '<i class="fas fa-search"></i> <span>Analyser</span>';
  }
}

/* ----- Play overlay → embed ----- */
playBtn.addEventListener('click', () => {
  playBtn.style.display = 'none';
  embedWrap.classList.remove('hidden');
  /* encodeURIComponent ensures no unexpected characters reach the iframe src */
  videoEmbed.src = `https://www.youtube.com/embed/${encodeURIComponent(state.videoId)}?autoplay=1`;
});

/* ----- URL input events ----- */
fetchBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) { setUrlError('Veuillez entrer une URL YouTube.'); return; }
  fetchVideoInfo(url);
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchBtn.click();
});

/* Auto-fetch on paste.
   PASTE_DEBOUNCE_MS: clipboard text isn't available in the input.value immediately on
   the paste event; a short delay lets the browser finish inserting the pasted content. */
const PASTE_DEBOUNCE_MS = 80;
urlInput.addEventListener('paste', () => {
  setTimeout(() => {
    const url = urlInput.value.trim();
    if (url && extractVideoId(url)) fetchVideoInfo(url);
  }, PASTE_DEBOUNCE_MS);
});

/* ----- Download via Cobalt API ----- */
downloadBtn.addEventListener('click', async () => {
  if (!state.videoId) {
    setDlMsg('Analysez d\'abord une vidéo.', 'error');
    return;
  }

  downloadBtn.disabled = true;
  dlMsg.className = 'status-msg';
  setDlProgress(10, 'Connexion au serveur…');

  try {
    const body = {
      url: `https://www.youtube.com/watch?v=${state.videoId}`,
      downloadMode: state.mode,
    };

    if (state.mode === 'audio') {
      body.audioFormat = state.ext;
    } else {
      body.videoQuality = state.quality;
    }

    const res = await fetch(COBALT_API, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Serveur cobalt a répondu ${res.status}${errText ? ': ' + errText : ''}`);
    }

    const data = await res.json();

    if (data.status === 'error') {
      throw new Error(
        data.error?.code || data.text || 'Le serveur de téléchargement a renvoyé une erreur.'
      );
    }

    const downloadUrl = data.url;
    if (!downloadUrl) {
      throw new Error('Aucune URL de téléchargement reçue.');
    }

    setDlProgress(90, 'Ouverture du téléchargement…');

    /* Trigger browser download */
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = data.filename || `${state.videoTitle || 'video'}.${state.ext}`;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setDlProgress(100, 'Téléchargement démarré !');
    setTimeout(() => {
      dlProgress.classList.add('hidden');
      setDlMsg('✓ Téléchargement lancé avec succès !', 'success');
    }, 1200);
  } catch (err) {
    dlProgress.classList.add('hidden');
    console.error('[YouDow Download]', err);
    setDlMsg(
      `Erreur : ${err.message}. Vérifiez que l'URL est correcte et que la vidéo est publique.`,
      'error'
    );
  } finally {
    downloadBtn.disabled = false;
  }
});

/* =========================================================
   TAB 2 – CROP (FFmpeg.wasm single-threaded)
   ========================================================= */

const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const cropEditor  = document.getElementById('cropEditor');
const cropPlayer  = document.getElementById('cropPlayer');
const cropFileName = document.getElementById('cropFileName');
const sliderStart  = document.getElementById('sliderStart');
const sliderEnd    = document.getElementById('sliderEnd');
const trackFill    = document.getElementById('trackFill');
const rangeDisplay = document.getElementById('rangeDisplay');
const startInput   = document.getElementById('startInput');
const endInput     = document.getElementById('endInput');
const cropSelInfo  = document.getElementById('cropSelInfo');
const cropFmt      = document.getElementById('cropFmt');
const cropBtn      = document.getElementById('cropBtn');
const cropProgress = document.getElementById('cropProgress');
const cropBar      = document.getElementById('cropBar');
const cropStatus   = document.getElementById('cropStatus');
const cropMsg      = document.getElementById('cropMsg');

/* 1000 steps gives sub-second precision for videos up to ~16 minutes without
   being a performance burden for the DOM slider repaint on every mouse move. */
const SLIDER_RESOLUTION = 1000;

let cropFile = null;    /* the loaded File object */
let videoDur = 0;       /* duration in seconds */
let ffmpegInst = null;  /* FFmpeg instance */

/* ---- Drop zone ---- */
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCropFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadCropFile(fileInput.files[0]);
});

/* Also allow clicking the drop zone itself to open file browser */
dropZone.addEventListener('click', (e) => {
  if (e.target === dropZone || e.target.tagName === 'P' || e.target.tagName === 'I') {
    fileInput.click();
  }
});

function loadCropFile(file) {
  cropFile = file;

  /* Build filename label safely – avoid innerHTML with user-controlled file.name */
  const fileIcon = document.createElement('i');
  fileIcon.className = 'fas fa-file-video';
  cropFileName.textContent = '';
  cropFileName.appendChild(fileIcon);
  cropFileName.appendChild(document.createTextNode(' ' + file.name));

  const objectUrl = URL.createObjectURL(file);
  /* Guard: createObjectURL always returns a blob: URL; verify before assigning to src */
  if (!objectUrl.startsWith('blob:')) {
    throw new Error('URL de fichier générée invalide.');
  }
  cropPlayer.src = objectUrl;

  cropPlayer.onloadedmetadata = () => {
    videoDur = cropPlayer.duration || 0;
    sliderStart.value = 0;
    sliderEnd.value   = SLIDER_RESOLUTION;
    startInput.value  = fmtTime(0);
    endInput.value    = fmtTime(videoDur);
    updateRangeUI();
    cropEditor.classList.remove('hidden');
    dropZone.classList.add('hidden');
  };
}

/* ---- Dual-handle range slider ---- */
function updateRangeUI() {
  const s = parseInt(sliderStart.value);
  const e = parseInt(sliderEnd.value);
  const pctS = (s / SLIDER_RESOLUTION) * 100;
  const pctE = (e / SLIDER_RESOLUTION) * 100;
  trackFill.style.left  = `${pctS}%`;
  trackFill.style.width = `${pctE - pctS}%`;

  const tS = (s / SLIDER_RESOLUTION) * videoDur;
  const tE = (e / SLIDER_RESOLUTION) * videoDur;
  rangeDisplay.textContent = `${fmtTime(tS)} → ${fmtTime(tE)}`;
  cropSelInfo.textContent  = `Sélection : ${fmtTime(tE - tS)}`;
}

sliderStart.addEventListener('input', () => {
  const startVal = parseInt(sliderStart.value);
  const endVal   = parseInt(sliderEnd.value);
  if (startVal >= endVal - 1) sliderStart.value = endVal - 1;
  const t = (parseInt(sliderStart.value) / SLIDER_RESOLUTION) * videoDur;
  startInput.value = fmtTime(t);
  cropPlayer.currentTime = t;
  updateRangeUI();
});

sliderEnd.addEventListener('input', () => {
  const startVal = parseInt(sliderStart.value);
  const endVal   = parseInt(sliderEnd.value);
  if (endVal <= startVal + 1) sliderEnd.value = startVal + 1;
  const t = (parseInt(sliderEnd.value) / SLIDER_RESOLUTION) * videoDur;
  endInput.value = fmtTime(t);
  cropPlayer.currentTime = t;
  updateRangeUI();
});

startInput.addEventListener('change', () => {
  const t = Math.max(0, Math.min(parseTime(startInput.value), videoDur - 1));
  startInput.value = fmtTime(t);
  sliderStart.value = Math.round((t / videoDur) * SLIDER_RESOLUTION);
  cropPlayer.currentTime = t;
  updateRangeUI();
});

endInput.addEventListener('change', () => {
  const t = Math.max(1, Math.min(parseTime(endInput.value), videoDur));
  endInput.value = fmtTime(t);
  sliderEnd.value = Math.round((t / videoDur) * SLIDER_RESOLUTION);
  cropPlayer.currentTime = t;
  updateRangeUI();
});

/* ---- FFmpeg helpers ---- */
function setCropProgress(pct, label) {
  cropBar.style.width = `${pct}%`;
  cropStatus.textContent = label;
  cropProgress.classList.remove('hidden');
}

function setCropMsg(msg, type) {
  cropMsg.textContent = msg;
  cropMsg.className   = `status-msg ${type}`;
}

async function ensureFFmpeg() {
  if (ffmpegInst) return;

  /* Progress occupies 20–90 % of the bar; loading takes 0–20 %, finalising 90–100 %. */
  const PROGRESS_START = 20;
  const PROGRESS_RANGE = 70;

  const { createFFmpeg } = FFmpeg;  /* from CDN UMD bundle */
  ffmpegInst = createFFmpeg({
    corePath:
      'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
    log: false,
    progress: ({ ratio }) => {
      if (ratio >= 0) setCropProgress(PROGRESS_START + Math.round(ratio * PROGRESS_RANGE), `Traitement : ${Math.round(ratio * 100)} %`);
    },
  });

  setCropProgress(5, 'Chargement de FFmpeg.wasm…');
  await ffmpegInst.load();
  setCropProgress(15, 'FFmpeg chargé.');
}

/* ---- Crop & download ---- */
cropBtn.addEventListener('click', async () => {
  if (!cropFile) {
    setCropMsg('Importez d\'abord un fichier vidéo.', 'error');
    return;
  }

  cropBtn.disabled = true;
  cropMsg.className = 'status-msg';
  setCropProgress(0, 'Initialisation…');

  try {
    await ensureFFmpeg();

    const startSec = parseTime(startInput.value);
    const endSec   = parseTime(endInput.value);

    if (endSec <= startSec) {
      throw new Error('Le temps de fin doit être supérieur au temps de début.');
    }

    const outputFmt  = cropFmt.value;
    const inputName  = `input_${Date.now()}.${getExtension(cropFile.name)}`;
    const outputName = `output_${Date.now()}.${outputFmt}`;

    setCropProgress(18, 'Lecture du fichier…');
    const fileBuffer = await cropFile.arrayBuffer();
    ffmpegInst.FS('writeFile', inputName, new Uint8Array(fileBuffer));

    setCropProgress(20, 'Découpe en cours…');

    /* Build FFmpeg args */
    const isAudioOnly = ['mp3', 'wav', 'ogg'].includes(outputFmt);
    const ffArgs = [
      '-ss', String(startSec),
      '-i', inputName,
      '-t',  String(endSec - startSec),
    ];

    if (isAudioOnly) {
      /* Audio extraction */
      if (outputFmt === 'mp3')      ffArgs.push('-codec:a', 'libmp3lame', '-q:a', '2');
      else if (outputFmt === 'ogg') ffArgs.push('-codec:a', 'libvorbis');
      else                          ffArgs.push('-codec:a', 'pcm_s16le');
      ffArgs.push('-vn');
    } else {
      /* Video copy (fast, no re-encode) */
      ffArgs.push('-c', 'copy');
      /* For MKV we may need to avoid mp4 muxer */
      if (outputFmt === 'mkv') ffArgs.push('-f', 'matroska');
    }

    ffArgs.push(outputName);

    await ffmpegInst.run(...ffArgs);

    setCropProgress(92, 'Lecture du résultat…');
    const outData = ffmpegInst.FS('readFile', outputName);
    const mimeType = getMimeType(outputFmt);
    const blob = new Blob([outData.buffer], { type: mimeType });
    const url  = URL.createObjectURL(blob);

    /* Trigger download */
    const baseName = cropFile.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href     = url;
    a.download = `${baseName}_cut_${fmtTime(startSec).replace(/:/g, '-')}-${fmtTime(endSec).replace(/:/g, '-')}.${outputFmt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    /* Cleanup FS */
    try { ffmpegInst.FS('unlink', inputName);  } catch (fsErr) { console.warn('[YouDow FS] unlink input:', fsErr); }
    try { ffmpegInst.FS('unlink', outputName); } catch (fsErr) { console.warn('[YouDow FS] unlink output:', fsErr); }

    setCropProgress(100, 'Terminé !');
    setTimeout(() => {
      cropProgress.classList.add('hidden');
      setCropMsg(`✓ Fichier découpé téléchargé (${fmtTime(endSec - startSec)})`, 'success');
    }, 1000);
  } catch (err) {
    cropProgress.classList.add('hidden');
    console.error('[YouDow Crop]', err);
    setCropMsg(`Erreur : ${err.message}`, 'error');
  } finally {
    cropBtn.disabled = false;
  }
});

/* ---- Utility ---- */
function getExtension(filename) {
  const m = filename.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : 'mp4';
}

function getMimeType(ext) {
  const map = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
  };
  return map[ext] || 'application/octet-stream';
}
