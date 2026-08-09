import * as vscode from 'vscode';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    static scheme = 'podllama-diff';
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private contents = new Map<string, string>();

    update(uri: vscode.Uri, content: string) {
        this.contents.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
    }
}
