import * as vscode from 'vscode';

export interface MessageTurn {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    thinking?: string;
    model?: string;
    timestamp: number;
}

export interface ConversationSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: MessageTurn[];
    summarizedContext?: string;
    selectedModel?: string;
    selectedPersona?: string;
}

export class ConversationManager {
    private static STORAGE_KEY = 'podllama.conversations';
    private static ACTIVE_KEY = 'podllama.activeConversationId';

    constructor(private context: vscode.ExtensionContext) {}

    getAllConversations(): ConversationSession[] {
        return this.context.globalState.get<ConversationSession[]>(ConversationManager.STORAGE_KEY, []);
    }

    getActiveConversationId(): string | undefined {
        return this.context.globalState.get<string>(ConversationManager.ACTIVE_KEY);
    }

    getActiveConversation(): ConversationSession {
        const convs = this.getAllConversations();
        const activeId = this.getActiveConversationId();
        const found = convs.find(c => c.id === activeId);

        if (found) {
            return found;
        }

        // Create initial conversation if none active
        return this.createConversation('New Chat');
    }

    createConversation(title = 'New Chat', selectedModel?: string, selectedPersona?: string): ConversationSession {
        const newConv: ConversationSession = {
            id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            selectedModel,
            selectedPersona
        };

        const convs = [newConv, ...this.getAllConversations()];
        this.context.globalState.update(ConversationManager.STORAGE_KEY, convs);
        this.context.globalState.update(ConversationManager.ACTIVE_KEY, newConv.id);
        return newConv;
    }

    setActiveConversation(id: string): ConversationSession | undefined {
        const convs = this.getAllConversations();
        const found = convs.find(c => c.id === id);
        if (found) {
            this.context.globalState.update(ConversationManager.ACTIVE_KEY, id);
            return found;
        }
        return undefined;
    }

    saveConversation(conv: ConversationSession): void {
        const convs = this.getAllConversations();
        const index = convs.findIndex(c => c.id === conv.id);
        
        conv.updatedAt = Date.now();
        if (index >= 0) {
            convs[index] = conv;
        } else {
            convs.unshift(conv);
        }

        this.context.globalState.update(ConversationManager.STORAGE_KEY, convs);
    }

    deleteConversation(id: string): ConversationSession[] {
        let convs = this.getAllConversations().filter(c => c.id !== id);
        this.context.globalState.update(ConversationManager.STORAGE_KEY, convs);
        
        if (this.getActiveConversationId() === id) {
            const nextActive = convs.length > 0 ? convs[0].id : undefined;
            this.context.globalState.update(ConversationManager.ACTIVE_KEY, nextActive);
        }

        return convs;
    }

    clearAll(): void {
        this.context.globalState.update(ConversationManager.STORAGE_KEY, []);
        this.context.globalState.update(ConversationManager.ACTIVE_KEY, undefined);
    }
}
