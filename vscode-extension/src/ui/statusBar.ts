import * as vscode from 'vscode';
import { PodLlamaClient } from '../api/podllamaClient';

const POLL_INTERVAL_MS = 30000;         // 30s normal polling
const BACKOFF_MAX_MS = 120000;          // 2min max backoff when offline
const BACKOFF_MULTIPLIER = 2;

export class PodLlamaStatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private currentIntervalMs: number = POLL_INTERVAL_MS;
  private wasOffline: boolean = false;

  constructor(private client: PodLlamaClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'podllama.selectModel';
    this.updateStatus();
    this.statusBarItem.show();

    // Start poll loop
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(() => {
      this.updateStatus().finally(() => this.schedulePoll());
    }, this.currentIntervalMs);
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

      // Reset backoff on recovery
      if (this.wasOffline) {
        this.wasOffline = false;
        this.currentIntervalMs = POLL_INTERVAL_MS;
      }
    } else {
      this.statusBarItem.text = `$(error) PodLlama: Offline`;
      this.statusBarItem.tooltip = `PodLlama Local Service is Offline\nCannot connect to ${this.client.currentConfig.apiBase}.\nRun 'make service-up' to start containers.\nClick to re-check status or switch configuration.`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

      // Exponential backoff when offline
      this.wasOffline = true;
      this.currentIntervalMs = Math.min(
        this.currentIntervalMs * BACKOFF_MULTIPLIER,
        BACKOFF_MAX_MS
      );
    }
  }

  public dispose() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.statusBarItem.dispose();
  }
}
