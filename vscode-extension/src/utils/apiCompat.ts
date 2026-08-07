import * as vscode from 'vscode';

export interface LanguageModelApiSupport {
  hasChatParticipantApi: boolean;
  hasLanguageModelToolApi: boolean;
  hasLanguageModelProviderApi: boolean;
}

export function detectLanguageModelApiSupport(
  vscodeApi: typeof vscode | any = vscode,
  lmApi: any = (vscodeApi as any).lm
): LanguageModelApiSupport {
  return {
    hasChatParticipantApi: typeof (vscodeApi as any).chat?.createChatParticipant === 'function',
    hasLanguageModelToolApi: typeof lmApi?.registerTool === 'function',
    hasLanguageModelProviderApi: typeof lmApi?.registerLanguageModelChatProvider === 'function',
  };
}
