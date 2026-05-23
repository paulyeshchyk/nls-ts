//extension.js
import * as vscode from 'vscode';
import { NlsCodeActionProvider, createKeyValueString, createKeyValueTypedef, } from './nlsCodeActionProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new NlsCodeActionProvider();
    const selector: vscode.DocumentSelector = { scheme: 'file', language: '*' };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            selector,
            provider,
            {
                providedCodeActionKinds: NlsCodeActionProvider.providedCodeActionKinds
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('nls-refactor.createKeyValueString', createKeyValueString),
        vscode.commands.registerCommand('nls-refactor.createKeyValueTypedef', createKeyValueTypedef)
    );
}