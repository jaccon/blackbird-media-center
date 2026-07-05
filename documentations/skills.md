# Skills for Development in BlackBird Media Center

**Skills** are modular packages containing markdown instructions, configurations, and scripts that enable developers (and AI agents) to perform specialized engineering tasks with high consistency.

---

## 🛠️ Mapping Tasks to BMAD Skills

Use the following guidelines when maintaining the BlackBird Media Center:

### 1. Working on routes, streaming endpoints, and API logic in `server.js`
* **Workflow**:
  1. Define changes in the technical specification using `bmad-spec`.
  2. Implement backend code using `bmad-quick-dev` or `bmad-dev-story`.
  3. Validate concurrency, process limits, and file exists conditions by running `bmad-code-review`.

### 2. Styling views or designing layouts
* **Workflow**:
  1. Plan the mobile responsiveness and media player controls using `bmad-ux`.
  2. Apply changes to EJS templates and stylesheets using `bmad-quick-dev`.
  3. Manually test pages locally to verify glassmorphic panel renders and CSS animations.

### 3. Writing and optimizing FFmpeg commands
* **Workflow**:
  1. Investigate the current execution path and process tracking using `bmad-investigate` on `src/server.js`.
  2. Discuss pipeline options (CPU thread limiting, preset adjustments) with Winston using `bmad-party-mode`.
  3. Implement the optimized command and clean-up actions using `bmad-dev-story`.

### 4. Implementing automated tests for player or file operations
* **Workflow**:
  1. Trigger `bmad-qa-generate-e2e-tests` to create test routines.
  2. Implement tests for core components: chunk uploads, favorites database, and subtitles extraction.

---

## ⚙️ AI Development Guidelines for BlackBird Media Center

All AI agents writing code for this project must strictly comply with these core rules:

* **State Isolation**: Never store application state or configuration parameters outside of `src/datacache/`.
* **FFmpeg Process Lifecycle**: Every spawned FFmpeg instance must handle `error` and `end` events to prevent orphaned background processes. Clean-up scripts must call `.kill()` if the client socket disconnects.
* **WebSocket Management**: Clean up resources (close file streams, kill active HLS conversion processes) when the client socket disconnects.
* **i18n System**: Do not hardcode UI text. All strings must be declared inside the `translations` object in `server.js` and referenced using `t('key')` inside the EJS views.
