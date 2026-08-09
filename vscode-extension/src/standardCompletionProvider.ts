import * as vscode from 'vscode';
import { PodLlamaClient } from './podllama-client';

export class StandardCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private client: PodLlamaClient,
        private getSettings: () => {
            enableDropdown: boolean;
            model: string;
            maxTokens: number;
            temperature: number;
        }
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        const settings = this.getSettings();
        if (!settings.enableDropdown) {
            return [];
        }

        const lineText = document.lineAt(position.line).text.substring(0, position.character);
        if (lineText.trim().length === 0) {
            return [];
        }

        const fimPrompt = `<|fim_prefix|>${lineText}<|fim_suffix|><|fim_middle|>`;
        const suggestion = await this.client.getCompletion({
            model: settings.model,
            prompt: fimPrompt,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature
        });

        if (!suggestion || token.isCancellationRequested) {
            return [];
        }

        const item = new vscode.CompletionItem(suggestion.trim().split('\n')[0]);
        item.kind = vscode.CompletionItemKind.Snippet;
        item.insertText = suggestion;
        item.detail = 'PodLlama Code Completion';

        return [item];
    }
}
