import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { ConversationManager, ConversationSession } from "./conversationManager";
import { PodLlamaClient } from "./podllama-client";
import { DiffContentProvider } from "./diffContentProvider";

interface ActiveStreamState {
    request: http.ClientRequest;
    accumulatedText: string;
    model: string;
    conv: ConversationSession;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "podllama.chatView";
    private _view?: vscode.WebviewView;
    private activeStreams: Map<string, ActiveStreamState> = new Map();
    private lastSelectedModel: string | undefined;
    private lastSelectedPersona: string | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private conversationManager: ConversationManager,
        private client: PodLlamaClient,
        private getSettings: () => { apiBase: string; apiKey: string; chatModel: string; thinkingModel: string },
        private diffProvider: DiffContentProvider
    ) { }

    private abortCurrentRequest(conversationId?: string) {
        const targetId = conversationId || this.conversationManager.getActiveConversationId();
        if (targetId && this.activeStreams.has(targetId)) {
            const stream = this.activeStreams.get(targetId)!;
            stream.request.destroy();
            
            if (stream.accumulatedText) {
                stream.conv.messages.push({
                    id: `msg_${Date.now()}`,
                    role: "assistant",
                    content: stream.accumulatedText + "\n\n*Generation stopped by user.*",
                    model: stream.model,
                    timestamp: Date.now()
                });
                this.conversationManager.saveConversation(stream.conv);
            }

            this.activeStreams.delete(targetId);

            if (this.conversationManager.getActiveConversationId() === targetId) {
                this._view?.webview.postMessage({
                    type: "streamToken",
                    conversationId: targetId,
                    text: "\n\n*Generation stopped by user.*"
                });
                this._view?.webview.postMessage({
                    type: "streamEnd",
                    conversationId: targetId
                });
            }

            this.sendHistoryList();
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.description = "Local AI Chat";
        // @ts-ignore
        webviewView.webview.options.retainContextWhenHidden = true;

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle incoming messages from Webview UI
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case "copyToClipboard":
                    if (data.text) {
                        vscode.env.clipboard.writeText(data.text);
                        vscode.window.showInformationMessage("Conversation copied to clipboard as Markdown.");
                    }
                    break;
                case "insertToActiveFile":
                    if (data.markdown) {
                        await this.insertToActiveFile(data.markdown);
                    }
                    break;
                case "sendMessage":
                    await this.handleUserMessage(data.prompt, data.model, data.persona, data.conversationId);
                    break;
                case "newConversation":
                    const newConv = this.conversationManager.createConversation("New Chat", this.lastSelectedModel, this.lastSelectedPersona);
                    await this.refreshWebviewSession(newConv);
                    this.sendHistoryList();
                    break;
                case "getHistoryList":
                    this.sendHistoryList();
                    break;
                case "selectConversation":
                    const conv = this.conversationManager.setActiveConversation(data.id);
                    if (conv) {
                        await this.refreshWebviewSession(conv);
                    }
                    break;
                case "deleteConversation":
                    if (this.activeStreams.has(data.id)) {
                        this.abortCurrentRequest(data.id);
                    }
                    const updatedList = this.conversationManager.deleteConversation(data.id);
                    this.sendHistoryList(updatedList);
                    const activeConv = this.conversationManager.getActiveConversation();
                    await this.refreshWebviewSession(activeConv);
                    break;
                case "applyPatch":
                    await this.applyCodePatch(data.code);
                    break;
                case "stopGeneration":
                    this.abortCurrentRequest(data.conversationId);
                    break;
                case "addContextAttachment":
                    await this.handleAddContextAttachment();
                    break;
                case "renameConversation":
                    const targetConvId = data.conversationId || this.conversationManager.getActiveConversationId();
                    const allConvs = this.conversationManager.getAllConversations();
                    const targetConv = allConvs.find(c => c.id === targetConvId) || this.conversationManager.getActiveConversation();
                    if (targetConv) {
                        targetConv.title = data.title;
                        this.conversationManager.saveConversation(targetConv);
                        this.sendHistoryList();
                    }
                    break;
                case "selectModel":
                    this.lastSelectedModel = data.model;
                    const activeModelConv = this.conversationManager.getActiveConversation();
                    if (activeModelConv) {
                        activeModelConv.selectedModel = data.model;
                        this.conversationManager.saveConversation(activeModelConv);
                    }
                    try {
                        const config = vscode.workspace.getConfiguration("podllama");
                        await config.update("chatModel", data.model, vscode.ConfigurationTarget.Global);
                    } catch (e) {
                        console.error("[PodLlama] Failed to update chatModel setting:", e);
                    }
                    break;
                case "selectPersona":
                    this.lastSelectedPersona = data.persona;
                    const activePersonaConv = this.conversationManager.getActiveConversation();
                    if (activePersonaConv) {
                        activePersonaConv.selectedPersona = data.persona;
                        this.conversationManager.saveConversation(activePersonaConv);
                    }
                    break;
            }
        });

        // Initialize session data in webview
        const activeConv = this.conversationManager.getActiveConversation();
        this.refreshWebviewSession(activeConv);
    }

    public async refreshWebviewSession(conv = this.conversationManager.getActiveConversation()) {
        if (!this._view || !conv) return;

        const models = await this.client.listModels();
        const personas = await this.client.listPersonas();
        const settings = this.getSettings();
        const activeModel = conv.selectedModel || this.lastSelectedModel || settings.chatModel;
        const activePersona = conv.selectedPersona || this.lastSelectedPersona || "";

        const activeStream = this.activeStreams.get(conv.id);
        const isGenerating = !!activeStream;
        const partialText = activeStream ? activeStream.accumulatedText : "";

        this._view.webview.postMessage({
            type: "initSession",
            session: conv,
            isGenerating: isGenerating,
            partialText: partialText,
            runningConversationIds: Array.from(this.activeStreams.keys()),
            models: models.length > 0 ? models : [
                { id: settings.chatModel, object: "model", owned_by: "litellm" },
                { id: settings.thinkingModel, object: "model", owned_by: "litellm" },
                { id: "podllama-instruct", object: "model", owned_by: "litellm" }
            ],
            selectedModel: activeModel,
            personas: personas,
            selectedPersona: activePersona
        });

        this.sendHistoryList();
    }

    private sendHistoryList(list = this.conversationManager.getAllConversations()) {
        if (!this._view) return;
        this._view.webview.postMessage({
            type: "updateHistoryList",
            conversations: list,
            activeConversationId: this.conversationManager.getActiveConversationId(),
            runningConversationIds: Array.from(this.activeStreams.keys())
        });
    }

    private async handleUserMessage(prompt: string, selectedModel: string, selectedPersona?: string, targetConversationId?: string) {
        const allConvs = this.conversationManager.getAllConversations();
        const conv = (targetConversationId ? allConvs.find(c => c.id === targetConversationId) : undefined) || this.conversationManager.getActiveConversation();

        // Add User Turn
        conv.messages.push({
            id: `msg_${Date.now()}`,
            role: "user",
            content: prompt,
            timestamp: Date.now()
        });

        if (conv.messages.length === 1) {
            conv.title = prompt.length > 25 ? prompt.substring(0, 25) + "..." : prompt;
        }

        this.conversationManager.saveConversation(conv);
        this.sendHistoryList();

        // Summarize context if conversation exceeds 6 turns asynchronously
        if (conv.messages.length > 6 && !conv.summarizedContext) {
            this.client.summarizeContext(conv.messages.slice(0, -2), selectedModel)
                .then(summary => {
                    if (summary) {
                        conv.summarizedContext = summary;
                        this.conversationManager.saveConversation(conv);
                    }
                })
                .catch(err => console.error("[PodLlama] Background context summary error:", err));
        }

        // Fetch personas to inject system prompt and auto-detect target model
        const personas = await this.client.listPersonas();
        let activePersona = personas.find(p => p.id === selectedPersona);
        if (!activePersona && prompt.startsWith("/")) {
            const slashWord = prompt.split(" ")[0].toLowerCase();
            activePersona = personas.find(p => p.slash_command.toLowerCase() === slashWord);
        }

        // Prepare messages payload for API
        const payloadMessages = [];
        if (activePersona && activePersona.system_prompt) {
            payloadMessages.push({
                role: "system",
                content: activePersona.system_prompt
            });
        }
        if (conv.summarizedContext) {
            payloadMessages.push({
                role: "system",
                content: `Previous Conversation Summary Context:\n${conv.summarizedContext}`
            });
        }
        conv.messages.forEach(m => {
            payloadMessages.push({ role: m.role, content: m.content });
        });

        // Target model resolution
        let targetModel = selectedModel;
        if (activePersona && activePersona.target_model && (!selectedModel || selectedModel === "podllama-chat")) {
            targetModel = activePersona.target_model;
        }

        // Stream AI Response asynchronously so concurrent requests run simultaneously
        this.streamChatCompletions(targetModel, payloadMessages, conv);
    }

    private streamChatCompletions(model: string, messages: any[], conv: ConversationSession): Promise<void> {
        return new Promise((resolve) => {
            const settings = this.getSettings();
            const apiBase = settings.apiBase.replace(/\/$/, "");
            const parsedUrl = new URL(`${apiBase}/chat/completions`);
            const transport = parsedUrl.protocol === "https:" ? https : http;

            const body = JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.2,
                stream: true
            });

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${settings.apiKey}`
                }
            };

            let streamBuffer = "";

            const req = transport.request(options, (res) => {
                res.on("data", (chunk: Buffer) => {
                    streamBuffer += chunk.toString("utf8");
                    const lines = streamBuffer.split("\n");
                    streamBuffer = lines.pop() || "";

                    const activeStream = this.activeStreams.get(conv.id);
                    if (!activeStream) return;

                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (line.startsWith("data:") && line !== "data: [DONE]" && line !== "data:[DONE]") {
                            try {
                                const jsonStr = line.replace(/^data:\s*/, "");
                                const json = JSON.parse(jsonStr);
                                const delta = json.choices[0]?.delta;
                                if (delta) {
                                    const tokenText = delta.content ?? delta.reasoning_content ?? delta.thinking ?? "";
                                    if (tokenText) {
                                        activeStream.accumulatedText += tokenText;
                                        if (this.conversationManager.getActiveConversationId() === conv.id) {
                                            this._view?.webview.postMessage({
                                                type: "streamToken",
                                                conversationId: conv.id,
                                                text: tokenText
                                            });
                                        }
                                    }
                                }
                            } catch (e) {
                                // Skip non-JSON chunks
                            }
                        }
                    }
                });

                res.on("end", () => {
                    const activeStream = this.activeStreams.get(conv.id);
                    if (activeStream) {
                        const trailingLine = streamBuffer.trim();
                        if (trailingLine.startsWith("data:") && trailingLine !== "data: [DONE]" && trailingLine !== "data:[DONE]") {
                            try {
                                const jsonStr = trailingLine.replace(/^data:\s*/, "");
                                const json = JSON.parse(jsonStr);
                                const delta = json.choices[0]?.delta;
                                if (delta) {
                                    const tokenText = delta.content ?? delta.reasoning_content ?? delta.thinking ?? "";
                                    if (tokenText) {
                                        activeStream.accumulatedText += tokenText;
                                        if (this.conversationManager.getActiveConversationId() === conv.id) {
                                            this._view?.webview.postMessage({
                                                type: "streamToken",
                                                conversationId: conv.id,
                                                text: tokenText
                                            });
                                        }
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }
                        }

                        const finalText = activeStream.accumulatedText;
                        this.activeStreams.delete(conv.id);

                        conv.messages.push({
                            id: `msg_${Date.now()}`,
                            role: "assistant",
                            content: finalText,
                            model: model,
                            timestamp: Date.now()
                        });

                        this.conversationManager.saveConversation(conv);

                        if (this.conversationManager.getActiveConversationId() === conv.id) {
                            this._view?.webview.postMessage({
                                type: "streamEnd",
                                conversationId: conv.id
                            });
                        }

                        this.sendHistoryList();
                    }
                    resolve();
                });
            });

            req.on("error", (err) => {
                console.error(`[PodLlama] Stream error for conversation ${conv.id}:`, err);
                const activeStream = this.activeStreams.get(conv.id);
                this.activeStreams.delete(conv.id);

                if (activeStream) {
                    conv.messages.push({
                        id: `msg_${Date.now()}`,
                        role: "assistant",
                        content: (activeStream.accumulatedText ? activeStream.accumulatedText + "\n\n" : "") + `*Error connecting to PodLlama backend: ${err.message}*`,
                        model: model,
                        timestamp: Date.now()
                    });
                    this.conversationManager.saveConversation(conv);
                }

                if (this.conversationManager.getActiveConversationId() === conv.id) {
                    this._view?.webview.postMessage({
                        type: "streamToken",
                        conversationId: conv.id,
                        text: `\n\n*Error connecting to PodLlama backend: ${err.message}*`
                    });
                    this._view?.webview.postMessage({
                        type: "streamEnd",
                        conversationId: conv.id
                    });
                }

                this.sendHistoryList();
                resolve();
            });

            this.activeStreams.set(conv.id, {
                request: req,
                accumulatedText: "",
                model,
                conv
            });

            this.sendHistoryList();
            req.write(body);
            req.end();
        });
    }

    
    public exportActiveConversationMarkdown(): string {
        const conv = this.conversationManager.getActiveConversation();
        if (!conv || !conv.messages || conv.messages.length === 0) {
            return "# PodLlama Chat\n\n*Empty conversation*";
        }
        let md = `# ${conv.title || "PodLlama Chat"}\n\n`;
        if (conv.createdAt) {
            md += `*Date: ${new Date(conv.createdAt).toLocaleString()}*\n`;
        }
        if (conv.selectedModel) {
            md += `*Model: ${conv.selectedModel}*\n`;
        }
        md += "\n---\n\n";

        conv.messages.forEach(msg => {
            const roleTitle = msg.role === "user" ? "👤 User" : `🤖 Assistant${msg.model ? ` (${msg.model})` : ""}`;
            md += `### ${roleTitle}\n\n`;
            if (msg.thinking) {
                md += `> **Thought Process:**\n> ${msg.thinking.replace(/\n/g, "\n> ")}\n\n`;
            }
            md += `${msg.content}\n\n`;
        });
        return md.trim();
    }

    public async insertToActiveFile(markdown: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No active editor found. Open a file to insert the chat markdown.");
            return false;
        }

        const document = editor.document;
        const selection = editor.selection;

        const edit = new vscode.WorkspaceEdit();
        if (selection.isEmpty) {
            edit.insert(document.uri, selection.active, markdown);
        } else {
            edit.replace(document.uri, selection, markdown);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage("Chat markdown inserted into active file.");
            return true;
        } else {
            vscode.window.showErrorMessage("Failed to insert chat markdown into active file.");
            return false;
        }
    }

    private async applyCodePatch(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No active editor found to apply code patch.");
            return;
        }

        const document = editor.document;
        const selection = editor.selection;

        const edit = new vscode.WorkspaceEdit();
        if (selection.isEmpty) {
            edit.insert(document.uri, selection.active, code);
        } else {
            edit.replace(document.uri, selection, code);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.commands.executeCommand("editor.action.dirtydiff.next");

            const accept = "Accept Changes";
            const reject = "Reject Changes";
            const action = await vscode.window.showInformationMessage(
                "Proposed changes applied. Would you like to keep them?",
                accept,
                reject
            );

            if (action === reject) {
                await vscode.commands.executeCommand("undo");
                vscode.window.showInformationMessage("Changes rejected and reverted.");
            } else if (action === accept) {
                await document.save();
                vscode.window.showInformationMessage("Changes accepted and saved.");
            }
        } else {
            vscode.window.showErrorMessage("Failed to apply proposed code changes.");
        }
    }

    private async handleAddContextAttachment() {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Add to context",
            filters: {
                "Code / Text Files": ["ts", "js", "py", "json", "yaml", "yml", "md", "txt", "go", "rs", "c", "cpp", "h", "java", "html", "css", "sh"]
            }
        });

        if (fileUris && fileUris.length > 0) {
            try {
                const doc = await vscode.workspace.openTextDocument(fileUris[0]);
                const content = doc.getText();
                const relativePath = vscode.workspace.asRelativePath(fileUris[0]);

                const contextStr = "\n\n[Context: " + relativePath + "]\n```\n" + content + "\n```\n";
                this._view?.webview.postMessage({
                    type: "streamToken",
                    text: "",
                    thinking: "",
                    appendInput: contextStr
                });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to read file context: ${err.message}`);
            }
        }
    }

    public injectCodeSelection(code: string, filepath: string, instruction?: string) {
        if (!this._view) {
            vscode.commands.executeCommand("workbench.view.extension.podllama-activitybar");
        }

        const relativePath = vscode.workspace.asRelativePath(filepath);
        let injectedVal = "";
        if (instruction) {
            injectedVal += `${instruction}\n`;
        }
        injectedVal += "\n[Context Selection: " + relativePath + "]\n```\n" + code + "\n```\n";

        this._view?.webview.postMessage({
            type: "streamToken",
            text: "",
            thinking: "",
            appendInput: injectedVal
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "src", "media", "chat.css"));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "src", "media", "chat.js"));
        const fontAwesomeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "src", "media", "font-awesome", "css", "all.min.css"));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PodLlama Code</title>
    <link href="${fontAwesomeUri}" rel="stylesheet">
    <link href="${cssUri}" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
</head>
<body>
    <div class="chat-header">
        <div class="title-group">
            <i class="fa-solid fa-laptop-code" style="font-size: 14px; color: var(--accent); flex-shrink:0;"></i>
            <input type="text" class="chat-title-input" id="chat-title-input" value="PodLlama Code" title="Click to rename conversation" />
        </div>
        <div class="header-actions">
            <div class="export-dropdown-container">
                <button class="icon-btn" id="export-menu-btn" title="Export Conversation (Markdown / Insert)"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
                <div class="export-dropdown-menu" id="export-dropdown-menu">
                    <button class="export-menu-item" id="copy-markdown-btn" title="Copy conversation as formatted Markdown">
                        <i class="fa-solid fa-copy"></i>
                        <span>Copy as Markdown</span>
                    </button>
                    <button class="export-menu-item" id="insert-active-file-btn" title="Insert conversation markdown into active file">
                        <i class="fa-solid fa-file-import"></i>
                        <span>Insert to Active File</span>
                    </button>
                </div>
            </div>
            <button class="icon-btn" id="new-chat-btn" title="New Conversation"><i class="fa-solid fa-plus"></i></button>
            <button class="icon-btn" id="history-btn" title="Conversation History"><i class="fa-solid fa-clock-rotate-left"></i></button>
        </div>
    </div>

    <div class="history-drawer" id="history-drawer">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>Past Conversations</span>
            <span id="active-sessions-count" style="font-size: 11px; color: var(--text-muted); font-weight: 400;"></span>
        </div>
        <ul class="history-list" id="history-list"></ul>
    </div>

    <div class="chat-messages" id="chat-messages"></div>

    <div class="input-container">
        <div class="textarea-wrapper">
            <textarea id="prompt-input" placeholder="Ask anything, @ to mention, / for actions"></textarea>
        </div>
        <div class="input-footer">
            <div class="left-controls">
                <span class="plus-icon" id="add-context-btn" title="Add context attachment"><i class="fa-solid fa-plus"></i></span>
                <div class="persona-select-container">
                    <select class="select-control" id="persona-select" title="Select Persona Profile">
                        <option value="">Default Persona</option>
                    </select>
                </div>
                <div class="model-select-container">
                    <select class="select-control" id="model-select">
                        <option value="podllama-chat">podllama-chat</option>
                        <option value="podllama-thinking">podllama-thinking</option>
                    </select>
                </div>
            </div>
            <button class="send-btn" id="send-btn" title="Send Message">
                <i class="fa-solid fa-circle-play" style="font-size: 22px;"></i>
            </button>
        </div>
    </div>

    <script src="${jsUri}"></script>
</body>
</html>`;
    }
}
