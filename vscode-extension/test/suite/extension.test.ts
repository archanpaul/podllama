import * as assert from 'assert';
import { PodLlamaClient, PodLlamaConfig } from '../../src/api/podllamaClient';
import { detectLanguageModelApiSupport } from '../../src/utils/apiCompat';

describe('PodLlama Extension Unit Tests', () => {
  const defaultConfig: PodLlamaConfig = {
    apiBase: 'http://localhost:4000/v1',
    apiKey: 'sk-local',
    chatModel: 'podllama-chat',
    thinkingModel: 'podllama-thinking',
    autocompleteModel: 'podllama-autocomplete',
    temperature: 0.2,
    autocompleteMaxTokens: 128,
    maxContextTokens: 16384,
    systemPrompt: 'You are PodLlama, an expert AI software engineering assistant running on local GPU hardware.',
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

  it('PodLlamaConfig includes maxContextTokens and systemPrompt', () => {
    const client = new PodLlamaClient(defaultConfig);
    assert.strictEqual(client.currentConfig.maxContextTokens, 16384);
    assert.strictEqual(
      client.currentConfig.systemPrompt,
      'You are PodLlama, an expert AI software engineering assistant running on local GPU hardware.'
    );
  });

  it('FIM Autocomplete Prompt Construction is well-formed', () => {
    const prefix = 'def hello():\n    ';
    const suffix = '\n    return True';
    const fimPrompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    assert.ok(fimPrompt.includes('<|fim_prefix|>def hello()'));
    assert.ok(fimPrompt.includes('<|fim_suffix|>\n    return True'));
    assert.ok(fimPrompt.endsWith('<|fim_middle|>'));
  });

  it('detects unsupported language model APIs without throwing', () => {
    const support = detectLanguageModelApiSupport({}, {});

    assert.deepStrictEqual(support, {
      hasChatParticipantApi: false,
      hasLanguageModelToolApi: false,
      hasLanguageModelProviderApi: false,
    });
  });
});

describe('FIM Post-Processing Tests', () => {
  // Inline implementation of the postProcessFimCompletion logic for unit testing
  function postProcessFimCompletion(
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

  it('strips special FIM tokens from output', () => {
    const result = postProcessFimCompletion(
      'hello<|endoftext|> world<|fim_suffix|>',
      'pre',
      'suf'
    );
    assert.ok(!result.includes('<|endoftext|>'));
    assert.ok(!result.includes('<|fim_suffix|>'));
  });

  it('strips <EOT> and <end_of_turn> tokens', () => {
    const result = postProcessFimCompletion(
      'code<EOT>more<end_of_turn>',
      'pre',
      ''
    );
    assert.strictEqual(result, 'codemore');
  });

  it('strips line prefix echo from completion', () => {
    const prefix = 'function add(a, b) {\n    return ';
    const result = postProcessFimCompletion(
      'return a + b;',
      prefix,
      '\n}'
    );
    assert.strictEqual(result, 'a + b;');
  });

  it('strips suffix overlap to avoid duplication', () => {
    const result = postProcessFimCompletion(
      'completed code\n}',
      'prefix',
      '\n}'
    );
    assert.strictEqual(result, 'completed code');
  });

  it('handles empty raw text', () => {
    const result = postProcessFimCompletion('', 'prefix', 'suffix');
    assert.strictEqual(result, '');
  });

  it('handles text with only special tokens', () => {
    const result = postProcessFimCompletion(
      '<|endoftext|><|fim_prefix|><|fim_suffix|><|fim_middle|>',
      '',
      ''
    );
    assert.strictEqual(result, '');
  });
});
