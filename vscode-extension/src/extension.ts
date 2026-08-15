import * as vscode from 'vscode';
import { PodLlamaClient } from './podllama-client';
import { InlineCompletionProvider } from './inlineCompletionProvider';
import { StandardCompletionProvider } from './standardCompletionProvider';
import { ConversationManager } from './conversationManager';
import { ChatWebviewProvider } from './chatWebviewProvider';
import { DiffContentProvider } from './diffContentProvider';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('[PodLlama Code] Activating extension...');

    // Instantiate virtual document diff provider
    const diffProvider = new DiffContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            DiffContentProvider.scheme,
            diffProvider
        )
    );

    // 1. Helper function to read current VS Code Settings
    const getSettings = () => {
        const config = vscode.workspace.getConfiguration('podllama');
        return {
            apiBase: config.get<string>('apiBase', 'http://localhost:4000/v1'),
            apiKey: config.get<string>('apiKey', 'sk-local'),
            chatModel: config.get<string>('chatModel', 'podllama-chat'),
            thinkingModel: config.get<string>('thinkingModel', 'podllama-thinking'),
            instructModel: config.get<string>('instructModel', 'podllama-instruct'),
            autocompleteModel: config.get<string>('autocompleteModel', 'podllama-autocomplete'),
            enableInline: config.get<boolean>('enableInlineCompletion', true),
            enableDropdown: config.get<boolean>('enableDropdownCompletion', true),
            debounceMs: config.get<number>('debounceMs', 150),
            maxTokens: config.get<number>('maxTokens', 64),
            temperature: config.get<number>('temperature', 0.1)
        };
    };

    // 2. Initialize Core Services
    const client = new PodLlamaClient(
        () => getSettings().apiBase,
        () => getSettings().apiKey
    );

    const conversationManager = new ConversationManager(context);

    // 3. Register Antigravity IDE-style Chat Webview View
    const chatWebviewProvider = new ChatWebviewProvider(
        context.extensionUri,
        conversationManager,
        client,
        () => ({
            apiBase: getSettings().apiBase,
            apiKey: getSettings().apiKey,
            chatModel: getSettings().chatModel,
            thinkingModel: getSettings().thinkingModel
        }),
        diffProvider
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatWebviewProvider.viewType,
            chatWebviewProvider
        )
    );

    // 4. Register Inline Ghost Text Autocomplete Provider (Supports all programming & config languages)
    const inlineProvider = new InlineCompletionProvider(client, () => ({
        enableInline: getSettings().enableInline,
        model: getSettings().autocompleteModel,
        debounceMs: getSettings().debounceMs,
        maxTokens: getSettings().maxTokens,
        temperature: getSettings().temperature
    }));

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**/*' },
            inlineProvider
        )
    );

    // 5. Register Standard Drop-Down Completion Provider
    const standardProvider = new StandardCompletionProvider(client, () => ({
        enableDropdown: getSettings().enableDropdown,
        model: getSettings().autocompleteModel,
        maxTokens: getSettings().maxTokens,
        temperature: getSettings().temperature
    }));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { pattern: '**/*' },
            standardProvider,
            '.'
        )
    );

    // 6. Bottom Panel Status Bar Control (Toggle Enable/Disable)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'podllama.toggleAutocomplete';
    context.subscriptions.push(statusBarItem);
    updateStatusBar(getSettings().enableInline || getSettings().enableDropdown);

    // 7. Command Registrations
    context.subscriptions.push(
        vscode.commands.registerCommand('podllama.toggleAutocomplete', async () => {
            const config = vscode.workspace.getConfiguration('podllama');
            const currentInline = config.get<boolean>('enableInlineCompletion', true);
            const newValue = !currentInline;

            await config.update('enableInlineCompletion', newValue, vscode.ConfigurationTarget.Global);
            await config.update('enableDropdownCompletion', newValue, vscode.ConfigurationTarget.Global);

            updateStatusBar(newValue);
            vscode.window.showInformationMessage(
                `PodLlama Autocomplete: ${newValue ? 'Enabled' : 'Disabled'}`
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('podllama.resetSettings', async () => {
            const config = vscode.workspace.getConfiguration('podllama');
            await config.update('apiBase', undefined, vscode.ConfigurationTarget.Global);
            await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
            await config.update('chatModel', undefined, vscode.ConfigurationTarget.Global);
            await config.update('thinkingModel', undefined, vscode.ConfigurationTarget.Global);
            await config.update('autocompleteModel', undefined, vscode.ConfigurationTarget.Global);
            await config.update('enableInlineCompletion', undefined, vscode.ConfigurationTarget.Global);
            await config.update('enableDropdownCompletion', undefined, vscode.ConfigurationTarget.Global);
            await config.update('debounceMs', undefined, vscode.ConfigurationTarget.Global);
            await config.update('maxTokens', undefined, vscode.ConfigurationTarget.Global);
            await config.update('temperature', undefined, vscode.ConfigurationTarget.Global);

            updateStatusBar(true);
            chatWebviewProvider.refreshWebviewSession();
            vscode.window.showInformationMessage('PodLlama Code: Settings reset to default values.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('podllama.newConversation', () => {
            const newConv = conversationManager.createConversation('New Chat');
            chatWebviewProvider.refreshWebviewSession(newConv);
        })
    );

    // Context Menu selection commands forwarding editor blocks to Chat
    const getActiveEditorSelection = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor found.');
            return undefined;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('Please select some code first.');
            return undefined;
        }
        const codeText = editor.document.getText(selection);
        return { code: codeText, path: editor.document.fileName };
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('podllama.sendToChat', () => {
            const contextData = getActiveEditorSelection();
            if (contextData) {
                chatWebviewProvider.injectCodeSelection(contextData.code, contextData.path);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('podllama.setStatusBarLoading', (loading: boolean) => {
            if (loading) {
                statusBarItem.text = '$(sync~spin) PodLlama: Thinking...';
                statusBarItem.color = '#facc15'; // yellow color during generation
            } else {
                updateStatusBar(getSettings().enableInline || getSettings().enableDropdown);
            }
        })
    );

    // 8. Listen to Configuration Changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('podllama')) {
                const settings = getSettings();
                updateStatusBar(settings.enableInline || settings.enableDropdown);
                chatWebviewProvider.refreshWebviewSession();
            }
        })
    );

    // 9. Periodic Model Polling (`GET /v1/models`)
    const modelPollInterval = setInterval(async () => {
        const models = await client.listModels();
        if (models.length > 0) {
            chatWebviewProvider.refreshWebviewSession();
        }
    }, 30000);

    context.subscriptions.push({
        dispose: () => clearInterval(modelPollInterval)
    });
}

function updateStatusBar(enabled: boolean) {
    if (enabled) {
        statusBarItem.text = '$(sparkle) PodLlama: Active';
        statusBarItem.tooltip = 'PodLlama Code Autocomplete is Enabled (Click to Disable)';
        statusBarItem.color = '#38bdf8';
    } else {
        statusBarItem.text = '$(circle-slash) PodLlama: Disabled';
        statusBarItem.tooltip = 'PodLlama Code Autocomplete is Disabled (Click to Enable)';
        statusBarItem.color = '#888888';
    }
    statusBarItem.show();
}

export function deactivate() {}
