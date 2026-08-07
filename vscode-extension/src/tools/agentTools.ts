import * as vscode from 'vscode';
import { PodLlamaClient } from '../api/podllamaClient';

export function registerAgentTools(
  context: vscode.ExtensionContext,
  client: PodLlamaClient
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Tool 1: Workspace Diagnostics
  disposables.push(
    vscode.lm.registerTool('podllama_get_workspace_diagnostics', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const diagnosticsMap: Array<{ file: string; diagnostics: string[] }> = [];
        const allDiags = vscode.languages.getDiagnostics();

        for (const [uri, diags] of allDiags) {
          if (diags.length === 0) continue;
          const formatted = diags.map(
            (d) => `Line ${d.range.start.line + 1}: [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}`
          );
          diagnosticsMap.push({
            file: uri.fsPath,
            diagnostics: formatted,
          });
        }

        const resultJson = JSON.stringify(diagnosticsMap, null, 2);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultJson),
        ]);
      },
    })
  );

  // Tool 2: Read Active Editor Context
  disposables.push(
    vscode.lm.registerTool('podllama_read_active_editor', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({ error: 'No active editor found' })),
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
          content: selectedText || doc.getText(),
        };

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(data, null, 2)),
        ]);
      },
    })
  );

  // Tool 3: Container Status Telemetry
  disposables.push(
    vscode.lm.registerTool('podllama_container_status', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<any>,
        token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const isHealthy = await client.checkHealth();
        let models: string[] = [];
        let error: string | undefined;

        if (isHealthy) {
          try {
            models = await client.listModels();
          } catch (e: any) {
            error = e.message;
          }
        }

        const statusData = {
          apiBase: client.currentConfig.apiBase,
          status: isHealthy ? 'healthy' : 'offline',
          models,
          error,
        };

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(JSON.stringify(statusData, null, 2)),
        ]);
      },
    })
  );

  // Tool 4: Switch Active Backend Model
  disposables.push(
    vscode.lm.registerTool('podllama_switch_model', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ model: string }>,
        token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const targetModel = options.input.model;
        if (!targetModel) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({ error: 'Missing required "model" parameter' })),
          ]);
        }

        try {
          // Trigger a dummy ping request to force backend chat_swapper to load target model
          await client.chatCompletion({
            model: targetModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          });

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              JSON.stringify({ success: true, message: `Successfully loaded model ${targetModel}` })
            ),
          ]);
        } catch (e: any) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              JSON.stringify({ success: false, error: e.message || 'Model swap failed' })
            ),
          ]);
        }
      },
    })
  );

  return disposables;
}
