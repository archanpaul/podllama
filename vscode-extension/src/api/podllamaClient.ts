import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface PodLlamaConfig {
  apiBase: string;
  apiKey: string;
  chatModel: string;
  thinkingModel: string;
  autocompleteModel: string;
  temperature: number;
  autocompleteMaxTokens: number;
  maxContextTokens: number;
  systemPrompt: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ModelInfo {
  id: string;
  object: string;
  owned_by: string;
}

export class PodLlamaClient {
  constructor(private config: PodLlamaConfig) {}

  public updateConfig(config: PodLlamaConfig) {
    this.config = config;
  }

  public get currentConfig(): PodLlamaConfig {
    return this.config;
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const liveUrl = this.config.apiBase.replace(/\/v1\/?$/, '/health/liveliness');
      const res = await this.httpRequest('GET', liveUrl, undefined, undefined, 5000);
      if (res.statusCode === 200) {
        return true;
      }
    } catch {
      // Fallback check on models endpoint
    }

    try {
      const modelsUrl = `${this.config.apiBase.replace(/\/$/, '')}/models`;
      const res = await this.httpRequest('GET', modelsUrl, undefined, {
        Authorization: `Bearer ${this.config.apiKey}`,
      }, 5000);
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<string[]> {
    const modelsUrl = `${this.config.apiBase.replace(/\/$/, '')}/models`;
    const res = await this.httpRequest('GET', modelsUrl, undefined, {
      Authorization: `Bearer ${this.config.apiKey}`,
    }, 10000);
    if (res.statusCode !== 200) {
      throw new Error(`Failed to list models: HTTP ${res.statusCode} ${res.body}`);
    }
    const json = JSON.parse(res.body);
    if (Array.isArray(json.data)) {
      return json.data.map((m: ModelInfo) => m.id);
    }
    return [];
  }

  public async completeText(req: CompletionRequest): Promise<string> {
    const url = `${this.config.apiBase.replace(/\/$/, '')}/completions`;
    const body = JSON.stringify({
      model: req.model || this.config.autocompleteModel,
      prompt: req.prompt,
      max_tokens: req.max_tokens ?? this.config.autocompleteMaxTokens,
      temperature: req.temperature ?? this.config.temperature,
      stop: req.stop ?? ['\n\n', '<|endoftext|>', '<|file_separator|>'],
    });

    const res = await this.httpRequest('POST', url, body, {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    }, 30000);

    if (res.statusCode !== 200) {
      throw new Error(`Completion error HTTP ${res.statusCode}: ${res.body}`);
    }

    const json = JSON.parse(res.body);
    if (json.choices && json.choices.length > 0) {
      return json.choices[0].text || '';
    }
    return '';
  }

  public async chatCompletion(req: ChatCompletionRequest): Promise<string> {
    const url = `${this.config.apiBase.replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: req.model || this.config.chatModel,
      messages: req.messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.max_tokens,
      stream: false,
    });

    const res = await this.httpRequest('POST', url, body, {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    }, 30000);

    if (res.statusCode !== 200) {
      throw new Error(`Chat error HTTP ${res.statusCode}: ${res.body}`);
    }

    const json = JSON.parse(res.body);
    if (json.choices && json.choices.length > 0) {
      return json.choices[0].message?.content || '';
    }
    return '';
  }

  public async streamChatCompletion(
    req: ChatCompletionRequest,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = `${this.config.apiBase.replace(/\/$/, '')}/chat/completions`;
    const parsedUrl = new URL(url);
    const body = JSON.stringify({
      model: req.model || this.config.chatModel,
      messages: req.messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.max_tokens,
      stream: true,
    });

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise<void>((resolve, reject) => {
      const requestOptions: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const reqClient = transport.request(requestOptions, (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (d) => (errBody += d.toString()));
          res.on('end', () =>
            reject(new Error(`Stream error HTTP ${res.statusCode}: ${errBody}`))
          );
          return;
        }

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta?.content;
                if (delta) {
                  onChunk(delta);
                }
              } catch {
                // Malformed SSE data ignore
              }
            }
          }
        });

        res.on('end', () => {
          if (buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
            try {
              const data = JSON.parse(buffer.trim().slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                onChunk(delta);
              }
            } catch {
              // ignore
            }
          }
          resolve();
        });

        res.on('error', (err) => reject(err));
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          reqClient.destroy();
          resolve();
        });
      }

      reqClient.on('error', (err) => reject(err));
      reqClient.write(body);
      reqClient.end();
    });
  }

  private httpRequest(
    method: string,
    targetUrl: string,
    postData?: string,
    headers?: Record<string, string>,
    timeoutMs: number = 10000
  ): Promise<{ statusCode: number; body: string }> {
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: headers || {},
        timeout: timeoutMs,
      };

      if (postData && headers && !headers['Content-Length']) {
        (options.headers as Record<string, string | number>)['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = transport.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk.toString()));
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, body }));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${method} ${targetUrl}`));
      });

      req.on('error', (err) => reject(err));

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
}
