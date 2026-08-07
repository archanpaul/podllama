import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PodLlamaClient, PodLlamaConfig } from './api/podllamaClient';
import { PodLlamaInlineCompletionProvider } from './completion/inlineCompletionProvider';
import { registerChatParticipant } from './chat/chatParticipant';
import { registerAgentTools } from './tools/agentTools';
import { PodLlamaStatusBarManager } from './ui/statusBar';
import { PodLlamaLanguageModelProvider } from './provider/languageModelProvider';

let podllamaClient: PodLlamaClient;
let statusBarManager: PodLlamaStatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating PodLlama VS Code Extension...');

  // Initialize Local Endpoints & Model Providers on First Install / Activation
  initializeLocalEndpoints(context);

  // Initialize Client Config
  const config = getClientConfig();
  podllamaClient = new PodLlamaClient(config);

  // 1. Register Inline Code Autocomplete Provider
  const inlineProvider = new PodLlamaInlineCompletionProvider(podllamaClient);
  const inlineDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider
  );
  context.subscriptions.push(inlineDisposable);

  // 2. Register Native @podllama Chat Participant
  const chatParticipant = registerChatParticipant(context, podllamaClient);
  context.subscriptions.push(chatParticipant);

  // 3. Register Language Model Tools
  const toolDisposables = registerAgentTools(context, podllamaClient);
  context.subscriptions.push(...toolDisposables);

  // 4. Register Native Language Model Chat Provider
  const lmProvider = new PodLlamaLanguageModelProvider(podllamaClient);
  const lmDisposables = lmProvider.register(context);
  context.subscriptions.push(...lmDisposables);

  // 5. Initialize Status Bar Manager
  statusBarManager = new PodLlamaStatusBarManager(podllamaClient);
  context.subscriptions.push(statusBarManager);

  // 6. Register Extension Commands
  registerExtensionCommands(context);

  // 7. Listen for Configuration Updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('podllama')) {
        const newConfig = getClientConfig();
        podllamaClient.updateConfig(newConfig);
        statusBarManager.updateStatus();
      }
    })
  );

  console.log('PodLlama VS Code Extension successfully activated.');
}

export function deactivate() {
  if (statusBarManager) {
    statusBarManager.dispose();
  }
}

function getPodLlamaModelProviderDef(apiKey: string) {
  return {
    name: 'Podllama',
    vendor: 'customendpoint',
    apiKey: apiKey || 'sk-local',
    apiType: 'chat-completions',
    models: [
      {
        id: 'podllama-chat',
        name: 'PodLlama Chat (Qwen 2.5 Coder 7B)',
        url: 'http://localhost:4000/v1/chat/completions',
        toolCalling: true,
        vision: false,
        maxInputTokens: 16384,
        maxOutputTokens: 4096,
      },
      {
        id: 'podllama-thinking',
        name: 'PodLlama Thinking (DeepSeek-R1 Distill 7B/14B)',
        url: 'http://localhost:4000/v1/chat/completions',
        toolCalling: true,
        vision: false,
        maxInputTokens: 16384,
        maxOutputTokens: 4096,
      },
      {
        id: 'podllama-autocomplete',
        name: 'PodLlama Autocomplete (Qwen 2.5 Coder 0.5B)',
        url: 'http://localhost:4000/v1/completions',
        toolCalling: false,
        vision: false,
        maxInputTokens: 4096,
        maxOutputTokens: 512,
      },
    ],
  };
}

function syncModelProvidersToDisk(podllamaEndpointDef: any) {
  const home = os.homedir();
  const settingsPaths = [
    path.join(home, '.config', 'Code', 'User', 'settings.json'),
    path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
    path.join(home, '.config', 'VSCodium', 'User', 'settings.json'),
    path.join(home, '.config', 'Cursor', 'User', 'settings.json'),
    path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
    path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json'),
    path.join(process.env.APPDATA || '', 'Cursor', 'User', 'settings.json'),
  ];

  for (const sPath of settingsPaths) {
    if (fs.existsSync(sPath)) {
      try {
        const raw = fs.readFileSync(sPath, 'utf8');
        let cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
        const json = JSON.parse(cleaned);

        let customEndpoints = json['github.copilot.chat.customEndpoints'] || json['chat.customEndpoints'] || [];
        if (!Array.isArray(customEndpoints)) {
          customEndpoints = [];
        }

        const hasPodllama = customEndpoints.some(
          (e: any) => e && (e.name === 'Podllama' || e.name === 'PodLlama')
        );

        if (!hasPodllama) {
          customEndpoints.push(podllamaEndpointDef);
          json['github.copilot.chat.customEndpoints'] = customEndpoints;
          json['chat.customEndpoints'] = customEndpoints;
        }

        // Populate Agent dropdown menu settings (chat.agent.providers & customProviders)
        let agentProviders = json['chat.agent.providers'] || json['chat.agent.customProviders'] || [];
        if (!Array.isArray(agentProviders)) {
          agentProviders = [];
        }
        if (!agentProviders.some((p: any) => (typeof p === 'string' && p === 'PodLlama') || p?.name === 'PodLlama')) {
          agentProviders.push({
            id: 'podllama',
            name: 'PodLlama',
            provider: 'customendpoint',
            url: 'http://localhost:4000/v1',
          });
          json['chat.agent.providers'] = agentProviders;
          json['chat.agent.customProviders'] = agentProviders;
        }

        fs.writeFileSync(sPath, JSON.stringify(json, null, 2), 'utf8');
        console.log(`PodLlama Model Provider & Agent dropdown synced to ${sPath}`);
      } catch {
        // ignore parse errors
      }
    }
  }
}

async function initializeLocalEndpoints(context: vscode.ExtensionContext) {
  const isInitialized = context.globalState.get<boolean>('podllamaInitialized', false);

  const cfg = vscode.workspace.getConfiguration('podllama');
  const targetApiBase = cfg.get<string>('apiBase', 'http://localhost:4000/v1');
  const targetApiKey = cfg.get<string>('apiKey', 'sk-local');

  // Ensure default configuration values are populated
  if (!cfg.get('apiBase')) {
    await cfg.update('apiBase', 'http://localhost:4000/v1', vscode.ConfigurationTarget.Global);
  }
  if (!cfg.get('apiKey')) {
    await cfg.update('apiKey', 'sk-local', vscode.ConfigurationTarget.Global);
  }
  if (!cfg.get('chatModel')) {
    await cfg.update('chatModel', 'podllama-chat', vscode.ConfigurationTarget.Global);
  }
  if (!cfg.get('thinkingModel')) {
    await cfg.update('thinkingModel', 'podllama-thinking', vscode.ConfigurationTarget.Global);
  }
  if (!cfg.get('autocompleteModel')) {
    await cfg.update('autocompleteModel', 'podllama-autocomplete', vscode.ConfigurationTarget.Global);
  }

  const podllamaEndpointDef = getPodLlamaModelProviderDef(targetApiKey);

  // 1. Sync Model Provider JSON directly to user settings.json files on disk
  syncModelProvidersToDisk(podllamaEndpointDef);

  // 2. Sync Model Provider JSON via VS Code Workspace API
  try {
    const copilotCfg = vscode.workspace.getConfiguration('github.copilot.chat');
    const existingCustom = copilotCfg.get<any[]>('customEndpoints') || [];
    const hasPodllama = existingCustom.some((e: any) => e && (e.name === 'Podllama' || e.name === 'PodLlama'));

    if (!hasPodllama) {
      const updated = [...existingCustom, podllamaEndpointDef];
      await copilotCfg.update('customEndpoints', updated, vscode.ConfigurationTarget.Global);
    }
  } catch (err) {
    // Non-fatal
  }

  // 3. Sync Continue extension config if ~/.continue/ directory exists
  try {
    const continueDir = path.join(os.homedir(), '.continue');
    if (fs.existsSync(continueDir)) {
      const continueJsonPath = path.join(continueDir, 'config.json');
      if (fs.existsSync(continueJsonPath)) {
        const content = fs.readFileSync(continueJsonPath, 'utf8');
        const json = JSON.parse(content);
        json.models = json.models || [];
        const hasPodLlama = json.models.some((m: any) => m.model === 'podllama-chat' || m.apiBase?.includes('4000'));

        if (!hasPodLlama) {
          json.models.push({
            title: 'PodLlama Chat (Local Vulkan)',
            provider: 'openai',
            model: 'podllama-chat',
            apiBase: 'http://localhost:4000/v1',
            apiKey: 'sk-local',
          });
          json.models.push({
            title: 'PodLlama Thinking (Local Vulkan)',
            provider: 'openai',
            model: 'podllama-thinking',
            apiBase: 'http://localhost:4000/v1',
            apiKey: 'sk-local',
          });
          json.tabAutocompleteModel = json.tabAutocompleteModel || {
            title: 'PodLlama Autocomplete (Local Vulkan)',
            provider: 'openai',
            model: 'podllama-autocomplete',
            apiBase: 'http://localhost:4000/v1',
            apiKey: 'sk-local',
          };
          fs.writeFileSync(continueJsonPath, JSON.stringify(json, null, 2), 'utf8');
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }

  if (!isInitialized) {
    await context.globalState.update('podllamaInitialized', true);
    vscode.window.showInformationMessage(
      `PodLlama Model Provider configured at ${targetApiBase}!`,
      'Check Health',
      'Select Model'
    ).then((choice) => {
      if (choice === 'Check Health') {
        vscode.commands.executeCommand('podllama.checkHealth');
      } else if (choice === 'Select Model') {
        vscode.commands.executeCommand('podllama.selectModel');
      }
    });
  }
}

function getClientConfig(): PodLlamaConfig {
  const cfg = vscode.workspace.getConfiguration('podllama');
  return {
    apiBase: cfg.get<string>('apiBase', 'http://localhost:4000/v1'),
    apiKey: cfg.get<string>('apiKey', 'sk-local'),
    chatModel: cfg.get<string>('chatModel', 'podllama-chat'),
    thinkingModel: cfg.get<string>('thinkingModel', 'podllama-thinking'),
    autocompleteModel: cfg.get<string>('autocompleteModel', 'podllama-autocomplete'),
    temperature: cfg.get<number>('temperature', 0.2),
    autocompleteMaxTokens: cfg.get<number>('autocompleteMaxTokens', 128),
  };
}

function registerExtensionCommands(context: vscode.ExtensionContext) {
  // Command: Open PodLlama Settings
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:podllama.podllama-vscode');
    })
  );

  // Command: Register Model Provider in Settings
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.installCustomEndpoints', async () => {
      const cfg = vscode.workspace.getConfiguration('podllama');
      const apiKey = cfg.get<string>('apiKey', 'sk-local');
      const podllamaEndpointDef = getPodLlamaModelProviderDef(apiKey);

      syncModelProvidersToDisk(podllamaEndpointDef);

      try {
        const copilotCfg = vscode.workspace.getConfiguration('github.copilot.chat');
        const existing = copilotCfg.get<any[]>('customEndpoints') || [];
        if (!existing.some((e: any) => e && (e.name === 'Podllama' || e.name === 'PodLlama'))) {
          await copilotCfg.update('customEndpoints', [...existing, podllamaEndpointDef], vscode.ConfigurationTarget.Global);
        }
      } catch {}

      vscode.window.showInformationMessage('PodLlama Model Provider successfully registered in VS Code settings!');
    })
  );

  // Command: Check Backend Health
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.checkHealth', async () => {
      const isHealthy = await podllamaClient.checkHealth();
      if (isHealthy) {
        try {
          const models = await podllamaClient.listModels();
          vscode.window.showInformationMessage(
            `PodLlama Service Online! Active Models: ${models.join(', ')}`
          );
        } catch (e: any) {
          vscode.window.showInformationMessage(`PodLlama Service Online!`);
        }
      } else {
        vscode.window.showErrorMessage(
          `PodLlama Service Offline (${podllamaClient.currentConfig.apiBase}). Run 'make service-up' to start local container stack.`
        );
      }
      statusBarManager.updateStatus();
    })
  );

  // Command: Select Active Chat/Thinking Model
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.selectModel', async () => {
      let models: string[] = ['podllama-chat', 'podllama-thinking', 'podllama-autocomplete'];
      try {
        const fetched = await podllamaClient.listModels();
        if (fetched.length > 0) {
          models = fetched;
        }
      } catch {
        // Fallback default list
      }

      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select active PodLlama model role or model file',
      });

      if (selected) {
        const cfg = vscode.workspace.getConfiguration('podllama');
        if (selected.includes('thinking') || selected.includes('DeepSeek')) {
          await cfg.update('thinkingModel', selected, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`PodLlama Thinking model set to: ${selected}`);
        } else if (selected.includes('autocomplete')) {
          await cfg.update('autocompleteModel', selected, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`PodLlama Autocomplete model set to: ${selected}`);
        } else {
          await cfg.update('chatModel', selected, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`PodLlama Chat model set to: ${selected}`);
        }
        statusBarManager.updateStatus();
      }
    })
  );

  // Command: Toggle Autocomplete
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.toggleAutocomplete', async () => {
      const cfg = vscode.workspace.getConfiguration('podllama');
      const current = cfg.get<boolean>('enableAutocomplete', true);
      await cfg.update('enableAutocomplete', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `PodLlama Inline Autocomplete is now ${!current ? 'ENABLED' : 'DISABLED'}.`
      );
      statusBarManager.updateStatus();
    })
  );

  // Helper command launcher for chat subcommands
  const openChatWithCommand = async (command: string) => {
    await vscode.commands.executeCommand('workbench.action.quickchat.toggle');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.explainCode', () => openChatWithCommand('explain'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.refactorCode', () => openChatWithCommand('refactor'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.fixCode', () => openChatWithCommand('fix'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('podllama.generateTests', () => openChatWithCommand('test'))
  );
}
