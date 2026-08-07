import * as vscode from 'vscode';
import { PodLlamaClient } from '../api/podllamaClient';

export class PodLlamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(private client: PodLlamaClient) {}

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    const config = vscode.workspace.getConfiguration('podllama');
    const enabled = config.get<boolean>('enableAutocomplete', true);

    if (!enabled) {
      return undefined;
    }

    const debounceMs = config.get<number>('autocompleteDebounceMs', 150);

    if (debounceMs > 0) {
      await new Promise<void>((resolve) => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => resolve(), debounceMs);
      });
    }

    if (token.isCancellationRequested) {
      return undefined;
    }

    // Extract prefix (preceding cursor) and suffix (following cursor)
    const fullText = document.getText();
    const offset = document.offsetAt(position);

    const maxPrefixLen = 2048;
    const maxSuffixLen = 1024;

    const rawPrefix = fullText.substring(Math.max(0, offset - maxPrefixLen), offset);
    const rawSuffix = fullText.substring(offset, Math.min(fullText.length, offset + maxSuffixLen));

    // Construct Qwen FIM prompt (Fill-In-Middle)
    const fimPrompt = `<|fim_prefix|>${rawPrefix}<|fim_suffix|>${rawSuffix}<|fim_middle|>`;

    try {
      const autocompleteModel = config.get<string>('autocompleteModel', 'podllama-autocomplete');
      const completionText = await this.client.completeText({
        model: autocompleteModel,
        prompt: fimPrompt,
        max_tokens: config.get<number>('autocompleteMaxTokens', 128),
        temperature: config.get<number>('temperature', 0.2),
        stop: [
          '<|fim_prefix|>',
          '<|fim_suffix|>',
          '<|fim_middle|>',
          '<|endoftext|>',
          '<|file_separator|>',
          '<EOT>',
          '<end_of_turn>',
          '\n\n',
        ],
      });

      if (token.isCancellationRequested || !completionText) {
        return undefined;
      }

      // Clean up raw completion text & strip prefix/suffix echoes
      const cleanedText = this.postProcessFimCompletion(completionText, rawPrefix, rawSuffix);

      if (!cleanedText || cleanedText.trim().length === 0) {
        return undefined;
      }

      const item = new vscode.InlineCompletionItem(
        cleanedText,
        new vscode.Range(position, position)
      );

      return [item];
    } catch (error) {
      // Quietly ignore completion network errors to avoid interrupting typing flow
      return undefined;
    }
  }

  private postProcessFimCompletion(
    rawText: string,
    prefix: string,
    suffix: string
  ): string {
    let cleaned = rawText
      .replace(/<\|fim_prefix\|>/g, '')
      .replace(/<\|fim_suffix\|>/g, '')
      .replace(/<\|fim_middle\|>/g, '')
      .replace(/<\|endoftext\|>/g, '')
      .replace(/<\|file_separator\|>/g, '')
      .replace(/<EOT>/g, '')
      .replace(/<end_of_turn>/g, '');

    // 1. If completion repeats line prefix already typed, strip it
    const linePrefix = prefix.split('\n').pop() || '';
    if (linePrefix && cleaned.startsWith(linePrefix)) {
      cleaned = cleaned.substring(linePrefix.length);
    }

    // 2. Strip trailing prefix overlap
    const checkLen = Math.min(prefix.length, 60);
    for (let len = checkLen; len >= 3; len--) {
      const tail = prefix.substring(prefix.length - len);
      if (cleaned.startsWith(tail)) {
        cleaned = cleaned.substring(tail.length);
        break;
      }
    }

    // 3. Strip leading suffix overlap to avoid duplication
    if (suffix) {
      const firstSuffixLine = suffix.split('\n')[0].trim();
      if (firstSuffixLine && cleaned.endsWith(firstSuffixLine)) {
        cleaned = cleaned.substring(0, cleaned.length - firstSuffixLine.length);
      }
    }

    return cleaned;
  }
}
