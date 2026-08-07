# PodLlama AI - VS Code Extension

Official native VS Code extension for the **PodLlama** GPU-accelerated local container environment.

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
- **Status Bar Control & Telemetry**: Dynamic live status bar monitoring container liveliness, current active model, and autocomplete state.

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
code --install-extension podllama-vscode-0.1.0.vsix
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

