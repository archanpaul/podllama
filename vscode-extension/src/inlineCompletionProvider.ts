import * as vscode from 'vscode';
import { PodLlamaClient } from './podllama-client';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(
        private client: PodLlamaClient,
        private getSettings: () => {
            enableInline: boolean;
            model: string;
            debounceMs: number;
            maxTokens: number;
            temperature: number;
        }
    ) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[]> {
        const settings = this.getSettings();
        if (!settings.enableInline) {
            return [];
        }

        // Wait for debounce delay
        if (settings.debounceMs > 0) {
            await new Promise<void>((resolve) => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => resolve(), settings.debounceMs);
            });
        }

        if (token.isCancellationRequested) {
            return [];
        }

        // Calculate Prefix (text before cursor) and Suffix (text after cursor)
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const suffix = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));

        // Format FIM prompt for PodLlama (Qwen Coder FIM tags)
        const fimPrompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

        const completionText = await this.client.getCompletion({
            model: settings.model,
            prompt: fimPrompt,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature
        });

        if (token.isCancellationRequested || !completionText) {
            return [];
        }

        const item = new vscode.InlineCompletionItem(
            completionText,
            new vscode.Range(position, position)
        );

        return [item];
    }
}
