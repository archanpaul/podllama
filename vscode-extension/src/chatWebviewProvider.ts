import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ConversationManager } from './conversationManager';
import { PodLlamaClient } from './podllama-client';
import { DiffContentProvider } from './diffContentProvider';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'podllama.chatView';
    private _view?: vscode.WebviewView;
    private activeRequest: http.ClientRequest | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private conversationManager: ConversationManager,
        private client: PodLlamaClient,
        private getSettings: () => { apiBase: string; apiKey: string; chatModel: string; thinkingModel: string },
        private diffProvider: DiffContentProvider
    ) { }

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
                case 'addContextAttachment':
                    await this.handleAddContextAttachment();
                    break;
                case 'renameConversation':
                    const currentConv = this.conversationManager.getActiveConversation();
                    currentConv.title = data.title;
                    this.conversationManager.saveConversation(currentConv);
                    this.sendHistoryList();
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

            // Send an empty token immediately to show the "Thinking..." placeholder in the UI while connecting
            this._view?.webview.postMessage({
                type: 'streamToken',
                text: '',
                thinking: ''
            });

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

        const document = editor.document;
        const selection = editor.selection;

        // Apply edit directly inline inside the active editor
        const edit = new vscode.WorkspaceEdit();
        if (selection.isEmpty) {
            edit.insert(document.uri, selection.active, code);
        } else {
            edit.replace(document.uri, selection, code);
        }

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            // Trigger native accept/reject overlay for the changes
            vscode.commands.executeCommand('editor.action.dirtydiff.next');
            
            const accept = 'Accept Changes';
            const reject = 'Reject Changes';
            const action = await vscode.window.showInformationMessage(
                'Proposed changes applied. Would you like to keep them?',
                accept,
                reject
            );

            if (action === reject) {
                // Revert changes by executing undo command
                await vscode.commands.executeCommand('undo');
                vscode.window.showInformationMessage('Changes rejected and reverted.');
            } else if (action === accept) {
                // Keep changes by saving the document
                await document.save();
                vscode.window.showInformationMessage('Changes accepted and saved.');
            }
        } else {
            vscode.window.showErrorMessage('Failed to apply proposed code changes.');
        }
    }

    private async handleAddContextAttachment() {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Add to context',
            filters: {
                'Code / Text Files': ['ts', 'js', 'py', 'json', 'yaml', 'yml', 'md', 'txt', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'html', 'css', 'sh']
            }
        });

        if (fileUris && fileUris.length > 0) {
            try {
                const doc = await vscode.workspace.openTextDocument(fileUris[0]);
                const content = doc.getText();
                const relativePath = vscode.workspace.asRelativePath(fileUris[0]);

                // Post message to webview containing code block to append
                const contextStr = `\n\n[Context: ${relativePath}]\n\`\`\`\n${content}\n\`\`\`\n`;
                this._view?.webview.postMessage({
                    type: 'streamToken',
                    text: '',
                    thinking: '',
                    appendInput: contextStr
                });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to read file context: ${err.message}`);
            }
        }
    }

    public injectCodeSelection(code: string, filepath: string, instruction?: string) {
        if (!this._view) {
            // Reveal chat view if hidden
            vscode.commands.executeCommand('workbench.view.extension.podllama-activitybar');
        }

        const relativePath = vscode.workspace.asRelativePath(filepath);
        let injectedVal = ``;
        if (instruction) {
            injectedVal += `${instruction}\n`;
        }
        injectedVal += `\n[Context Selection: ${relativePath}]\n\`\`\`\n${code}\n\`\`\`\n`;

        this._view?.webview.postMessage({
            type: 'streamToken',
            text: '',
            thinking: '',
            appendInput: injectedVal
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'media', 'chat.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'media', 'chat.js'));
        const fontAwesomeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'media', 'font-awesome', 'css', 'all.min.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PodLlama Code</title>
    <link href="${fontAwesomeUri}" rel="stylesheet">
    <link href="${cssUri}" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
</head>
<body>
    <div class="chat-header">
        <div class="title-group">
            <i class="fa-solid fa-laptop-code" style="font-size: 14px; color: var(--accent); flex-shrink:0;"></i>
            <input type="text" class="chat-title-input" id="chat-title-input" value="PodLlama Code" title="Click to rename conversation" />
        </div>
        <div class="header-actions">
            <button class="icon-btn" id="new-chat-btn" title="New Conversation"><i class="fa-solid fa-plus"></i></button>
            <button class="icon-btn" id="history-btn" title="Conversation History"><i class="fa-solid fa-clock-rotate-left"></i></button>
        </div>
    </div>

    <div class="history-drawer" id="history-drawer">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Past Conversations</div>
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
                <div class="model-select-container">
                    <select class="select-control" id="model-select">
                        <option value="podllama-chat">podllama-chat</option>
                        <option value="podllama-thinking">podllama-thinking</option>
                    </select>
                </div>
            </div>
            <button class="send-btn" id="send-btn" title="Send Message">
                <i class="fa-solid fa-circle-play" style="font-size: 14px;"></i>
            </button>
        </div>
    </div>

    <script src="${jsUri}"></script>
</body>
</html>`;
    }
}
