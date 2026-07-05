# BlackBird Media Center (sgixMediaCenter / Pitchu)

The **BlackBird Media Center** is a modern, lightweight, fast, and highly customizable media server and player built on Node.js (Express) and WebSockets. It is designed to run seamlessly in containerized environments (Docker) to stream files, proxy security cameras, play slideshows, and allow real-time control from your smartphone.

---

## 📋 Table of Features

Here is the complete list of capabilities that the BlackBird Media Center offers:

1. **Interactive Media Playlists**: Manage lists of images and videos dynamically inside directory paths to play content sequentially.
2. **Starred Favorites System**: Mark any file or folder with a star to catalog them inside the dedicated `/favorites` view for instant access.
3. **Real-time Mobile Remote Control (WebSockets)**: Control the playback from your cell phone by scanning a QR Code. Features:
   * Dynamic D-PAD Navigation to browse pages.
   * Player Control buttons (Play, Pause, Forward, Rewind, Volume, Mute, Seek, and Fullscreen toggle).
   * Mobile Keyboard typing to write text or credentials directly on the TV/PC screen.
   * Remote File Uploading to send photos and videos straight from your smartphone to the media center.
   * Haptic/Tactile vibration feedback on button presses.
4. **Automated Image & Video Slideshows**: Run automated playbacks of all images and videos in a directory with:
   * Configurable play intervals (3s, 5s, 10s, 30s, etc.).
   * Autoplay, pause, and manual navigation (Next/Prev).
   * A visual progress bar at the top showing slide duration.
   * Direct Fullscreen support.
5. **Video Playback & Advanced Transcoding**: 
   * Dynamic on-the-fly HLS (HTTP Live Streaming) transcoding for incompatible containers like `.mkv` and `.avi`.
   * Permanent background MP4 conversion helper with an live visual progress bar.
   * Dynamic Subtitle Parser that extracts internal audio/subtitle files and outputs WebVTT format tracks on the fly.
   * Smart Playback History saving video progress so you can resume where you left off.
6. **RTSP IP Security Cameras Hub**:
   * Add and list multiple RTSP IP security camera feeds.
   * Live streaming proxy dashboard translating raw RTSP streams into web-friendly HLS chunks or periódical snapshots.
7. **Web-Based File Explorer & Manager**: 
   * Browse files and folder hierarchies inside your shared storage directory.
   * Create new folders, delete files, or clean directories directly from the web client.
8. **Large Files Chunked Uploader**: Robust upload pipeline splitting large video files into 5MB chunks to avoid web browser timeouts or connection drops.
9. **Private Locked/Hidden Area**: Password-protect specific folders and files. Hidden files are excluded from all lists until authenticated under `/hidden-area`.
10. **Multi-language System (i18n)**: Fully translated UI and controls between English, Portuguese, and Spanish.
11. **Premium Modern UI/UX**: Responsive Bootstrap 5 interface tailored for Smart TVs, desktops, and phones. Designed with glassmorphic cards, default dark mode, and neon purple/fuchsia visual highlights.

---

## 🐳 Running with Docker & Docker Compose

All runtime requirements (Node.js, FFmpeg, FFprobe, and system libraries) are fully packaged inside the container.

### 1. Prerequisites
Ensure you have **Docker** and **Docker Compose** installed on your host system.

### 2. Configuration (`docker-compose.yml`)
The root directory includes a `docker-compose.yml` file. You can adjust the following parameters:
* **Ports**: Mapped to `"5555:5555"`. Change it if port 5555 is already occupied on your system.
* **Volumes**: Mounts your media folder under `/usr/src/app` into the container. Put your media items in `src/public/shared/` to make them immediately accessible.
* **Network**: Deploys a bridge network (`hosting`) on subnet `172.16.155.0/24` for optimized WebSocket routing.

### 3. Startup Scripts
* **To Start the Server**:
  ```bash
  bash start.sh
  ```
  *(Or run: `docker-compose --project-name="blackbirdmc" up -d`)*

* **To Stop the Server**:
  ```bash
  bash stop.sh
  ```
  *(Or run: `docker-compose --project-name="blackbirdmc" down`)*

### 4. Accessing the UI
Open your browser and navigate to:
* **Local access**: `http://localhost:5555`
* **Network access**: `http://<YOUR_LOCAL_IP>:5555` *(Your local IP address is auto-detected on boot and printed to the terminal console)*

---

## 📂 Internal Project Documentation

Explore detailed engineering guidelines inside the `documentations/` directory:

* **[Architecture Guide](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/architecture.md)** (`documentations/architecture.md`) — Comprehensive technical analysis of Express configurations, JSON databases, and FFmpeg transcoding pipelines.
* **[Agentic Guidelines](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/agentic.md)** (`documentations/agentic.md`) — Explains how to coordinate AI Agents (John, Mary, Sally, Winston, Amelia) under the BMAD Method and trigger discussions via Party Mode.
* **[Developer Skills Index](file:///Users/jaccon/Documents/Lab/BlackBird%20MC/v2/app/documentations/skills.md)** (`documentations/skills.md`) — Step-by-step developer manual mapping routine features to cognitive BMAD skills.
