# PodLlama AI - VS Code Extension

Official native VS Code extension for the **PodLlama** GPU-accelerated local container environment.

---

## What's New in 0.2.0

- **Fixed**: Chat subcommands (`/explain`, `/refactor`, `/fix`, `/test`) now properly route to `@podllama` participant instead of just opening an empty chat panel.
- **Fixed**: HTTP request timeouts prevent indefinite hangs when backend is unresponsive (5s health, 30s completions).
- **Fixed**: JSON comment stripping no longer corrupts URL strings in `settings.json`.
- **Fixed**: Removed duplicate `activationEvents` entries in package manifest.
- **Enhanced**: Status bar polling reduced from 10s → 30s with exponential backoff when offline (30s → 60s → 120s).
- **Enhanced**: `systemPrompt` setting is now wired into the `@podllama` chat participant — customize the agent personality.
- **Enhanced**: `maxContextTokens` setting is now read from configuration.
- **Enhanced**: File context truncation increased from 6000 → 8000 chars to better utilize the 16K context window.
- **Enhanced**: Expanded unit test coverage with FIM post-processing tests.

---

## Features

- **Native Inline Code Autocomplete**: Real-time Fill-In-Middle (FIM) tab completions powered by `podllama-autocomplete` (`qwen2.5-coder-0.5b-instruct`).
- **Native Agent Chat Participant (`@podllama`)**: Deep multi-turn coding and reasoning in the VS Code Chat drawer with subcommands:
  - `@podllama /explain` - Deep dive into code architecture and logic.
  - `@podllama /refactor` - Clean code refactoring and typing improvements.
  - `@podllama /fix` - Read workspace lints/diagnostics and fix bugs.
  - `@podllama /test` - Generate unit test suites.
  - `@podllama /think` - Deep reasoning analysis via `podllama-thinking` (`DeepSeek-R1-Distill-Qwen`).
- **Language Model Agent Tools API**: Integrates custom tools (`podllama_get_workspace_diagnostics`, `podllama_read_active_editor`, `podllama_container_status`, `podllama_switch_model`) with VS Code Agent workflows.
- **Status Bar Control & Telemetry**: Dynamic live status bar monitoring container liveliness, current active model, and autocomplete state — with smart exponential backoff to reduce unnecessary network load.

---

## Quickstart

### 1. Ensure PodLlama Backend is Running

```bash
make service-up
```

Verify backend health at `http://localhost:4000/health/liveliness`.

### 2. Build & Install Extension

Build the extension package:

```bash
make extension-build
```

To install directly into VS Code:

```bash
cd vscode-extension
npx @vscode/vsce package
code --install-extension podllama-vscode-0.2.0.vsix
```

---

## Extension Configuration Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `podllama.apiBase` | `http://localhost:4000/v1` | Base URL of LiteLLM Proxy |
| `podllama.apiKey` | `sk-local` | Bearer Auth token |
| `podllama.chatModel` | `podllama-chat` | Default chat model |
| `podllama.thinkingModel` | `podllama-thinking` | Default deep reasoning model |
| `podllama.autocompleteModel` | `podllama-autocomplete` | Default FIM completion model |
| `podllama.enableAutocomplete` | `true` | Enable/disable inline autocomplete |
| `podllama.autocompleteDebounceMs` | `150` | Keystroke debounce delay (ms) |
| `podllama.autocompleteMaxTokens` | `128` | Max tokens for inline completions |
| `podllama.temperature` | `0.2` | Temperature for model generation |
| `podllama.maxContextTokens` | `16384` | Max context window token size |
| `podllama.systemPrompt` | *(see default below)* | Custom system prompt for `@podllama` chat |
| `podllama.autoSyncContinue` | `true` | Auto-register endpoints in `~/.continue/config.json` |

**Default system prompt**: `"You are PodLlama, an expert AI software engineering assistant running on local GPU hardware."`

---

## Commands

- `PodLlama: Open Settings` (`podllama.openSettings`)
- `PodLlama: Check Backend Health` (`podllama.checkHealth`)
- `PodLlama: Select Active Chat/Thinking Model` (`podllama.selectModel`)
- `PodLlama: Toggle Inline Code Autocomplete` (`podllama.toggleAutocomplete`)
- `PodLlama: Explain Selected Code` (`podllama.explainCode`)
- `PodLlama: Refactor Selected Code` (`podllama.refactorCode`)
- `PodLlama: Fix Errors in Current File` (`podllama.fixCode`)
- `PodLlama: Generate Unit Tests` (`podllama.generateTests`)
- `PodLlama: Register Custom LM Endpoints JSON in Settings` (`podllama.installCustomEndpoints`)

---

## VS Code Custom LM Endpoint Configuration

To configure PodLlama as a Custom LM Endpoint in VS Code:

```json
[
  {
    "name": "Podllama",
    "vendor": "customendpoint",
    "apiKey": "sk-local",
    "apiType": "chat-completions",
    "models": [
      {
        "id": "podllama-chat",
        "name": "PodLlama Chat (Qwen 2.5 Coder 7B)",
        "url": "http://localhost:4000/v1/chat/completions",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 16384,
        "maxOutputTokens": 4096
      },
      {
        "id": "podllama-thinking",
        "name": "PodLlama Thinking (DeepSeek-R1 Distill 7B/14B)",
        "url": "http://localhost:4000/v1/chat/completions",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 16384,
        "maxOutputTokens": 4096
      },
      {
        "id": "podllama-autocomplete",
        "name": "PodLlama Autocomplete (Qwen 2.5 Coder 0.5B)",
        "url": "http://localhost:4000/v1/completions",
        "toolCalling": false,
        "vision": false,
        "maxInputTokens": 4096,
        "maxOutputTokens": 512
      }
    ]
  }
]
```
