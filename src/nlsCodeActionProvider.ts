import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string;
}

/**
 * Реплейсер на основе vscode.l10n.t (современный API)
 */
export class VscodeL10nReplacer implements INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string {
        if (useTypedef) {
            if (args.length === 0) {
                return `vscode.l10n.t(nls.${key})`;
            } else {
                return `vscode.l10n.t(nls.${key}, ${args.join(', ')})`;
            }
        } else {
            if (args.length === 0) {
                return `vscode.l10n.t('${key}')`;
            } else {
                return `vscode.l10n.t('${key}', ${args.join(', ')})`;
            }
        }
    }
}

/**
 * Реплейсер на основе устаревшего vscode-nls (localize)
 */
export class VscodeNlsReplacer implements INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string {
        // В vscode-nls localize всегда требует fallback строку (второй аргумент)
        // и аргументы для подстановки.
        if (useTypedef) {
            // В typedef-режиме предполагаем, что nls.${key} содержит строку-ключ.
            // Но localize ожидает первым аргументом ключ, вторым – fallback.
            // fallback можно сделать пустым или динамическим.
            if (args.length === 0) {
                return `localize(nls.${key}, '')`;
            } else {
                return `localize(nls.${key}, '', ${args.join(', ')})`;
            }
        } else {
            if (args.length === 0) {
                return `localize('${key}', '')`;
            } else {
                return `localize('${key}', '', ${args.join(', ')})`;
            }
        }
    }
}

export class NlsCodeActionProvider implements vscode.CodeActionProvider {

    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {


        const selectedText = document.getText(range).trim();
        if (!selectedText) return undefined;

        if (context.only && !context.only.contains(vscode.CodeActionKind.Refactor)) {
            return undefined;
        }

        const stringAction = new vscode.CodeAction('NLS: Create Key-Value (string)', vscode.CodeActionKind.Refactor);
        stringAction.command = {
            title: 'nls-refactor.createKeyValueString',
            command: 'nls-refactor.createKeyValueString',
            arguments: [document, range, selectedText]
        };

        const typedefAction = new vscode.CodeAction('NLS: Create Key-Value (typedef)', vscode.CodeActionKind.Refactor);
        typedefAction.command = {
            title: 'nls-refactor.createKeyValueTypedef',
            command: 'nls-refactor.createKeyValueTypedef',
            arguments: [document, range, selectedText]
        };

        return [stringAction, typedefAction];
    }
}

// ====================== ОСНОВНЫЕ ФУНКЦИИ ======================

const replacer: INlsReplacer = new VscodeNlsReplacer();


export async function createKeyValueString(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string
) {
    await createKeyValueBase(document, range, selectedText, false);
}

export async function createKeyValueTypedef(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string
) {
    await createKeyValueBase(document, range, selectedText, true);
}

// ====================== ОБЩАЯ ЛОГИКА ======================
async function createKeyValueBase(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string,
    useTypedef: boolean
) {
    try {
        const key = await vscode.window.showInputBox({
            prompt: useTypedef
                ? 'Enter NLS key (e.g. "lorem.ipsum.dolor")'
                : 'Enter NLS key',
            placeHolder: 'section.title',
            validateInput: (v) => !v?.trim() ? 'Key cannot be empty' : null
        });
        if (!key) return;

        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!rootPath) throw new Error('No workspace folder found');

        // 1. Обновляем package.nls.json
        const nlsFiles = await findNlsFiles(rootPath);
        if (nlsFiles.length === 0) {
            const defaultPath = path.join(rootPath, 'package.nls.json');
            await fs.writeFile(defaultPath, JSON.stringify({}, null, 2), 'utf-8');
            nlsFiles.push(defaultPath);
        }
        for (const file of nlsFiles) {
            await addKeyToNlsFile(file, key, selectedText);
        }


        const { pattern, args } = extractTemplate(selectedText);
        // 3. Готовим замену текста
        const replacementText = replacer.buildReplacement(useTypedef, key, args);

        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === document) {
            await editor.edit(editBuilder => {
                editBuilder.replace(range, replacementText);
            }, { undoStopBefore: true, undoStopAfter: true });
        } else {
            vscode.window.showWarningMessage('Editor focus changed. Please replace manually.');
            return;
        }

        if (useTypedef) {
            // Добавляем require, если нужно
            // 2. Пересобираем nls.js из package.nls.json
            await rebuildNlsJs(rootPath);
            await ensureNlsRequire(document, rootPath);
        }

        vscode.window.showInformationMessage(`NLS key "${key}" added ${useTypedef ? '(typedef)' : '(string)'}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
}

function extractTemplate(template: string): { pattern: string; args: string[] } {
    const regex = /\${([^}]+)}/g;
    const args: string[] = [];
    let index = 0;
    const pattern = template.replace(regex, (_, expr) => {
        args.push(expr.trim());
        return `{${index++}}`;
    });
    return { pattern, args };
}

/**
 * Полностью пересоздаёт файл nls.js на основе всех ключей из package.nls.json
 */
async function rebuildNlsJs(rootPath: string): Promise<void> {
const packageNlsPath = path.join(rootPath, 'package.nls.json');
    let allKeys: Record<string, string> = {};
    try {
        const content = await fs.readFile(packageNlsPath, 'utf-8');
        allKeys = JSON.parse(content);
    } catch {
        // файла нет — создадим пустой
        await fs.writeFile(packageNlsPath, JSON.stringify({}, null, 2), 'utf-8');
    }

    const nlsObject: any = {};
    for (const key of Object.keys(allKeys)) {
        // В качестве значения используем сам ключ
        const parts = key.split('.');
        setNestedValue(nlsObject, parts, key);
    }

    const jsContent = `// Auto-generated by NLS Refactor. Do not edit manually.
const nls = ${JSON.stringify(nlsObject, null, 2)};

module.exports = { nls };
`;
    await fs.writeFile(path.join(rootPath, 'nls.js'), jsContent, 'utf-8');
}

// Вспомогательная функция для установки вложенного значения
function setNestedValue(obj: any, parts: string[], value: string) {
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}


async function ensureNlsRequire(document: vscode.TextDocument, rootPath: string): Promise<void> {
    const text = document.getText();
    // Проверяем, есть ли уже require или import для nls
    if (/const\s*\{\s*nls\s*\}\s*=\s*require\(/.test(text)) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;

    // Вычисляем относительный путь от текущего файла до корня проекта
    const currentDir = path.dirname(document.uri.fsPath);
    let relativePath = path.relative(currentDir, path.join(rootPath, 'nls.js'));
    relativePath = relativePath.replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }

    const requireStatement = `const { nls } = require('${relativePath}');\n`;
    let insertPosition = new vscode.Position(0, 0);

    // Пропускаем shebang, если есть
    const firstLine = text.split('\n')[0];
    if (firstLine.startsWith('#!')) {
        insertPosition = new vscode.Position(1, 0);
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(insertPosition, requireStatement);
    });
}

async function findNlsFiles(rootPath: string): Promise<string[]> {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const nlsFiles: string[] = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('package.nls') && entry.name.endsWith('.json')) {
            nlsFiles.push(path.join(rootPath, entry.name));
        }
    }
    return nlsFiles;
}

async function addKeyToNlsFile(filePath: string, key: string, value: string) {
    let content: string;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch {
        content = '{}';
    }
    let json: Record<string, string>;
    try {
        json = JSON.parse(content);
    } catch {
        json = {};
    }
    json[key] = value; // никакой очистки – JSON.stringify справится
    await fs.writeFile(filePath, JSON.stringify(json, null, 2), 'utf-8');
}
