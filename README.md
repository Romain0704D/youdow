# YouDow – Téléchargeur YouTube

Application web statique hébergée sur **GitHub Pages** qui permet de :

- **Télécharger** des vidéos YouTube en **MP4** (1080p / 720p / 480p / 360p), **WebM**, **MP3**, **OGG**, **Opus**, **WAV**.
- **Découper** (« cropper ») un passage précis de la vidéo YouTube que l'on souhaite télécharger — la vidéo est d'abord récupérée puis découpée directement dans le navigateur grâce à **FFmpeg.wasm**, sans aucun envoi de données vers un serveur.

## Fonctionnalités

| Fonctionnalité | Détails |
|---|---|
| Multi-format | MP4, WebM, MP3, OGG, Opus, WAV |
| Différentes qualités | 1080p, 720p, 480p, 360p |
| Découpe intégrée | Toggle « Découper un passage » avec slider double-poignée + champs de temps, directement sur la vidéo YouTube |
| Prévisualisation | Embed YouTube intégré dans la carte vidéo |
| Traitement local | FFmpeg.wasm single-threaded — aucune donnée envoyée |
| Interface sombre | Design responsive, thème sombre avec accent rouge |

## Architecture

```
index.html       ← page unique (URL → carte vidéo → format + trim → télécharger)
css/style.css    ← styles
js/app.js        ← logique de l'application
```

### Dépendances CDN (aucune installation)

- [Font Awesome 6](https://fontawesome.com/) – icônes
- [Google Fonts – Inter](https://fonts.google.com/specimen/Inter) – typographie
- [@ffmpeg/ffmpeg 0.11.6](https://github.com/ffmpegwasm/ffmpeg.wasm) + core single-threaded – découpe vidéo
- [Cobalt API](https://cobalt.tools/) – backend de téléchargement YouTube

## Déploiement sur GitHub Pages

1. Activer GitHub Pages sur la branche `main` (racine `/`).
2. L'application est accessible à `https://<utilisateur>.github.io/youdow/`.

## Usage

1. Collez l'URL d'une vidéo YouTube.
2. Cliquez sur **Analyser** — la miniature et le titre s'affichent.
3. Choisissez le format souhaité dans la grille (MP4, WebM, MP3…).
4. *(Optionnel)* Activez le toggle **Découper un passage** pour sélectionner un début et une fin avec le slider ou les champs texte.
5. Cliquez sur **Télécharger** (ou **Découper & Télécharger** si la découpe est activée).
   - Sans découpe : téléchargement direct via Cobalt.
   - Avec découpe : la vidéo est d'abord téléchargée, puis découpée dans votre navigateur via FFmpeg.wasm, puis le fichier découpé est proposé au téléchargement.

## Licence

Usage personnel uniquement. Respectez les droits d'auteur des contenus téléchargés.
