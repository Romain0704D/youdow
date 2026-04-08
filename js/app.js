/**
 * YouDow – app.js
 *
 * Single-page flow:
 *   YouTube URL → oEmbed metadata → format picker → optional trim range →
 *   Cobalt API download → (if trim enabled) FFmpeg.wasm trim in-browser → save
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

function escapeForFilename(str) {
  return str.replace(/[^a-zA-Z0-9_\-. ]/g, '_').substring(0, 80);
}

/* =========================================================
   YouTube IFrame API – real video duration
   ========================================================= */

let _ytApiReady = false;
const _ytApiPromise = new Promise((resolve) => {
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    _ytApiReady = true;
    if (prev) prev();
    resolve();
  };
});

(function loadYTApi() {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

/**
 * Use a hidden YouTube player to retrieve the video's real duration.
 * Falls back to DEFAULT_DURATION on error or timeout.
 */
async function getVideoDuration(videoId) {
  try {
    await Promise.race([
      _ytApiPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('YT API timeout')), 8000)),
    ]);
  } catch {
    return DEFAULT_DURATION;
  }

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden';
    document.body.appendChild(el);

    let done = false;
    const finish = (dur) => {
      if (done) return;
      done = true;
      clearTimeout(tmr);
      try { player.destroy(); } catch (_) { /* ignore */ }
      el.remove();
      resolve(dur);
    };

    const tmr = setTimeout(() => finish(DEFAULT_DURATION), 10000);

    const player = new YT.Player(el, {
      videoId,
      width: 1,
      height: 1,
      playerVars: { autoplay: 0, controls: 0 },
      events: {
        onReady(ev) {
          /* getDuration() may return 0 until metadata loads; poll briefly */
          let attempts = 0;
          const poll = () => {
            const d = ev.target.getDuration();
            if (d > 0) return finish(d);
            if (++attempts > 25) return finish(DEFAULT_DURATION);
            setTimeout(poll, 200);
          };
          poll();
        },
        onError() {
          finish(DEFAULT_DURATION);
        },
      },
    });
  });
}

/* =========================================================
   Cobalt Authentication (Turnstile + JWT)
   ========================================================= */

const _cobaltAuth = {
  sitekey: null,
  jwt: null,
  expiry: 0,
  widgetId: null,
  _resolve: null,
};

/** Fetch Cobalt instance info and set up Turnstile if required. */
async function initCobaltAuth() {
  try {
    const r = await fetch(COBALT_API, { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const d = await r.json();
    const sk = d.cobalt && d.cobalt.turnstileSitekey;
    if (!sk) return;

    _cobaltAuth.sitekey = sk;

    /* Load Turnstile script dynamically */
    await new Promise((res, rej) => {
      window.__onTurnstileReady = res;
      const s = document.createElement('script');
      s.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileReady&render=explicit';
      s.async = true;
      s.onerror = rej;
      document.head.appendChild(s);
    });

    _renderTurnstile();
  } catch (e) {
    console.warn('[YouDow] Cobalt auth init:', e);
  }
}

function _renderTurnstile() {
  const el = document.getElementById('turnstile-container');
  if (!el || typeof turnstile === 'undefined') return;

  _cobaltAuth.widgetId = turnstile.render(el, {
    sitekey: _cobaltAuth.sitekey,
    theme: 'dark',
    size: 'invisible',
    callback: _onTurnstileDone,
    'error-callback': () => {
      console.warn('[YouDow] Turnstile challenge error');
    },
    'expired-callback': () => {
      _cobaltAuth.jwt = null;
      _cobaltAuth.expiry = 0;
    },
  });
}

async function _onTurnstileDone(token) {
  try {
    const r = await fetch(COBALT_API + 'session', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'cf-turnstile-response': token,
      },
    });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (d.token) {
      _cobaltAuth.jwt = d.token;
      /* exp is lifetime in seconds; subtract 30 s buffer */
      _cobaltAuth.expiry = Date.now() + ((d.exp || 1800) * 1000) - 30000;
    }
  } catch (e) {
    console.warn('[YouDow] JWT exchange failed:', e);
  }

  /* Unblock any caller waiting on ensureCobaltJwt() */
  if (_cobaltAuth._resolve) {
    _cobaltAuth._resolve();
    _cobaltAuth._resolve = null;
  }
}

/**
 * Return a valid JWT for Cobalt, refreshing via Turnstile if needed.
 * Returns null if the instance does not require authentication.
 */
async function ensureCobaltJwt() {
  if (!_cobaltAuth.sitekey) return null;
  if (_cobaltAuth.jwt && Date.now() < _cobaltAuth.expiry) return _cobaltAuth.jwt;

  /* Refresh: reset Turnstile to trigger a new challenge */
  _cobaltAuth.jwt = null;
  if (_cobaltAuth.widgetId != null && typeof turnstile !== 'undefined') {
    turnstile.reset(_cobaltAuth.widgetId);
  }

  return new Promise((resolve, reject) => {
    if (_cobaltAuth.jwt && Date.now() < _cobaltAuth.expiry) {
      return resolve(_cobaltAuth.jwt);
    }

    const tmr = setTimeout(() => {
      _cobaltAuth._resolve = null;
      reject(new Error(
        'Authentification impossible (délai dépassé). Veuillez actualiser la page et réessayer.'
      ));
    }, 30000);

    _cobaltAuth._resolve = () => {
      clearTimeout(tmr);
      if (_cobaltAuth.jwt) {
        resolve(_cobaltAuth.jwt);
      } else {
        reject(new Error('Authentification échouée. Veuillez réessayer.'));
      }
    };
  });
}

/* =========================================================
   DOWNLOAD + TRIM (single page)
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

/* Trim controls */
const trimToggle   = document.getElementById('trimToggle');
const trimControls = document.getElementById('trimControls');
const sliderStart  = document.getElementById('sliderStart');
const sliderEnd    = document.getElementById('sliderEnd');
const trackFill    = document.getElementById('trackFill');
const rangeDisplay = document.getElementById('rangeDisplay');
const startInput   = document.getElementById('startInput');
const endInput     = document.getElementById('endInput');
const cropSelInfo  = document.getElementById('cropSelInfo');

/* 1000 steps gives sub-second precision for videos up to ~16 minutes without
   being a performance burden for the DOM slider repaint on every mouse move. */
const SLIDER_RESOLUTION = 1000;

/* Default video duration (updated when user enters a known duration or from oEmbed).
   YouTube oEmbed does not provide duration, so we default to 10 min as a reasonable
   slider range; users refine via the text inputs if needed. */
const DEFAULT_DURATION = 600;
let videoDur = DEFAULT_DURATION;
let ffmpegInst = null;

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

/* ----- Trim toggle ----- */
trimToggle.addEventListener('change', () => {
  if (trimToggle.checked) {
    trimControls.classList.remove('hidden');
    downloadBtn.querySelector('span').textContent = 'Découper & Télécharger';
    downloadBtn.querySelector('i').className = 'fas fa-cut';
  } else {
    trimControls.classList.add('hidden');
    downloadBtn.querySelector('span').textContent = 'Télécharger';
    downloadBtn.querySelector('i').className = 'fas fa-download';
  }
});

/* ----- Dual-handle range slider ----- */
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
  updateRangeUI();
});

sliderEnd.addEventListener('input', () => {
  const startVal = parseInt(sliderStart.value);
  const endVal   = parseInt(sliderEnd.value);
  if (endVal <= startVal + 1) sliderEnd.value = startVal + 1;
  const t = (parseInt(sliderEnd.value) / SLIDER_RESOLUTION) * videoDur;
  endInput.value = fmtTime(t);
  updateRangeUI();
});

startInput.addEventListener('change', () => {
  const t = Math.max(0, Math.min(parseTime(startInput.value), videoDur - 1));
  startInput.value = fmtTime(t);
  sliderStart.value = Math.round((t / videoDur) * SLIDER_RESOLUTION);
  updateRangeUI();
});

endInput.addEventListener('change', () => {
  const t = Math.max(1, Math.min(parseTime(endInput.value), videoDur));
  endInput.value = fmtTime(t);
  sliderEnd.value = Math.round((t / videoDur) * SLIDER_RESOLUTION);
  updateRangeUI();
});

/** Reset the trim UI to a given duration. */
function resetTrimUI(dur) {
  videoDur = dur;
  sliderStart.value = 0;
  sliderEnd.value   = SLIDER_RESOLUTION;
  startInput.value  = fmtTime(0);
  endInput.value    = fmtTime(dur);
  updateRangeUI();
}

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

    /* Reset trim UI with default duration, then fetch real duration */
    resetTrimUI(DEFAULT_DURATION);

    videoCard.classList.remove('hidden');
    videoCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    /* Fetch real video duration in the background via YT IFrame API */
    getVideoDuration(vid).then((dur) => {
      if (dur > 0 && dur !== DEFAULT_DURATION) {
        resetTrimUI(dur);
      }
    });
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

/* ----- FFmpeg helpers ----- */
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
      if (ratio >= 0) setDlProgress(PROGRESS_START + Math.round(ratio * PROGRESS_RANGE), `Découpe : ${Math.round(ratio * 100)} %`);
    },
  });

  setDlProgress(5, 'Chargement de FFmpeg.wasm…');
  await ffmpegInst.load();
  setDlProgress(15, 'FFmpeg chargé.');
}

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

/* ----- Download (+ optional trim) via Cobalt API ----- */
downloadBtn.addEventListener('click', async () => {
  if (!state.videoId) {
    setDlMsg('Analysez d\'abord une vidéo.', 'error');
    return;
  }

  const isTrimming = trimToggle.checked;
  const startSec = isTrimming ? parseTime(startInput.value) : 0;
  const endSec   = isTrimming ? parseTime(endInput.value) : 0;

  if (isTrimming && endSec <= startSec) {
    setDlMsg('Le temps de fin doit être supérieur au temps de début.', 'error');
    return;
  }

  downloadBtn.disabled = true;
  dlMsg.className = 'status-msg';
  setDlProgress(5, 'Connexion au serveur…');

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

    /* Build headers – include JWT auth if Cobalt requires it */
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    try {
      const jwt = await ensureCobaltJwt();
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    } catch (authErr) {
      throw new Error(authErr.message);
    }

    const res = await fetch(COBALT_API, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    /* Parse response – Cobalt returns JSON for both success and error */
    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.status === 'error') {
      const code = (data && data.error && data.error.code) || '';
      if (code.includes('auth')) {
        /* Auth error → invalidate cached JWT so next attempt refreshes */
        _cobaltAuth.jwt = null;
        _cobaltAuth.expiry = 0;
        throw new Error('Session expirée. Veuillez réessayer.');
      }
      throw new Error(
        code || 'Le serveur de téléchargement a renvoyé une erreur.'
      );
    }

    const downloadUrl = data.url;
    if (!downloadUrl) {
      throw new Error('Aucune URL de téléchargement reçue.');
    }

    /* ---- If NOT trimming → direct browser download ---- */
    if (!isTrimming) {
      setDlProgress(90, 'Ouverture du téléchargement…');

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = data.filename || `${escapeForFilename(state.videoTitle || 'video')}.${state.ext}`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setDlProgress(100, 'Téléchargement démarré !');
      setTimeout(() => {
        dlProgress.classList.add('hidden');
        setDlMsg('✓ Téléchargement lancé avec succès !', 'success');
      }, 1200);
      return;
    }

    /* ---- TRIMMING: download blob → FFmpeg.wasm → trimmed file ---- */
    setDlProgress(10, 'Téléchargement de la vidéo…');

    const videoRes = await fetch(downloadUrl);
    if (!videoRes.ok) throw new Error('Impossible de récupérer le fichier vidéo pour le découpage.');

    const videoBlob = await videoRes.blob();
    const videoBuffer = await videoBlob.arrayBuffer();

    setDlProgress(15, 'Vidéo récupérée. Chargement de FFmpeg…');
    await ensureFFmpeg();

    const inputExt  = state.ext;
    const outputExt = state.ext;
    const inputName  = `input_${Date.now()}.${inputExt}`;
    const outputName = `output_${Date.now()}.${outputExt}`;

    ffmpegInst.FS('writeFile', inputName, new Uint8Array(videoBuffer));

    setDlProgress(20, 'Découpe en cours…');

    const isAudioOnly = ['mp3', 'ogg', 'opus', 'wav'].includes(outputExt);
    const ffArgs = [
      '-ss', String(startSec),
      '-i', inputName,
      '-t',  String(endSec - startSec),
    ];

    if (isAudioOnly) {
      if (outputExt === 'mp3')      ffArgs.push('-codec:a', 'libmp3lame', '-q:a', '2');
      else if (outputExt === 'ogg') ffArgs.push('-codec:a', 'libvorbis');
      else if (outputExt === 'wav') ffArgs.push('-codec:a', 'pcm_s16le');
      ffArgs.push('-vn');
    } else {
      ffArgs.push('-c', 'copy');
      if (outputExt === 'mkv') ffArgs.push('-f', 'matroska');
    }

    ffArgs.push(outputName);

    await ffmpegInst.run(...ffArgs);

    setDlProgress(92, 'Lecture du résultat…');
    const outData = ffmpegInst.FS('readFile', outputName);
    const mimeType = getMimeType(outputExt);
    const blob = new Blob([outData.buffer], { type: mimeType });
    const url  = URL.createObjectURL(blob);

    /* Trigger download */
    const safeName = escapeForFilename(state.videoTitle || 'video');
    const a = document.createElement('a');
    a.href     = url;
    a.download = `${safeName}_${fmtTime(startSec).replace(/:/g, '-')}-${fmtTime(endSec).replace(/:/g, '-')}.${outputExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    /* Cleanup FS */
    try { ffmpegInst.FS('unlink', inputName);  } catch (fsErr) { console.warn('[YouDow FS] unlink input:', fsErr); }
    try { ffmpegInst.FS('unlink', outputName); } catch (fsErr) { console.warn('[YouDow FS] unlink output:', fsErr); }

    setDlProgress(100, 'Terminé !');
    setTimeout(() => {
      dlProgress.classList.add('hidden');
      setDlMsg(`✓ Passage découpé téléchargé (${fmtTime(endSec - startSec)})`, 'success');
    }, 1000);
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
   Bootstrap: start Cobalt auth in the background
   ========================================================= */
initCobaltAuth();
