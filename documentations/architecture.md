# Architecture of BlackBird Media Center (sgixMediaCenter)

This document describes the technical architecture of the application located in `src/`, a fast, lightweight, and user-friendly media center (commercially known as **BlackBird Media Center**, **sgixMediaCenter**, or **Pitchu**).

---

## 🛠️ Technology Stack

The application is built on a monolithic Node.js runtime, utilizing Express.js and real-time WebSocket communication:

* **Backend**: Node.js & Express.js (HTTP server).
* **Frontend**: EJS (Embedded JavaScript) templates rendered server-side and styled with Bootstrap 5.
* **Transcoding & Media Processing**: FFmpeg & FFprobe (managed programmatically via `fluent-ffmpeg` using static binaries provided by `ffmpeg-static` and `@ffprobe-installer/ffprobe`).
* **Database**: Simple, file-based JSON storage (under `src/datacache/`).
* **Real-time Communication**: WebSocket protocol (`ws`) for remote control command routing and transcode status synchronization.
* **File Uploads**: Multer integrated with chunk-based file handling (`fs-extra`) to support stable upload of large media files.

---

## 📂 Project Structure & Component Roles

The main source code structure is organized as follows:

```
src/
├── datacache/                  # Local JSON databases
│   ├── config.json             # Global application settings (language, auth, extensions, etc.)
│   ├── cameras.json            # Configured RTSP security cameras
│   ├── favorites.json          # Starred items for quick access
│   ├── history.json            # Recently played media item details and seek progress
│   ├── hidden_files.json       # Relative paths of files hidden by password
│   └── password.json           # Encrypted credentials for the hidden area
├── public/                     # Static assets served directly
│   ├── css/                    # Stylesheets (includes Bootstrap 5)
│   ├── js/                     # Client scripts (player WebSocket, remote controller, uploader)
│   ├── images/                 # Interface vectors and images
│   └── shared/                 # Root folder for user-uploaded media files
├── views/                      # EJS views templates
│   ├── dashboard.ejs           # Main statistics and quick access portal
│   ├── explorer.ejs            # Web-based file explorer and uploader
│   ├── play.ejs                # HTML5 custom audio/video player view
│   ├── remote.ejs              # Mobile remote controller D-PAD and inputs
│   └── cameras.ejs             # RTSP cameras dashboard and adding panel
├── server.js                   # Main application server (endpoints, websockets, transcoding)
└── package.json                # Project dependencies
```

---

## ⚙️ Key Technical Subsystems

### 1. Dynamic Transcoding and Web Streaming (HLS & Direct)
To playback files unsupported by web browsers (such as `.mkv` or `.avi`), the application implements a dynamic FFmpeg pipeline:
* **HLS (HTTP Live Streaming)**: Generates `.m3u8` indexes and `.ts` video segments on the fly, saving them in a temporary location for live web playback.
* **Asynchronous MP4 Optimization**: Transcodes heavy files to MP4 (`H.264 / AAC`) permanently and streams conversion updates to the UI via WebSockets.
* **Subtitles track extraction**: Converts internal SRT/ASS subtitle tracks to web-friendly WebVTT format dynamically to load in the HTML5 player track.

### 2. RTSP Camera Streaming Proxy
Surveillance camera RTSP streams are proxied:
* The user inputs an RTSP url (e.g. `rtsp://...`).
* The Node server spawns a background FFmpeg process to decode the RTSP feed and outputs an HLS stream or static periodic snapshots directly into `views/cameras.ejs` without requiring the client browser to support RTSP natively.

### 3. File-Based JSON Storage (`src/datacache/`)
Instead of a database server, the application reads/writes JSON files at atomic speed using `fs-extra`:
* On server boot, `server.js` triggers migrations (`migrateToDatacache`) to move configuration files from the project root into the isolated `datacache/` directory.
* Simple read/write synchronization locks prevent data corruption.

### 4. WebSocket Remote Control `/remote`
The WebSocket integration acts as an instant broker:
* The playback screen (`/play`) connects to the socket using a pairing code.
* The remote controller phone (`/remote`) registers to control that pairing session.
* Commands (play, pause, volume, navigation, keyboard typing) are routed instantly with low latency.
