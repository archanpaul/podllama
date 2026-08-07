import * as vscode from 'vscode';
import { ChatMessage, PodLlamaClient } from '../api/podllamaClient';

export class PodLlamaLanguageModelProvider {
  constructor(private client: PodLlamaClient) {}

  public register(context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Check if VS Code lm provider registration API is available
    if (typeof (vscode.lm as any).registerLanguageModelChatProvider === 'function') {
      const vendorIds = ['podllama', 'customendpoint'];

      for (const vendorId of vendorIds) {
        try {
          const providerDisposable = (vscode.lm as any).registerLanguageModelChatProvider(
            vendorId,
            {
              provideLanguageModelResponse: async (
                modelId: string,
                messages: any[],
                options: any,
                extensionId: string,
                progress: vscode.Progress<any>,
                token: vscode.CancellationToken
              ) => {
                const formattedMessages: ChatMessage[] = [];

                for (const msg of messages) {
                  let role: 'system' | 'user' | 'assistant' = 'user';
                  if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
                    role = 'assistant';
                  } else if (msg.role === vscode.LanguageModelChatMessageRole.User) {
                    role = 'user';
                  }

                  let text = '';
                  if (typeof msg.content === 'string') {
                    text = msg.content;
                  } else if (Array.isArray(msg.content)) {
                    text = msg.content
                      .map((part: any) => (typeof part.value === 'string' ? part.value : part.text || ''))
                      .join('');
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
                    temperature: this.client.currentConfig.temperature,
                  },
                  (chunk) => {
                    progress.report({
                      index: 0,
                      part: new (vscode as any).LanguageModelTextPart(chunk),
                    });
                  },
                  abortController.signal
                );
              },
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
}
