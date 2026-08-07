import * as vscode from 'vscode';
import { ChatMessage, PodLlamaClient } from '../api/podllamaClient';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  client: PodLlamaClient
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    streamResponse: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> => {
    const config = vscode.workspace.getConfiguration('podllama');
    let targetModel = config.get<string>('chatModel', 'podllama-chat');
    let systemInstruction = config.get<string>(
      'systemPrompt',
      'You are PodLlama, an autonomous local AI coding agent running on GPU-accelerated local hardware. Assist the user with precise code modifications, architectural guidance, and debugging.'
    );

    // Check subcommand logic
    switch (request.command) {
      case 'explain':
        systemInstruction =
          'You are PodLlama. Explain the provided code clearly and concisely, focusing on architecture, edge cases, and functionality.';
        break;
      case 'refactor':
        systemInstruction =
          'You are PodLlama. Refactor the provided code to improve performance, readability, type safety, and clean code principles. Provide clean code blocks with clear inline comments.';
        break;
      case 'fix':
        systemInstruction =
          'You are PodLlama. Analyze the current file and diagnostics for bugs, syntax errors, or logical issues. Provide corrected code solutions with clear explanations.';
        break;
      case 'test':
        systemInstruction =
          'You are PodLlama. Write comprehensive unit tests for the provided code. Use standard test frameworks suitable for the language.';
        break;
      case 'think':
        targetModel = config.get<string>('thinkingModel', 'podllama-thinking');
        systemInstruction =
          'You are PodLlama Thinking (DeepSeek-R1 Distilled). Perform step-by-step deep reasoning and logic analysis to answer the user query thoroughly.';
        break;
    }

    // Build message array from conversation history + active request
    const messages: ChatMessage[] = [
      { role: 'system', content: systemInstruction },
    ];

    // Process native VS Code chat references (#file, #selection, #diagnostics, etc.)
    let referenceContext = '';
    if (request.references && request.references.length > 0) {
      for (const ref of request.references) {
        if (ref.value instanceof vscode.Uri) {
          try {
            const doc = await vscode.workspace.openTextDocument(ref.value);
            const content = doc.getText();
            referenceContext += `\n\n[Attached File Reference: ${ref.value.fsPath} (${doc.languageId})]:\n\`\`\`${doc.languageId}\n${content.length > 8000 ? content.substring(0, 8000) + '\n... [truncated]' : content}\n\`\`\``;
          } catch {
            // ignore non-text files
          }
        } else if (ref.value instanceof vscode.Location) {
          try {
            const doc = await vscode.workspace.openTextDocument(ref.value.uri);
            const text = doc.getText(ref.value.range);
            referenceContext += `\n\n[Attached Location Reference: ${ref.value.uri.fsPath} L${ref.value.range.start.line + 1}-L${ref.value.range.end.line + 1}]:\n\`\`\`${doc.languageId}\n${text}\n\`\`\``;
          } catch {
            // ignore
          }
        } else if (typeof ref.value === 'string') {
          referenceContext += `\n\n[Attached Reference Context]: ${ref.value}`;
        }
      }
    }

    // Grab active text editor context if available and no explicit references provided
    const activeEditor = vscode.window.activeTextEditor;
    let editorContext = '';
    if (activeEditor) {
      const selection = activeEditor.selection;
      const selectedText = activeEditor.document.getText(selection);
      const filePath = activeEditor.document.uri.fsPath;
      const lang = activeEditor.document.languageId;

      if (selectedText.trim()) {
        editorContext = `\n\n[Active Selection from ${filePath} (${lang})]:\n\`\`\`${lang}\n${selectedText}\n\`\`\``;
      } else if (!referenceContext) {
        const fullText = activeEditor.document.getText();
        if (fullText.length < 4000) {
          editorContext = `\n\n[Active File Context from ${filePath} (${lang})]:\n\`\`\`${lang}\n${fullText}\n\`\`\``;
        }
      }
    }

    // Include diagnostic context if running /fix command
    if (request.command === 'fix' && activeEditor) {
      const diagnostics = vscode.languages.getDiagnostics(activeEditor.document.uri);
      if (diagnostics.length > 0) {
        const diagStr = diagnostics
          .map(
            (d) =>
              `Line ${d.range.start.line + 1}: [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}`
          )
          .join('\n');
        editorContext += `\n\n[Current File Diagnostics / Errors]:\n${diagStr}`;
      }
    }

    // Append prior chat history turns
    for (const turn of chatContext.history) {
      if ('prompt' in turn) {
        messages.push({ role: 'user', content: (turn as any).prompt });
      } else if ('response' in turn) {
        let textContent = '';
        for (const part of (turn as any).response) {
          if (part instanceof vscode.ChatResponseMarkdownPart) {
            textContent += part.value.value;
          }
        }
        if (textContent) {
          messages.push({ role: 'assistant', content: textContent });
        }
      }
    }

    // Append current prompt + references + editor context
    const finalPrompt = request.prompt + referenceContext + editorContext;
    messages.push({ role: 'user', content: finalPrompt });

    streamResponse.progress(`Querying PodLlama local model (${targetModel})...`);

    try {
      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      let fullGeneratedText = '';

      await client.streamChatCompletion(
        {
          model: targetModel,
          messages,
          temperature: config.get<number>('temperature', 0.2),
        },
        (chunk) => {
          fullGeneratedText += chunk;
          streamResponse.markdown(chunk);
        },
        abortController.signal
      );

      // Offer quick action button to check health or switch models if response completed
      if (fullGeneratedText.includes('```') && activeEditor) {
        streamResponse.button({
          command: 'podllama.checkHealth',
          title: vscode.l10n.t('Check PodLlama Status'),
        });
      }

      return { metadata: { command: request.command, model: targetModel } };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown network error connecting to PodLlama proxy.';
      streamResponse.markdown(
        `\n\n> [!ERROR]\n> **PodLlama Service Failure**: ${errorMsg}\n> Ensure PodLlama service is active (\`make service-up\`).`
      );
      return { metadata: { error: errorMsg } };
    }
  };

  if (typeof (vscode as any).chat?.createChatParticipant !== 'function') {
    throw new Error('VS Code chat participant API is not available in this environment.');
  }

  const participant = (vscode as any).chat.createChatParticipant('podllama.chat', handler);
  participant.iconPath = new vscode.ThemeIcon('server-environment');
  return participant;
}
