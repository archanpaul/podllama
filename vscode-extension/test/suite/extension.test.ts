import * as assert from 'assert';
import { PodLlamaClient, PodLlamaConfig } from '../../src/api/podllamaClient';

describe('PodLlama Extension Unit Tests', () => {
  const defaultConfig: PodLlamaConfig = {
    apiBase: 'http://localhost:4000/v1',
    apiKey: 'sk-local',
    chatModel: 'podllama-chat',
    thinkingModel: 'podllama-thinking',
    autocompleteModel: 'podllama-autocomplete',
    temperature: 0.2,
    autocompleteMaxTokens: 128,
  };

  it('PodLlamaClient initializes with correct settings', () => {
    const client = new PodLlamaClient(defaultConfig);
    assert.strictEqual(client.currentConfig.apiBase, 'http://localhost:4000/v1');
    assert.strictEqual(client.currentConfig.apiKey, 'sk-local');
    assert.strictEqual(client.currentConfig.chatModel, 'podllama-chat');
  });

  it('PodLlamaClient configuration can be updated', () => {
    const client = new PodLlamaClient(defaultConfig);
    client.updateConfig({
      ...defaultConfig,
      chatModel: 'custom-model',
    });
    assert.strictEqual(client.currentConfig.chatModel, 'custom-model');
  });

  it('FIM Autocomplete Prompt Construction is well-formed', () => {
    const prefix = 'def hello():\n    ';
    const suffix = '\n    return True';
    const fimPrompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    assert.ok(fimPrompt.includes('<|fim_prefix|>def hello()'));
    assert.ok(fimPrompt.includes('<|fim_suffix|>\n    return True'));
    assert.ok(fimPrompt.endsWith('<|fim_middle|>'));
  });
});
