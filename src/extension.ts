import * as vscode from 'vscode';
import { 
    NlsCodeActionProvider, 
    createKeyValueString, 
    createKeyValueTypedef 
} from './nlsCodeActionProvider';

export function activate(context: vscode.ExtensionContext) {
    try {
        // 1. Регистрация Code Action Provider (для меню Ctrl + .)
        const provider = new NlsCodeActionProvider();
        const selector: vscode.DocumentSelector = { 
            scheme: 'file', 
            language: '*' 
        };

        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                selector,
                provider,
                {
                    providedCodeActionKinds: NlsCodeActionProvider.providedCodeActionKinds
                }
            )
        );

        // 2. Регистрация команд
        context.subscriptions.push(
            vscode.commands.registerCommand('nls_ts.createKeyValueString', createKeyValueString),
            vscode.commands.registerCommand('nls_ts.createKeyValueTypedef', createKeyValueTypedef)
        );

        console.log('NLS Refactor extension successfully activated');

    } catch (error: any) {
        console.error('NLS Refactor activation failed:', error);
        vscode.window.showErrorMessage('Failed to activate NLS Refactor extension');
    }
}

export function deactivate() {
}