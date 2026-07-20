# Skill: Black Bird Media Center Features Overview

This skill describes the purpose and list of features of the Black Bird Media Center app. It is used by the AI Chatbot to explain what the application does, its architecture, and how users can interact with it.

---

## 🦅 What is Black Bird Media Center?

Black Bird Media Center is a light, resilient, and premium self-hosted media server and smart home controller. It follows the **Boring Technology** principle: utilizing simple, stable vanilla stacks (HTML, Javascript, CSS, and Express) to deliver instant render times, near-zero latency, and robust offline support.

---

## 🛠️ Core Features & Capabilities

### 1. 📂 File Explorer (Gerenciador de Arquivos)
* **Local Storage Scanning**: Instantly lists and navigates directories under the shared folder (`public/shared`).
* **Upload Subsystem**: Upload files (videos, photos, audios, PDFs) directly through the browser.
* **Directory Creation**: Organizes folders dynamically.
* **Global Search**: Instantly searches files and subfolders by keyword.
* **Hidden Area (Área Oculta)**: Password-protected directory (`/hidden-area`) to secure private media assets.

### 2. 📊 Dashboard & Monitoring
* **Disk Allocation Metrics**: Visualizes storage usage distribution across media types.
* **System Metrics**: Shows total local database size, total shared files, and network configuration.
* **Media Feed**: Quick access to recently uploaded items and recently played videos.

### 3. 🎬 Media Playback & Streaming
* **HLS Transcoding Pipeline**: Converts video formats on-the-fly to HTTP Live Streaming (HLS) for seamless browser playback.
* **Subtitle Engine**: Detects, extracts, and injects subtitle files (`.srt`, `.vtt`) into the player view.
* **Favorites Database**: Simple favorites bookmarking synced to local JSON caches (`favorites.json`).

### 4. 📹 Security Cameras (Câmeras)
* **RTSP Transcoding**: Transcodes live RTSP security camera feeds into browser-compatible HLS streams.
* **Status Monitoring**: Displays active transcode jobs and alerts.

### 5. 🏠 Home Control (Automação Residencial)
* **Device Discovery**: Automated local subnet scanning for Shelly, Roku, and Tasmota devices.
* **Interactive Control**: Toggle smart outlets, switch devices on/off, and control Roku TV menus directly from the dashboard.

### 6. 📱 Remote Control (Controle Remoto)
* **QR Code Pairing**: Scan QR codes on a mobile device to pair it as a virtual remote controller.
* **Bidirectional Input**: Send keyboard strokes, cursor arrows, play/pause, media triggers, and volume changes to the Media Center screen via WebSockets.

### 7. 🤖 AI Chat Assistant (Agente de IA)
* **Llama-3-8B Integration**: Conversational assistant powered by Hugging Face Serverless API.
* **Right-Sidebar Widget**: Toggled from any page via the submenu "Chat AI" button.
* **Configurable Persona**: Customize agent name, active model, RAG directory, temperature, and skills from the settings dashboard.
* **Conversation Memory**: Automatically preserves chat history (`datacache/chat_history.json`) across page reloads and boots, allowing natural multi-turn dialogue.
* **Proactive Warning Engine**: Automatically checks for overdue or approaching task deadlines on page load. If found, it automatically opens the sidebar to alert the user.
* **AI Task Operations**: Executable action parsing to create, move (conclude), or delete task cards directly through conversational commands (e.g. "já finalizei a tarefa task_1").
* **Central Notifications Board**: Stores and archives all generated AI chat proactive warnings in `datacache/notifications.json` with unread indicators and header alert badges.

### 8. 📋 Kanban Board & Tasks (Tarefas)
* **Agile Management Layout**: Trello-like Kanban board with 4 workflow columns: "To Do", "Doing", "Validation", and "Done".
* **Drag-and-Drop Subsystem**: Smooth card drag-and-drop support utilizing native browser HTML5 APIs.
* **Metadata & Grouping**: Add custom colors, categories, and dynamic labels (tags) to tasks.
* **Search & Filters**: Instantly filter cards on the board by keyword, category, or label.
* **Server-side Persistence**: Interactively stores and retrieves cards from `datacache/tasks.json`.

### 9. ⚙️ Settings & Security (Configurações)
* **Auth Toggle**: Turn on/off mandatory login password.
* **Allowed Extensions**: Manage allowed upload formats (e.g. `.mp4`, `.mp3`, `.png`).
* **Backup & Restore**: Export all server configs, favorites, and cameras database as a JSON file, or restore them.
* **Localization**: Full localization support for English (`en`), Portuguese (`pt`), and Spanish (`es`).
