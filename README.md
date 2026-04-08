# YouDow – Téléchargeur YouTube

Application web statique hébergée sur **GitHub Pages** qui permet de :

- **Télécharger** des vidéos YouTube en **MP4** (1080p / 720p / 480p / 360p), **WebM**, **MP3**, **OGG**, **Opus**, **WAV**.
- **Découper** (« cropper ») n'importe quel fichier vidéo ou audio localement dans le navigateur grâce à **FFmpeg.wasm** — sans aucun envoi de données vers un serveur.

## Fonctionnalités

| Fonctionnalité | Détails |
|---|---|
| Multi-format | MP4, WebM, MP3, OGG, Opus, WAV |
| Différentes qualités | 1080p, 720p, 480p, 360p |
| Découpe précise | Slider double-poignée + champs de saisie de temps |
| Prévisualisation | Lecteur HTML5 intégré (onglet Découpe) / embed YouTube (onglet Téléchargement) |
| Traitement local | FFmpeg.wasm single-threaded — aucune donnée envoyée |
| Interface sombre | Design responsive, thème sombre avec accent rouge |

## Architecture

```
index.html       ← page principale (2 onglets)
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

### Onglet « Télécharger »
1. Collez l'URL d'une vidéo YouTube.
2. Cliquez sur **Analyser** — la miniature et le titre s'affichent.
3. Choisissez le format souhaité dans la grille.
4. Cliquez sur **Télécharger**.

### Onglet « Découper »
1. Glissez-déposez un fichier vidéo/audio (ou cliquez sur *Parcourir*).
2. Utilisez le slider double-poignée ou les champs texte pour définir les temps de début et de fin.
3. Choisissez le format de sortie.
4. Cliquez sur **Découper & Télécharger** — FFmpeg traite le fichier dans votre navigateur.

## Licence

Usage personnel uniquement. Respectez les droits d'auteur des contenus téléchargés.
