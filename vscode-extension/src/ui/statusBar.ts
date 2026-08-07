import * as vscode from 'vscode';
import { PodLlamaClient } from '../api/podllamaClient';

export class PodLlamaStatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private pollInterval: NodeJS.Timeout | undefined;

  constructor(private client: PodLlamaClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'podllama.selectModel';
    this.updateStatus();
    this.statusBarItem.show();

    // Poll health status every 10 seconds
    this.pollInterval = setInterval(() => this.updateStatus(), 10000);
  }

  public async updateStatus(): Promise<void> {
    const config = vscode.workspace.getConfiguration('podllama');
    const enabled = config.get<boolean>('enableAutocomplete', true);
    const chatModel = config.get<string>('chatModel', 'podllama-chat');

    const isHealthy = await this.client.checkHealth();

    if (isHealthy) {
      const autoTag = enabled ? 'FIM: On' : 'FIM: Off';
      this.statusBarItem.text = `$(server) PodLlama: Ready (${chatModel} | ${autoTag})`;
      this.statusBarItem.tooltip = `PodLlama Local Service is Online\nBase URL: ${this.client.currentConfig.apiBase}\nActive Chat Model: ${chatModel}\nInline Autocomplete: ${enabled ? 'Enabled' : 'Disabled'}\nClick to configure or switch models.`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = `$(error) PodLlama: Offline`;
      this.statusBarItem.tooltip = `PodLlama Local Service is Offline\nCannot connect to ${this.client.currentConfig.apiBase}.\nRun 'make service-up' to start containers.\nClick to re-check status or switch configuration.`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  public dispose() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.statusBarItem.dispose();
  }
}
