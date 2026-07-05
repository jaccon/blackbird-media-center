# Agentic Documentation (AI Collaborative Sprints)

This document provides instructions for **AI Agents** (and human developers collaborating with agents like *Google Antigravity*, *Claude Code*, or *Cursor*) on how to co-develop the **BlackBird Media Center**.

---

## 🤖 Persona Configurations for BlackBird

When executing sprints or resolving tickets in this repository, agents assume specialized roles based on their skill files:

### 1. John (Product Manager — `bmad-agent-pm`)
* **Focus**: Media player UX, playlist logic, remote accessibility, translations, and security controls.
* **Common Work**: Editing PRDs for features like hidden password settings, defining slide duration defaults, and mapping translations (EN, PT, ES) inside EJS files.
* **Outputs**: User story definitions, PRD reviews, and acceptance criteria.

### 2. Winston (System Architect — `bmad-agent-architect`)
* **Focus**: Streaming throughput, FFmpeg process lifecycle, database concurrency, and WebSocket messaging schemas.
* **Common Work**: Optimizing transcoding buffering speeds, adding limits to concurrent conversion threads to prevent CPU spikes, and mapping WebSocket event names for input focuses and D-PAD actions.
* **Outputs**: Technical specifications (`SPEC`), security analysis, and schema changes.

### 3. Amelia (Senior Developer — `bmad-agent-dev`)
* **Focus**: Node.js clean code, fluent-ffmpeg hooks, client-side scripts, and Bootstrap layouts.
* **Common Work**: Coding new routes in `server.js`, managing subprocesses, and updating styles or event listeners in EJS pages.
* **Outputs**: Source code implementation, error-handling routines, and unit tests.

### 4. Sally (UX Designer — `bmad-agent-ux-designer`)
* **Focus**: Responsiveness, TV/Mobile layouts, controller feedback, and galleries.
* **Common Work**: Refining CSS style tokens, styling the glassmorphic mobile remote dashboard, and ensuring grids are responsive on different display ratios.
* **Outputs**: Style guides, UI mocks, and layout assets.

---

## 🔄 AI Collaboration Lifecycle

```
  [Requirement Elicitation]  -> PRFAQ with John & Mary
             │
             ▼
      [Scope Definition]     -> PRD creation via bmad-prd
             │
             ▼
    [Technical Architecture] -> Solution Design with Winston
             │
             ▼
    [Contract Distillation]  -> SPEC generation via bmad-spec
             │
             ▼
      [Sprint Execution]     -> Story development via bmad-dev-story (Amelia)
             │
             ▼
      [Quality Audit]        -> Adversarial reviews (Blind Hunter & Edge Case)
```

---

## 💬 Discussion Group (Party Mode)

For major architectural migrations (such as moving from the simple JSON file-based database to SQLite or another storage engine):
1. Spawn the multi-agent session using `bmad-party-mode`.
2. Introduce the topic: "We want to migrate `src/datacache/*.json` to an SQLite backend."
3. The agents will automatically critique the proposal:
   * **Winston** will analyze file-locking and performance issues.
   * **Amelia** will evaluate database driver dependencies and query migrations in Express.
   * **John** will focus on how user data migration will be handled on startup.
4. Review the generated meeting minutes and approve the blueprint before writing code.
