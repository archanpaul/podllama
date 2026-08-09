import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ConversationManager } from './conversationManager';
import { PodLlamaClient } from './podllama-client';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'podllama.chatView';
    private _view?: vscode.WebviewView;
    private activeRequest: http.ClientRequest | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private conversationManager: ConversationManager,
        private client: PodLlamaClient,
        private getSettings: () => { apiBase: string; apiKey: string; chatModel: string; thinkingModel: string }
    ) {}

    private abortCurrentRequest() {
        if (this.activeRequest) {
            this.activeRequest.destroy();
            this.activeRequest = undefined;
            this._view?.webview.postMessage({
                type: 'streamToken',
                text: '\n\n*Generation stopped by user.*'
            });
            this._view?.webview.postMessage({ type: 'streamEnd' });
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

        // Retain webview context when hidden to prevent text/messages from resetting
        webviewView.description = "Local AI Chat";
        // @ts-ignore
        if (typeof webviewView.show === 'function') {
            // some versions expose different view options
        }
        // @ts-ignore
        webviewView.webview.options.retainContextWhenHidden = true;

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle incoming messages from Webview UI
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'sendMessage':
                    await this.handleUserMessage(data.prompt, data.model);
                    break;
                case 'newConversation':
                    const newConv = this.conversationManager.createConversation('New Chat');
                    await this.refreshWebviewSession(newConv);
                    break;
                case 'getHistoryList':
                    this.sendHistoryList();
                    break;
                case 'selectConversation':
                    const conv = this.conversationManager.setActiveConversation(data.id);
                    if (conv) {
                        await this.refreshWebviewSession(conv);
                    }
                    break;
                case 'deleteConversation':
                    const updatedList = this.conversationManager.deleteConversation(data.id);
                    this.sendHistoryList(updatedList);
                    const activeConv = this.conversationManager.getActiveConversation();
                    await this.refreshWebviewSession(activeConv);
                    break;
                case 'applyPatch':
                    await this.applyCodePatch(data.code);
                    break;
                case 'stopGeneration':
                    this.abortCurrentRequest();
                    break;
            }
        });

        // Initialize session data in webview
        const activeConv = this.conversationManager.getActiveConversation();
        this.refreshWebviewSession(activeConv);
    }

    public async refreshWebviewSession(conv = this.conversationManager.getActiveConversation()) {
        if (!this._view) return;
        const models = await this.client.listModels();
        const settings = this.getSettings();

        this._view.webview.postMessage({
            type: 'initSession',
            session: conv,
            models: models.length > 0 ? models : [
                { id: settings.chatModel, object: 'model', owned_by: 'litellm' },
                { id: settings.thinkingModel, object: 'model', owned_by: 'litellm' }
            ],
            selectedModel: settings.chatModel
        });
    }

    private sendHistoryList(list = this.conversationManager.getAllConversations()) {
        if (!this._view) return;
        this._view.webview.postMessage({
            type: 'updateHistoryList',
            conversations: list
        });
    }

    private async handleUserMessage(prompt: string, selectedModel: string) {
        const conv = this.conversationManager.getActiveConversation();

        // Add User Turn
        conv.messages.push({
            id: `msg_${Date.now()}`,
            role: 'user',
            content: prompt,
            timestamp: Date.now()
        });

        if (conv.messages.length === 1) {
            conv.title = prompt.length > 25 ? prompt.substring(0, 25) + '...' : prompt;
        }

        this.conversationManager.saveConversation(conv);

        // Summarize context if conversation exceeds 6 turns
        if (conv.messages.length > 6 && !conv.summarizedContext) {
            const summary = await this.client.summarizeContext(conv.messages.slice(0, -2), selectedModel);
            if (summary) {
                conv.summarizedContext = summary;
            }
        }

        // Prepare messages payload for API
        const payloadMessages = [];
        if (conv.summarizedContext) {
            payloadMessages.push({
                role: 'system',
                content: `Previous Conversation Summary Context:\n${conv.summarizedContext}`
            });
        }
        conv.messages.forEach(m => {
            payloadMessages.push({ role: m.role, content: m.content });
        });

        // Stream AI Response
        await this.streamChatCompletions(selectedModel, payloadMessages, conv);
    }

    private streamChatCompletions(model: string, messages: any[], conv: any): Promise<void> {
        return new Promise((resolve) => {
            const settings = this.getSettings();
            const apiBase = settings.apiBase.replace(/\/$/, '');
            const parsedUrl = new URL(`${apiBase}/chat/completions`);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const body = JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.2,
                stream: true
            });

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                }
            };

            let assistantText = '';
            let assistantThinking = '';

            const req = transport.request(options, (res) => {
                res.on('data', (chunk: Buffer) => {
                    const lines = chunk.toString().split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                const json = JSON.parse(line.substring(6));
                                const delta = json.choices[0]?.delta;
                                if (delta) {
                                    if (delta.reasoning_content) {
                                        assistantThinking += delta.reasoning_content;
                                        this._view?.webview.postMessage({
                                            type: 'streamToken',
                                            text: '',
                                            thinking: delta.reasoning_content
                                        });
                                    }
                                    if (delta.content) {
                                        assistantText += delta.content;
                                        this._view?.webview.postMessage({
                                            type: 'streamToken',
                                            text: delta.content,
                                            thinking: ''
                                        });
                                    }
                                }
                            } catch (e) {
                                // Skip non-JSON chunks
                            }
                        }
                    }
                });

                res.on('end', () => {
                    this.activeRequest = undefined;
                    this._view?.webview.postMessage({ type: 'streamEnd' });

                    conv.messages.push({
                        id: `msg_${Date.now()}`,
                        role: 'assistant',
                        content: assistantText,
                        thinking: assistantThinking || undefined,
                        model: model,
                        timestamp: Date.now()
                    });

                    this.conversationManager.saveConversation(conv);
                    resolve();
                });
            });

            req.on('error', (err) => {
                this.activeRequest = undefined;
                console.error('[PodLlama] Stream error:', err);
                this._view?.webview.postMessage({
                    type: 'streamToken',
                    text: `\n\n*Error connecting to PodLlama backend: ${err.message}*`
                });
                this._view?.webview.postMessage({ type: 'streamEnd' });
                resolve();
            });

            this.activeRequest = req;
            req.write(body);
            req.end();
        });
    }

    private async applyCodePatch(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor found to apply code patch.');
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        if (editor.selection.isEmpty) {
            edit.insert(editor.document.uri, editor.selection.active, code);
        } else {
            edit.replace(editor.document.uri, editor.selection, code);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage('PodLlama: Code patch applied successfully.');
        } else {
            vscode.window.showErrorMessage('PodLlama: Failed to apply code patch.');
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'media', 'chat.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'media', 'chat.js'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PodLlama Code</title>
    <link href="${cssUri}" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
</head>
<body>
    <div class="chat-header">
        <div class="title-group">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
                <path d="M12 6 L12.8 9.2 L16 10 L12.8 10.8 L12 14 L11.2 10.8 L8 10 L11.2 9.2 Z" fill="currentColor" stroke="none"></path>
            </svg>
            <span>PodLlama Code</span>
        </div>
        <div class="header-actions">
            <button class="icon-btn" id="new-chat-btn" title="New Conversation">+</button>
            <button class="icon-btn" id="history-btn" title="Conversation History">🕒</button>
        </div>
    </div>

    <div class="history-drawer" id="history-drawer">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Past Conversations</div>
        <ul class="history-list" id="history-list"></ul>
    </div>

    <div class="chat-messages" id="chat-messages"></div>

    <div class="input-container">
        <div class="textarea-wrapper">
            <textarea id="prompt-input" placeholder="Ask PodLlama Code... (Shift+Enter for new line)"></textarea>
            <button class="send-btn" id="send-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
            </button>
        </div>
        <div class="input-footer">
            <div class="model-select-container">
                <span class="plus-icon">+</span>
                <select class="select-control" id="model-select">
                    <option value="podllama-chat">podllama-chat</option>
                    <option value="podllama-thinking">podllama-thinking</option>
                </select>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg class="mic-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); cursor: pointer;">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
            </div>
        </div>
    </div>

    <script src="${jsUri}"></script>
</body>
</html>`;
    }
}
