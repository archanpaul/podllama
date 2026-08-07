"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));

// src/api/podllamaClient.ts
var http = __toESM(require("http"));
var https = __toESM(require("https"));
var import_url = require("url");
var PodLlamaClient = class {
  constructor(config) {
    this.config = config;
  }
  config;
  updateConfig(config) {
    this.config = config;
  }
  get currentConfig() {
    return this.config;
  }
  async checkHealth() {
    try {
      const liveUrl = this.config.apiBase.replace(/\/v1\/?$/, "/health/liveliness");
      const res = await this.httpRequest("GET", liveUrl);
      if (res.statusCode === 200) {
        return true;
      }
    } catch {
    }
    try {
      const modelsUrl = `${this.config.apiBase.replace(/\/$/, "")}/models`;
      const res = await this.httpRequest("GET", modelsUrl, void 0, {
        Authorization: `Bearer ${this.config.apiKey}`
      });
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }
  async listModels() {
    const modelsUrl = `${this.config.apiBase.replace(/\/$/, "")}/models`;
    const res = await this.httpRequest("GET", modelsUrl, void 0, {
      Authorization: `Bearer ${this.config.apiKey}`
    });
    if (res.statusCode !== 200) {
      throw new Error(`Failed to list models: HTTP ${res.statusCode} ${res.body}`);
    }
    const json = JSON.parse(res.body);
    if (Array.isArray(json.data)) {
      return json.data.map((m) => m.id);
    }
    return [];
  }
  async completeText(req) {
    const url = `${this.config.apiBase.replace(/\/$/, "")}/completions`;
    const body = JSON.stringify({
      model: req.model || this.config.autocompleteModel,
      prompt: req.prompt,
      max_tokens: req.max_tokens ?? this.config.autocompleteMaxTokens,
      temperature: req.temperature ?? this.config.temperature,
      stop: req.stop ?? ["\n\n", "<|endoftext|>", "<|file_separator|>"]
    });
    const res = await this.httpRequest("POST", url, body, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`
    });
    if (res.statusCode !== 200) {
      throw new Error(`Completion error HTTP ${res.statusCode}: ${res.body}`);
    }
    const json = JSON.parse(res.body);
    if (json.choices && json.choices.length > 0) {
      return json.choices[0].text || "";
    }
    return "";
  }
  async chatCompletion(req) {
    const url = `${this.config.apiBase.replace(/\/$/, "")}/chat/completions`;
    const body = JSON.stringify({
      model: req.model || this.config.chatModel,
      messages: req.messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.max_tokens,
      stream: false
    });
    const res = await this.httpRequest("POST", url, body, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`
    });
    if (res.statusCode !== 200) {
      throw new Error(`Chat error HTTP ${res.statusCode}: ${res.body}`);
    }
    const json = JSON.parse(res.body);
    if (json.choices && json.choices.length > 0) {
      return json.choices[0].message?.content || "";
    }
    return "";
  }
  async streamChatCompletion(req, onChunk, signal) {
    const url = `${this.config.apiBase.replace(/\/$/, "")}/chat/completions`;
    const parsedUrl = new import_url.URL(url);
    const body = JSON.stringify({
      model: req.model || this.config.chatModel,
      messages: req.messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.max_tokens,
      stream: true
    });
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Length": Buffer.byteLength(body)
        }
      };
      const reqClient = transport.request(requestOptions, (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (d) => errBody += d.toString());
          res.on(
            "end",
            () => reject(new Error(`Stream error HTTP ${res.statusCode}: ${errBody}`))
          );
          return;
        }
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta?.content;
                if (delta) {
                  onChunk(delta);
                }
              } catch {
              }
            }
          }
        });
        res.on("end", () => {
          if (buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
            try {
              const data = JSON.parse(buffer.trim().slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                onChunk(delta);
              }
            } catch {
            }
          }
          resolve();
        });
        res.on("error", (err) => reject(err));
      });
      if (signal) {
        signal.addEventListener("abort", () => {
          reqClient.destroy();
          resolve();
        });
      }
      reqClient.on("error", (err) => reject(err));
      reqClient.write(body);
      reqClient.end();
    });
  }
  httpRequest(method, targetUrl, postData, headers) {
    const parsedUrl = new import_url.URL(targetUrl);
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;
    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: headers || {}
      };
      if (postData && headers && !headers["Content-Length"]) {
        options.headers["Content-Length"] = Buffer.byteLength(postData);
      }
      const req = transport.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk.toString());
        res.on("end", () => resolve({ statusCode: res.statusCode || 500, body }));
      });
      req.on("error", (err) => reject(err));
      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
};

// src/completion/inlineCompletionProvider.ts
var vscode = __toESM(require("vscode"));
var PodLlamaInlineCompletionProvider = class {
  constructor(client) {
    this.client = client;
  }
  client;
  debounceTimer;
  async provideInlineCompletionItems(document, position, context, token) {
    const config = vscode.workspace.getConfiguration("podllama");
    const enabled = config.get("enableAutocomplete", true);
    if (!enabled) {
      return void 0;
    }
    const debounceMs = config.get("autocompleteDebounceMs", 150);
    if (debounceMs > 0) {
      await new Promise((resolve) => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => resolve(), debounceMs);
      });
    }
    if (token.isCancellationRequested) {
      return void 0;
    }
    const fullText = document.getText();
    const offset = document.offsetAt(position);
    const maxPrefixLen = 2048;
    const maxSuffixLen = 1024;
    const rawPrefix = fullText.substring(Math.max(0, offset - maxPrefixLen), offset);
    const rawSuffix = fullText.substring(offset, Math.min(fullText.length, offset + maxSuffixLen));
    const fimPrompt = `<|fim_prefix|>${rawPrefix}<|fim_suffix|>${rawSuffix}<|fim_middle|>`;
    try {
      const autocompleteModel = config.get("autocompleteModel", "podllama-autocomplete");
      const completionText = await this.client.completeText({
        model: autocompleteModel,
        prompt: fimPrompt,
        max_tokens: config.get("autocompleteMaxTokens", 128),
        temperature: config.get("temperature", 0.2),
        stop: [
          "<|fim_prefix|>",
          "<|fim_suffix|>",
          "<|fim_middle|>",
          "<|endoftext|>",
          "<|file_separator|>",
          "<EOT>",
          "<end_of_turn>",
          "\n\n"
        ]
      });
      if (token.isCancellationRequested || !completionText) {
        return void 0;
      }
      const cleanedText = this.postProcessFimCompletion(completionText, rawPrefix, rawSuffix);
      if (!cleanedText || cleanedText.trim().length === 0) {
        return void 0;
      }
      const item = new vscode.InlineCompletionItem(
        cleanedText,
        new vscode.Range(position, position)
      );
      return [item];
    } catch (error) {
      return void 0;
    }
  }
  postProcessFimCompletion(rawText, prefix, suffix) {
    let cleaned = rawText.replace(/<\|fim_prefix\|>/g, "").replace(/<\|fim_suffix\|>/g, "").replace(/<\|fim_middle\|>/g, "").replace(/<\|endoftext\|>/g, "").replace(/<\|file_separator\|>/g, "").replace(/<EOT>/g, "").replace(/<end_of_turn>/g, "");
    const linePrefix = prefix.split("\n").pop() || "";
    if (linePrefix && cleaned.startsWith(linePrefix)) {
      cleaned = cleaned.substring(linePrefix.length);
    }
    const checkLen = Math.min(prefix.length, 60);
    for (let len = checkLen; len >= 3; len--) {
      const tail = prefix.substring(prefix.length - len);
      if (cleaned.startsWith(tail)) {
        cleaned = cleaned.substring(tail.length);
        break;
      }
    }
    if (suffix) {
      const firstSuffixLine = suffix.split("\n")[0].trim();
      if (firstSuffixLine && cleaned.endsWith(firstSuffixLine)) {
        cleaned = cleaned.substring(0, cleaned.length - firstSuffixLine.length);
      }
    }
    return cleaned;
  }
};

// src/chat/chatParticipant.ts
var vscode2 = __toESM(require("vscode"));
function registerChatParticipant(context, client) {
  const handler = async (request, chatContext, streamResponse, token) => {
    const config = vscode2.workspace.getConfiguration("podllama");
    let targetModel = config.get("chatModel", "podllama-chat");
    let systemInstruction = "You are PodLlama, an autonomous local AI coding agent running on GPU-accelerated local hardware. Assist the user with precise code modifications, architectural guidance, and debugging.";
    switch (request.command) {
      case "explain":
        systemInstruction = "You are PodLlama. Explain the provided code clearly and concisely, focusing on architecture, edge cases, and functionality.";
        break;
      case "refactor":
        systemInstruction = "You are PodLlama. Refactor the provided code to improve performance, readability, type safety, and clean code principles. Provide clean code blocks with clear inline comments.";
        break;
      case "fix":
        systemInstruction = "You are PodLlama. Analyze the current file and diagnostics for bugs, syntax errors, or logical issues. Provide corrected code solutions with clear explanations.";
        break;
      case "test":
        systemInstruction = "You are PodLlama. Write comprehensive unit tests for the provided code. Use standard test frameworks suitable for the language.";
        break;
      case "think":
        targetModel = config.get("thinkingModel", "podllama-thinking");
        systemInstruction = "You are PodLlama Thinking (DeepSeek-R1 Distilled). Perform step-by-step deep reasoning and logic analysis to answer the user query thoroughly.";
        break;
    }
    const messages = [
      { role: "system", content: systemInstruction }
    ];
    let referenceContext = "";
    if (request.references && request.references.length > 0) {
      for (const ref of request.references) {
        if (ref.value instanceof vscode2.Uri) {
          try {
            const doc = await vscode2.workspace.openTextDocument(ref.value);
            const content = doc.getText();
            referenceContext += `

[Attached File Reference: ${ref.value.fsPath} (${doc.languageId})]:
\`\`\`${doc.languageId}
${content.length > 6e3 ? content.substring(0, 6e3) + "\n... [truncated]" : content}
\`\`\``;
          } catch {
          }
        } else if (ref.value instanceof vscode2.Location) {
          try {
            const doc = await vscode2.workspace.openTextDocument(ref.value.uri);
            const text = doc.getText(ref.value.range);
            referenceContext += `

[Attached Location Reference: ${ref.value.uri.fsPath} L${ref.value.range.start.line + 1}-L${ref.value.range.end.line + 1}]:
\`\`\`${doc.languageId}
${text}
\`\`\``;
          } catch {
          }
        } else if (typeof ref.value === "string") {
          referenceContext += `

[Attached Reference Context]: ${ref.value}`;
        }
      }
    }
    const activeEditor = vscode2.window.activeTextEditor;
    let editorContext = "";
    if (activeEditor) {
      const selection = activeEditor.selection;
      const selectedText = activeEditor.document.getText(selection);
      const filePath = activeEditor.document.uri.fsPath;
      const lang = activeEditor.document.languageId;
      if (selectedText.trim()) {
        editorContext = `

[Active Selection from ${filePath} (${lang})]:
\`\`\`${lang}
${selectedText}
\`\`\``;
      } else if (!referenceContext) {
        const fullText = activeEditor.document.getText();
        if (fullText.length < 4e3) {
          editorContext = `

[Active File Context from ${filePath} (${lang})]:
\`\`\`${lang}
${fullText}
\`\`\``;
        }
      }
    }
    if (request.command === "fix" && activeEditor) {
      const diagnostics = vscode2.languages.getDiagnostics(activeEditor.document.uri);
      if (diagnostics.length > 0) {
        const diagStr = diagnostics.map(
          (d) => `Line ${d.range.start.line + 1}: [${vscode2.DiagnosticSeverity[d.severity]}] ${d.message}`
        ).join("\n");
        editorContext += `

[Current File Diagnostics / Errors]:
${diagStr}`;
      }
    }
    for (const turn of chatContext.history) {
      if (turn instanceof vscode2.ChatUserTurn) {
        messages.push({ role: "user", content: turn.prompt });
      } else if (turn instanceof vscode2.ChatAssistantTurn) {
        let textContent = "";
        for (const part of turn.response) {
          if (part instanceof vscode2.ChatResponseMarkdownPart) {
            textContent += part.value.value;
          }
        }
        if (textContent) {
          messages.push({ role: "assistant", content: textContent });
        }
      }
    }
    const finalPrompt = request.prompt + referenceContext + editorContext;
    messages.push({ role: "user", content: finalPrompt });
    streamResponse.progress(`Querying PodLlama local model (${targetModel})...`);
    try {
      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());
      let fullGeneratedText = "";
      await client.streamChatCompletion(
        {
          model: targetModel,
          messages,
          temperature: config.get("temperature", 0.2)
        },
        (chunk) => {
          fullGeneratedText += chunk;
          streamResponse.markdown(chunk);
        },
        abortController.signal
      );
      if (fullGeneratedText.includes("```") && activeEditor) {
        streamResponse.button({
          command: "podllama.checkHealth",
          title: vscode2.l10n.t("Check PodLlama Status")
        });
      }
      return { metadata: { command: request.command, model: targetModel } };
    } catch (err) {
      const errorMsg = err.message || "Unknown network error connecting to PodLlama proxy.";
      streamResponse.markdown(
        `

> [!ERROR]
> **PodLlama Service Failure**: ${errorMsg}
> Ensure PodLlama service is active (\`make service-up\`).`
      );
      return { metadata: { error: errorMsg } };
    }
  };
  const participant = vscode2.chat.createChatParticipant("podllama.chat", handler);
  participant.iconPath = new vscode2.ThemeIcon("server-environment");
  return participant;
}

// src/tools/agentTools.ts
var vscode3 = __toESM(require("vscode"));
function registerAgentTools(context, client) {
  const disposables = [];
  disposables.push(
    vscode3.lm.registerTool("podllama_get_workspace_diagnostics", {
      async invoke(options, token) {
        const diagnosticsMap = [];
        const allDiags = vscode3.languages.getDiagnostics();
        for (const [uri, diags] of allDiags) {
          if (diags.length === 0) continue;
          const formatted = diags.map(
            (d) => `Line ${d.range.start.line + 1}: [${vscode3.DiagnosticSeverity[d.severity]}] ${d.message}`
          );
          diagnosticsMap.push({
            file: uri.fsPath,
            diagnostics: formatted
          });
        }
        const resultJson = JSON.stringify(diagnosticsMap, null, 2);
        return new vscode3.LanguageModelToolResult([
          new vscode3.LanguageModelTextPart(resultJson)
        ]);
      }
    })
  );
  disposables.push(
    vscode3.lm.registerTool("podllama_read_active_editor", {
      async invoke(options, token) {
        const activeEditor = vscode3.window.activeTextEditor;
        if (!activeEditor) {
          return new vscode3.LanguageModelToolResult([
            new vscode3.LanguageModelTextPart(JSON.stringify({ error: "No active editor found" }))
          ]);
        }
        const doc = activeEditor.document;
        const sel = activeEditor.selection;
        const selectedText = doc.getText(sel);
        const data = {
          filePath: doc.uri.fsPath,
          languageId: doc.languageId,
          lineCount: doc.lineCount,
          hasSelection: !sel.isEmpty,
          selectionText: selectedText,
          content: selectedText || doc.getText()
        };
        return new vscode3.LanguageModelToolResult([
          new vscode3.LanguageModelTextPart(JSON.stringify(data, null, 2))
        ]);
      }
    })
  );
  disposables.push(
    vscode3.lm.registerTool("podllama_container_status", {
      async invoke(options, token) {
        const isHealthy = await client.checkHealth();
        let models = [];
        let error;
        if (isHealthy) {
          try {
            models = await client.listModels();
          } catch (e) {
            error = e.message;
          }
        }
        const statusData = {
          apiBase: client.currentConfig.apiBase,
          status: isHealthy ? "healthy" : "offline",
          models,
          error
        };
        return new vscode3.LanguageModelToolResult([
          new vscode3.LanguageModelTextPart(JSON.stringify(statusData, null, 2))
        ]);
      }
    })
  );
  disposables.push(
    vscode3.lm.registerTool("podllama_switch_model", {
      async invoke(options, token) {
        const targetModel = options.input.model;
        if (!targetModel) {
          return new vscode3.LanguageModelToolResult([
            new vscode3.LanguageModelTextPart(JSON.stringify({ error: 'Missing required "model" parameter' }))
          ]);
        }
        try {
          await client.chatCompletion({
            model: targetModel,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
          });
          return new vscode3.LanguageModelToolResult([
            new vscode3.LanguageModelTextPart(
              JSON.stringify({ success: true, message: `Successfully loaded model ${targetModel}` })
            )
          ]);
        } catch (e) {
          return new vscode3.LanguageModelToolResult([
            new vscode3.LanguageModelTextPart(
              JSON.stringify({ success: false, error: e.message || "Model swap failed" })
            )
          ]);
        }
      }
    })
  );
  return disposables;
}

// src/ui/statusBar.ts
var vscode4 = __toESM(require("vscode"));
var PodLlamaStatusBarManager = class {
  constructor(client) {
    this.client = client;
    this.statusBarItem = vscode4.window.createStatusBarItem(
      vscode4.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "podllama.selectModel";
    this.updateStatus();
    this.statusBarItem.show();
    this.pollInterval = setInterval(() => this.updateStatus(), 1e4);
  }
  client;
  statusBarItem;
  pollInterval;
  async updateStatus() {
    const config = vscode4.workspace.getConfiguration("podllama");
    const enabled = config.get("enableAutocomplete", true);
    const chatModel = config.get("chatModel", "podllama-chat");
    const isHealthy = await this.client.checkHealth();
    if (isHealthy) {
      const autoTag = enabled ? "FIM: On" : "FIM: Off";
      this.statusBarItem.text = `$(server) PodLlama: Ready (${chatModel} | ${autoTag})`;
      this.statusBarItem.tooltip = `PodLlama Local Service is Online
Base URL: ${this.client.currentConfig.apiBase}
Active Chat Model: ${chatModel}
Inline Autocomplete: ${enabled ? "Enabled" : "Disabled"}
Click to configure or switch models.`;
      this.statusBarItem.backgroundColor = void 0;
    } else {
      this.statusBarItem.text = `$(error) PodLlama: Offline`;
      this.statusBarItem.tooltip = `PodLlama Local Service is Offline
Cannot connect to ${this.client.currentConfig.apiBase}.
Run 'make service-up' to start containers.
Click to re-check status or switch configuration.`;
      this.statusBarItem.backgroundColor = new vscode4.ThemeColor("statusBarItem.errorBackground");
    }
  }
  dispose() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.statusBarItem.dispose();
  }
};

// src/provider/languageModelProvider.ts
var vscode5 = __toESM(require("vscode"));
var PodLlamaLanguageModelProvider = class {
  constructor(client) {
    this.client = client;
  }
  client;
  register(context) {
    const disposables = [];
    if (typeof vscode5.lm.registerLanguageModelChatProvider === "function") {
      const vendorIds = ["podllama", "customendpoint"];
      for (const vendorId of vendorIds) {
        try {
          const providerDisposable = vscode5.lm.registerLanguageModelChatProvider(
            vendorId,
            {
              provideLanguageModelResponse: async (modelId, messages, options, extensionId, progress, token) => {
                const formattedMessages = [];
                for (const msg of messages) {
                  let role = "user";
                  if (msg.role === vscode5.LanguageModelChatMessageRole.Assistant) {
                    role = "assistant";
                  } else if (msg.role === vscode5.LanguageModelChatMessageRole.User) {
                    role = "user";
                  }
                  let text = "";
                  if (typeof msg.content === "string") {
                    text = msg.content;
                  } else if (Array.isArray(msg.content)) {
                    text = msg.content.map((part) => typeof part.value === "string" ? part.value : part.text || "").join("");
                  }
                  formattedMessages.push({ role, content: text });
                }
                const targetModel = modelId || this.client.currentConfig.chatModel;
                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());
                await this.client.streamChatCompletion(
                  {
                    model: targetModel,
                    messages: formattedMessages,
                    temperature: this.client.currentConfig.temperature
                  },
                  (chunk) => {
                    progress.report({
                      index: 0,
                      part: new vscode5.LanguageModelTextPart(chunk)
                    });
                  },
                  abortController.signal
                );
              }
            }
          );
          disposables.push(providerDisposable);
        } catch (err) {
          console.warn(`PodLlama LM Provider registration warning for ${vendorId}:`, err);
        }
      }
    }
    return disposables;
  }
};

// src/extension.ts
var podllamaClient;
var statusBarManager;
function activate(context) {
  console.log("Activating PodLlama VS Code Extension...");
  initializeLocalEndpoints(context);
  const config = getClientConfig();
  podllamaClient = new PodLlamaClient(config);
  const inlineProvider = new PodLlamaInlineCompletionProvider(podllamaClient);
  const inlineDisposable = vscode6.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    inlineProvider
  );
  context.subscriptions.push(inlineDisposable);
  const chatParticipant = registerChatParticipant(context, podllamaClient);
  context.subscriptions.push(chatParticipant);
  const toolDisposables = registerAgentTools(context, podllamaClient);
  context.subscriptions.push(...toolDisposables);
  const lmProvider = new PodLlamaLanguageModelProvider(podllamaClient);
  const lmDisposables = lmProvider.register(context);
  context.subscriptions.push(...lmDisposables);
  statusBarManager = new PodLlamaStatusBarManager(podllamaClient);
  context.subscriptions.push(statusBarManager);
  registerExtensionCommands(context);
  context.subscriptions.push(
    vscode6.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("podllama")) {
        const newConfig = getClientConfig();
        podllamaClient.updateConfig(newConfig);
        statusBarManager.updateStatus();
      }
    })
  );
  console.log("PodLlama VS Code Extension successfully activated.");
}
function deactivate() {
  if (statusBarManager) {
    statusBarManager.dispose();
  }
}
function getPodLlamaModelProviderDef(apiKey) {
  return {
    name: "Podllama",
    vendor: "customendpoint",
    apiKey: apiKey || "sk-local",
    apiType: "chat-completions",
    models: [
      {
        id: "podllama-chat",
        name: "PodLlama Chat (Qwen 2.5 Coder 7B)",
        url: "http://localhost:4000/v1/chat/completions",
        toolCalling: true,
        vision: false,
        maxInputTokens: 16384,
        maxOutputTokens: 4096
      },
      {
        id: "podllama-thinking",
        name: "PodLlama Thinking (DeepSeek-R1 Distill 7B/14B)",
        url: "http://localhost:4000/v1/chat/completions",
        toolCalling: true,
        vision: false,
        maxInputTokens: 16384,
        maxOutputTokens: 4096
      },
      {
        id: "podllama-autocomplete",
        name: "PodLlama Autocomplete (Qwen 2.5 Coder 0.5B)",
        url: "http://localhost:4000/v1/completions",
        toolCalling: false,
        vision: false,
        maxInputTokens: 4096,
        maxOutputTokens: 512
      }
    ]
  };
}
function syncModelProvidersToDisk(podllamaEndpointDef) {
  const home = os.homedir();
  const settingsPaths = [
    path.join(home, ".config", "Code", "User", "settings.json"),
    path.join(home, ".config", "Code - Insiders", "User", "settings.json"),
    path.join(home, ".config", "VSCodium", "User", "settings.json"),
    path.join(home, ".config", "Cursor", "User", "settings.json"),
    path.join(home, "Library", "Application Support", "Code", "User", "settings.json"),
    path.join(home, "Library", "Application Support", "Cursor", "User", "settings.json"),
    path.join(process.env.APPDATA || "", "Code", "User", "settings.json"),
    path.join(process.env.APPDATA || "", "Cursor", "User", "settings.json")
  ];
  for (const sPath of settingsPaths) {
    if (fs.existsSync(sPath)) {
      try {
        const raw = fs.readFileSync(sPath, "utf8");
        let cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
        const json = JSON.parse(cleaned);
        let customEndpoints = json["github.copilot.chat.customEndpoints"] || json["chat.customEndpoints"] || [];
        if (!Array.isArray(customEndpoints)) {
          customEndpoints = [];
        }
        const hasPodllama = customEndpoints.some(
          (e) => e && (e.name === "Podllama" || e.name === "PodLlama")
        );
        if (!hasPodllama) {
          customEndpoints.push(podllamaEndpointDef);
          json["github.copilot.chat.customEndpoints"] = customEndpoints;
          json["chat.customEndpoints"] = customEndpoints;
        }
        let agentProviders = json["chat.agent.providers"] || json["chat.agent.customProviders"] || [];
        if (!Array.isArray(agentProviders)) {
          agentProviders = [];
        }
        if (!agentProviders.some((p) => typeof p === "string" && p === "PodLlama" || p?.name === "PodLlama")) {
          agentProviders.push({
            id: "podllama",
            name: "PodLlama",
            provider: "customendpoint",
            url: "http://localhost:4000/v1"
          });
          json["chat.agent.providers"] = agentProviders;
          json["chat.agent.customProviders"] = agentProviders;
        }
        fs.writeFileSync(sPath, JSON.stringify(json, null, 2), "utf8");
        console.log(`PodLlama Model Provider & Agent dropdown synced to ${sPath}`);
      } catch {
      }
    }
  }
}
async function initializeLocalEndpoints(context) {
  const isInitialized = context.globalState.get("podllamaInitialized", false);
  const cfg = vscode6.workspace.getConfiguration("podllama");
  const targetApiBase = cfg.get("apiBase", "http://localhost:4000/v1");
  const targetApiKey = cfg.get("apiKey", "sk-local");
  if (!cfg.get("apiBase")) {
    await cfg.update("apiBase", "http://localhost:4000/v1", vscode6.ConfigurationTarget.Global);
  }
  if (!cfg.get("apiKey")) {
    await cfg.update("apiKey", "sk-local", vscode6.ConfigurationTarget.Global);
  }
  if (!cfg.get("chatModel")) {
    await cfg.update("chatModel", "podllama-chat", vscode6.ConfigurationTarget.Global);
  }
  if (!cfg.get("thinkingModel")) {
    await cfg.update("thinkingModel", "podllama-thinking", vscode6.ConfigurationTarget.Global);
  }
  if (!cfg.get("autocompleteModel")) {
    await cfg.update("autocompleteModel", "podllama-autocomplete", vscode6.ConfigurationTarget.Global);
  }
  const podllamaEndpointDef = getPodLlamaModelProviderDef(targetApiKey);
  syncModelProvidersToDisk(podllamaEndpointDef);
  try {
    const copilotCfg = vscode6.workspace.getConfiguration("github.copilot.chat");
    const existingCustom = copilotCfg.get("customEndpoints") || [];
    const hasPodllama = existingCustom.some((e) => e && (e.name === "Podllama" || e.name === "PodLlama"));
    if (!hasPodllama) {
      const updated = [...existingCustom, podllamaEndpointDef];
      await copilotCfg.update("customEndpoints", updated, vscode6.ConfigurationTarget.Global);
    }
  } catch (err) {
  }
  try {
    const continueDir = path.join(os.homedir(), ".continue");
    if (fs.existsSync(continueDir)) {
      const continueJsonPath = path.join(continueDir, "config.json");
      if (fs.existsSync(continueJsonPath)) {
        const content = fs.readFileSync(continueJsonPath, "utf8");
        const json = JSON.parse(content);
        json.models = json.models || [];
        const hasPodLlama = json.models.some((m) => m.model === "podllama-chat" || m.apiBase?.includes("4000"));
        if (!hasPodLlama) {
          json.models.push({
            title: "PodLlama Chat (Local Vulkan)",
            provider: "openai",
            model: "podllama-chat",
            apiBase: "http://localhost:4000/v1",
            apiKey: "sk-local"
          });
          json.models.push({
            title: "PodLlama Thinking (Local Vulkan)",
            provider: "openai",
            model: "podllama-thinking",
            apiBase: "http://localhost:4000/v1",
            apiKey: "sk-local"
          });
          json.tabAutocompleteModel = json.tabAutocompleteModel || {
            title: "PodLlama Autocomplete (Local Vulkan)",
            provider: "openai",
            model: "podllama-autocomplete",
            apiBase: "http://localhost:4000/v1",
            apiKey: "sk-local"
          };
          fs.writeFileSync(continueJsonPath, JSON.stringify(json, null, 2), "utf8");
        }
      }
    }
  } catch (err) {
  }
  if (!isInitialized) {
    await context.globalState.update("podllamaInitialized", true);
    vscode6.window.showInformationMessage(
      `PodLlama Model Provider configured at ${targetApiBase}!`,
      "Check Health",
      "Select Model"
    ).then((choice) => {
      if (choice === "Check Health") {
        vscode6.commands.executeCommand("podllama.checkHealth");
      } else if (choice === "Select Model") {
        vscode6.commands.executeCommand("podllama.selectModel");
      }
    });
  }
}
function getClientConfig() {
  const cfg = vscode6.workspace.getConfiguration("podllama");
  return {
    apiBase: cfg.get("apiBase", "http://localhost:4000/v1"),
    apiKey: cfg.get("apiKey", "sk-local"),
    chatModel: cfg.get("chatModel", "podllama-chat"),
    thinkingModel: cfg.get("thinkingModel", "podllama-thinking"),
    autocompleteModel: cfg.get("autocompleteModel", "podllama-autocomplete"),
    temperature: cfg.get("temperature", 0.2),
    autocompleteMaxTokens: cfg.get("autocompleteMaxTokens", 128)
  };
}
function registerExtensionCommands(context) {
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.openSettings", () => {
      vscode6.commands.executeCommand("workbench.action.openSettings", "@ext:podllama.podllama-vscode");
    })
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.installCustomEndpoints", async () => {
      const cfg = vscode6.workspace.getConfiguration("podllama");
      const apiKey = cfg.get("apiKey", "sk-local");
      const podllamaEndpointDef = getPodLlamaModelProviderDef(apiKey);
      syncModelProvidersToDisk(podllamaEndpointDef);
      try {
        const copilotCfg = vscode6.workspace.getConfiguration("github.copilot.chat");
        const existing = copilotCfg.get("customEndpoints") || [];
        if (!existing.some((e) => e && (e.name === "Podllama" || e.name === "PodLlama"))) {
          await copilotCfg.update("customEndpoints", [...existing, podllamaEndpointDef], vscode6.ConfigurationTarget.Global);
        }
      } catch {
      }
      vscode6.window.showInformationMessage("PodLlama Model Provider successfully registered in VS Code settings!");
    })
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.checkHealth", async () => {
      const isHealthy = await podllamaClient.checkHealth();
      if (isHealthy) {
        try {
          const models = await podllamaClient.listModels();
          vscode6.window.showInformationMessage(
            `PodLlama Service Online! Active Models: ${models.join(", ")}`
          );
        } catch (e) {
          vscode6.window.showInformationMessage(`PodLlama Service Online!`);
        }
      } else {
        vscode6.window.showErrorMessage(
          `PodLlama Service Offline (${podllamaClient.currentConfig.apiBase}). Run 'make service-up' to start local container stack.`
        );
      }
      statusBarManager.updateStatus();
    })
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.selectModel", async () => {
      let models = ["podllama-chat", "podllama-thinking", "podllama-autocomplete"];
      try {
        const fetched = await podllamaClient.listModels();
        if (fetched.length > 0) {
          models = fetched;
        }
      } catch {
      }
      const selected = await vscode6.window.showQuickPick(models, {
        placeHolder: "Select active PodLlama model role or model file"
      });
      if (selected) {
        const cfg = vscode6.workspace.getConfiguration("podllama");
        if (selected.includes("thinking") || selected.includes("DeepSeek")) {
          await cfg.update("thinkingModel", selected, vscode6.ConfigurationTarget.Global);
          vscode6.window.showInformationMessage(`PodLlama Thinking model set to: ${selected}`);
        } else if (selected.includes("autocomplete")) {
          await cfg.update("autocompleteModel", selected, vscode6.ConfigurationTarget.Global);
          vscode6.window.showInformationMessage(`PodLlama Autocomplete model set to: ${selected}`);
        } else {
          await cfg.update("chatModel", selected, vscode6.ConfigurationTarget.Global);
          vscode6.window.showInformationMessage(`PodLlama Chat model set to: ${selected}`);
        }
        statusBarManager.updateStatus();
      }
    })
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.toggleAutocomplete", async () => {
      const cfg = vscode6.workspace.getConfiguration("podllama");
      const current = cfg.get("enableAutocomplete", true);
      await cfg.update("enableAutocomplete", !current, vscode6.ConfigurationTarget.Global);
      vscode6.window.showInformationMessage(
        `PodLlama Inline Autocomplete is now ${!current ? "ENABLED" : "DISABLED"}.`
      );
      statusBarManager.updateStatus();
    })
  );
  const openChatWithCommand = async (command) => {
    await vscode6.commands.executeCommand("workbench.action.quickchat.toggle");
  };
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.explainCode", () => openChatWithCommand("explain"))
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.refactorCode", () => openChatWithCommand("refactor"))
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.fixCode", () => openChatWithCommand("fix"))
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("podllama.generateTests", () => openChatWithCommand("test"))
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
