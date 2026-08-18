import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface PersonaCategory {
    id: string;
    // New schema uses display_name + ui_icon; old schema used name + icon.
    name: string;
    display_name?: string;
    description: string;
    icon: string;
    ui_icon?: string;
}

/** Flat shape used by all consumers (chat.js, chatWebviewProvider.ts). */
export interface PersonaItem {
    id: string;
    name: string;
    category?: string;
    category_id?: string;
    icon: string;
    slash_command: string;
    description: string;
    skills?: string[];
    target_model: string;
    system_prompt: string;
}

// ── New nested schema types (only used inside the mapper below) ──────────────
interface RawPersonaNew {
    id: string;
    category_id?: string;
    ui_metadata?: {
        display_name?: string;
        slash_command?: string;
        ui_icon?: string;
        description?: string;
    };
    llm_config?: {
        target_model?: string;
    };
    prompt_blueprint?: {
        role_definition?: string;
        core_skills?: string[];
    };
    // Old flat fields — kept for backwards compat
    name?: string;
    category?: string;
    icon?: string;
    slash_command?: string;
    description?: string;
    skills?: string[];
    target_model?: string;
    system_prompt?: string;
}

/**
 * Normalizes a persona object from either the old flat schema or the new
 * nested schema into the flat PersonaItem shape the extension expects.
 */
function normalizePersona(
    raw: RawPersonaNew,
    categoryMap?: Map<string, string>
): PersonaItem {
    const ui  = raw.ui_metadata     || {};
    const llm = raw.llm_config      || {};
    const bp  = raw.prompt_blueprint || {};

    // Resolve human-readable category name for grouping in the dropdown.
    // New schema: category_id (e.g. "cs-theory") → display_name ("Computer Science & Foundations")
    // Old schema: category is already the human-readable string.
    const categoryId = raw.category_id || '';
    const category =
        (categoryMap && categoryId && categoryMap.get(categoryId))
        || raw.category
        || '';

    return {
        id:            raw.id,
        name:          ui.display_name   || raw.name          || raw.id,
        category_id:   categoryId,
        category,
        icon:          ui.ui_icon        || raw.icon          || '',
        slash_command: ui.slash_command  || raw.slash_command || '',
        description:   ui.description   || raw.description   || '',
        skills:        bp.core_skills   || raw.skills        || [],
        target_model:  llm.target_model  || raw.target_model  || 'podllama-chat',
        system_prompt: bp.role_definition || raw.system_prompt || '',
    };
}

export interface ModelItem {
    id: string;
    object: string;
    owned_by: string;
}

export interface CompletionRequest {
    model: string;
    prompt: string;
    max_tokens?: number;
    temperature?: number;
    stop?: string[];
}

export class PodLlamaClient {
    constructor(private getApiBase: () => string, private getApiKey: () => string) {}

    /**
     * Poll backend models endpoint (GET /v1/models)
     */
    /**
     * Check if PodLlama service is available (GET /models or /health/liveliness)
     */
    async isServiceAvailable(): Promise<boolean> {
        const apiBase = this.getApiBase();
        const apiKey = this.getApiKey();
        const urlStr = `${apiBase.replace(/\/$/, '')}/models`;

        try {
            const data = await this.httpGetJson<{ data: ModelItem[] }>(urlStr, apiKey);
            return Array.isArray(data.data) && data.data.length > 0;
        } catch (err) {
            return false;
        }
    }

    async listPersonas(): Promise<PersonaItem[]> {
        const apiBase = this.getApiBase();
        const apiKey = this.getApiKey();
        const primaryUrl = `${apiBase.replace(/\/$/, '')}/personas`;

        const tryFetch = async (url: string): Promise<PersonaItem[] | null> => {
            const data = await this.httpGetJson<{
                personas: RawPersonaNew[];
                categories?: Array<{ id: string; display_name?: string; name?: string }>;
            }>(url, apiKey);
            if (data && Array.isArray(data.personas) && data.personas.length > 0) {
                // Build id → display_name map so the dropdown groups correctly.
                const catMap = new Map<string, string>();
                (data.categories || []).forEach(c => {
                    catMap.set(c.id, c.display_name || c.name || c.id);
                });
                return data.personas.map(p => normalizePersona(p, catMap));
            }
            return null;
        };

        try {
            const result = await tryFetch(primaryUrl);
            if (result) { return result; }
        } catch (_err) {
            // Primary URL failed — fall back to direct swapper on port 8080
        }
        try {
            const fallbackUrl = primaryUrl.replace(':4000', ':8080');
            const result = await tryFetch(fallbackUrl);
            if (result) { return result; }
        } catch (e) {
            console.error('[PodLlama] Failed to list personas:', e);
        }
        return [];
    }

    async listModels(): Promise<ModelItem[]> {
        const apiBase = this.getApiBase();
        const apiKey = this.getApiKey();
        const urlStr = `${apiBase.replace(/\/$/, '')}/models`;

        try {
            const data = await this.httpGetJson<{ data: ModelItem[] }>(urlStr, apiKey);
            return data.data || [];
        } catch (err) {
            console.error('[PodLlama] Failed to list models:', err);
            return [];
        }
    }

    /**
     * FIM Text Completion Endpoint (POST /v1/completions)
     */
    async getCompletion(req: CompletionRequest): Promise<string> {
        const apiBase = this.getApiBase();
        const apiKey = this.getApiKey();
        const urlStr = `${apiBase.replace(/\/$/, '')}/completions`;

        const body = JSON.stringify({
            model: req.model,
            prompt: req.prompt,
            max_tokens: req.max_tokens ?? 64,
            temperature: req.temperature ?? 0.1,
            stop: req.stop ?? ['\n\n', '<|file_separator|>']
        });

        try {
            const res = await this.httpPostJson<{ choices?: { text: string }[] }>(urlStr, body, apiKey);
            if (res.choices && res.choices.length > 0) {
                return res.choices[0].text;
            }
        } catch (err) {
            console.error('[PodLlama] Completion request error:', err);
        }
        return '';
    }

    /**
     * Context Summarization Request using podllama-chat
     */
    async summarizeContext(messages: { role: string; content: string }[], chatModel: string): Promise<string> {
        const apiBase = this.getApiBase();
        const apiKey = this.getApiKey();
        const urlStr = `${apiBase.replace(/\/$/, '')}/chat/completions`;

        const promptMessages = [
            {
                role: 'system',
                content: 'You are a technical context summarizer. Provide a concise summary of the key context, requirements, and decisions from the conversation history to pass as system context.'
            },
            ...messages,
            {
                role: 'user',
                content: 'Summarize the above conversation into key points for technical context.'
            }
        ];

        const body = JSON.stringify({
            model: chatModel,
            messages: promptMessages,
            temperature: 0.2,
            max_tokens: 300
        });

        try {
            const res = await this.httpPostJson<{ choices?: { message?: { content: string } }[] }>(urlStr, body, apiKey);
            if (res.choices && res.choices.length > 0 && res.choices[0].message) {
                return res.choices[0].message.content;
            }
        } catch (err) {
            console.error('[PodLlama] Summarize context error:', err);
        }
        return '';
    }

    private httpGetJson<T>(urlStr: string, apiKey: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(urlStr);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                }
            };

            const req = transport.request(options, (res) => {
                let rawData = '';
                res.on('data', chunk => rawData += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(rawData));
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${rawData}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
    }

    private httpPostJson<T>(urlStr: string, body: string, apiKey: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(urlStr);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'Authorization': `Bearer ${apiKey}`
                }
            };

            const req = transport.request(options, (res) => {
                let rawData = '';
                res.on('data', chunk => rawData += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(rawData));
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${rawData}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
}
