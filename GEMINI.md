# Gemini Project Context: Vectors Enhanced (SillyTavern Extension)

## Project Overview
**Vectors Enhanced** is a comprehensive extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that adds advanced vectorization capabilities. It enables semantic search, intelligent memory management (summarization), and external task linking (cross-chat memory).

This is a **client-side JavaScript** project designed to run directly within the browser environment of SillyTavern. It does not use a standard build pipeline (like Webpack/Vite) but relies on native ES Modules and SillyTavern's extension loader.

## Architecture
The project follows a **Layered Architecture** to manage complexity:

-   **Root (`/`)**: Contains the entry point `index.js`, `manifest.json`, and basic UI assets (`style.css`, HTML templates).
-   **Core (`src/core/`)**: Domain logic and business rules.
    -   `entities/`: Data models (Content, Vector, Task).
    -   `extractors/`: Logic to pull data from Chats, Files, and World Info.
    -   `pipeline/`: Processing pipeline (Extract -> Process -> Dispatch -> Execute).
-   **Infrastructure (`src/infrastructure/`)**: Low-level services.
    -   `ConfigManager.js`: Manages extension settings.
    -   `storage/`: Interaction with Vector Databases (IndexedDB/InMemory).
    -   `api/`: Adapters for Vectorization APIs (OpenAI, Ollama, etc.).
-   **UI (`src/ui/`)**: User Interface components.
    -   Components are split into separate files (e.g., `SettingsPanel.js`, `TaskList.js`).
    -   Uses **jQuery** (via SillyTavern global) and direct DOM manipulation.
-   **Services (`src/services/`)**: Standalone services like Rerank logic.

## Key Files
*   **`index.js`**: The massive main entry point. It orchestrates the initialization, registers slash commands, binds global event listeners, and acts as the glue between SillyTavern's API and the extension's modular code. **Note:** This file is currently very large (4000+ lines) and contains significant business logic that is slowly being refactored into `src/`.
*   **`manifest.json`**: Defines extension metadata (name, version, loading order) for SillyTavern.
*   **`src/infrastructure/ConfigManager.js`**: Handles reading/writing settings to `extension_settings.vectors_enhanced`.
*   **`webllm.js`**: Likely handles WebGPU-accelerated local inference if enabled.

## Development Conventions
*   **Environment**: Runs inside the browser. No Node.js runtime APIs (fs, child_process) are available directly, though SillyTavern provides some wrappers.
*   **Module System**: Native ES Modules (`import`/`export`).
*   **Dependencies**: Relies on globals provided by SillyTavern (e.g., `jQuery`, `toastr`, `extension_settings`, `getContext`).
*   **Styling**: Plain CSS in `style.css` and sub-files in `src/ui/styles/`.
*   **Refactoring Goal**: The project is in the process of moving logic from `index.js` to the `src/` directory. New features should be implemented in `src/` whenever possible.

## Installation & Testing
1.  **Install**: Copy the entire project folder to `SillyTavern/public/scripts/extensions/third-party/vectors-enhanced/`.
2.  **Enable**: Refresh SillyTavern, go to Extensions, and enable "Vectors Enhanced".
3.  **Debug**: Use the browser's Developer Tools (F12) Console. The extension logs with prefixes like `[Vectors]` or `Pipeline:`.

## Common Tasks
*   **Vectorization**: The core feature. Controlled by `performVectorization` in `index.js` (being moved to `src/core/pipeline`).
*   **Storage**: Vector data is stored using an adapter pattern (likely client-side IndexedDB or similar).
*   **Settings**: All settings are stored in the global `extension_settings.vectors_enhanced` object.
