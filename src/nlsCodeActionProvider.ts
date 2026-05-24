import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

/** Константы */
export const NLS_OBJECT_NAME = 'nls_ts';
export const NLS_JS_NAME = 'nls_ts.js';

export const NLS_LOADER_TEMPLATE = `// Auto-generated runtime helper for NLS localization
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

/** * Кэш текущих переводов (плоский словарь)
 * @type {Record<string, string>} 
 */
let currentTranslations = {};

/**
 * Инициализация локализации. Вызывается один раз в методе activate().
 * @param {vscode.ExtensionContext} context 
 */
function initNls(context) {
    const locale = vscode.env.language; 
    const rootPath = context.extensionPath;
    let nlsPath = path.join(rootPath, \`package.nls.\${locale}.json\`);
    
    if (!fs.existsSync(nlsPath)) {
        nlsPath = path.join(rootPath, 'package.nls.json');
    }
    
    try {
        if (fs.existsSync(nlsPath)) {
            currentTranslations = JSON.parse(fs.readFileSync(nlsPath, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to load NLS file:', err);
    }
}

/**
 * Функция перевода по ключу.
 * @param {string} key - Путь к ключу локализации.
 * @param {...(string | number | boolean)} args - Аргументы для шаблона {0}, {1}...
 * @returns {string}
 */
function translate(key, ...args) {
    /** @type {string} */
    let template = currentTranslations[key] || key;
    
    if (args.length > 0) {
        // Явно типизируем callback для replace
        template = template.replace(/{\\d+}/g, 
            /**
             * @param {string} match - Совпавшая подстрока (например, "{0}")
             * @param {string} number - Порядковый номер аргумента из группы захвата ("0")
             * @returns {string}
             */
            (match, number) => {
                const index = parseInt(number, 10);
                return typeof args[index] !== 'undefined' ? String(args[index]) : match;
            }
        );
    }
    return template;
}

module.exports = { initNls, translate };
`;
// ====================== ИНТЕРФЕЙСЫ ======================

export interface IHost {
    // Window / UI
    showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
    showInformationMessage(message: string): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<string | undefined>;
    showErrorMessage(message: string): Thenable<string | undefined>;
}

export interface IDocumentManager {
    // Workspace
    getRootPath(): string | undefined;

    getActiveTextEditor(): vscode.TextEditor | undefined;
    getDocumentText(document: vscode.TextDocument): string;
    getDocumentUri(document: vscode.TextDocument): vscode.Uri;
    insertText(document: vscode.TextDocument, position: vscode.Position, content: string): Promise<boolean>;
}

export interface INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string;
}

export interface INlsFinder {
    findNlsFiles(rootPath: string): Promise<string[]>;
}

export interface INlsBuilder {
    createDefaultNlsFile(rootPath: string): Promise<string>;
    addKeyToNlsFile(filePath: string, key: string, value: string): Promise<void>;
    rebuildNlsJs(rootPath: string): Promise<void>;
    ensureNlsLoader(rootPath: string): Promise<void>;
}

export interface IJsPatcher {
    ensureNlsImport(text: string, currentDir: string, rootPath: string): Promise<{ position: vscode.Position; content: string } | null>;
}

// ====================== РЕАЛИЗАЦИИ ======================

export class VsDocumentManager implements IDocumentManager {
    getRootPath(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    getActiveTextEditor(): vscode.TextEditor | undefined {
        return vscode.window.activeTextEditor;
    }

    getDocumentText(document: vscode.TextDocument): string {
        return document.getText();
    }

    getDocumentUri(document: vscode.TextDocument): vscode.Uri {
        return document.uri;
    }

    async insertText(
        document: vscode.TextDocument,
        position: vscode.Position,
        content: string
    ): Promise<boolean> {

        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, position, content);
        await vscode.workspace.applyEdit(edit);

        return true;
    }
}

export class VsCodeHost implements IHost {

    showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    showInformationMessage(message: string): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message);
    }

    showWarningMessage(message: string): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message);
    }

    showErrorMessage(message: string): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message);
    }
}

export class NlsFinder implements INlsFinder {
    async findNlsFiles(rootPath: string): Promise<string[]> {
        const entries = await fs.readdir(rootPath, { withFileTypes: true });
        return entries
            .filter(e => e.isFile() && e.name.startsWith('package.nls') && e.name.endsWith('.json'))
            .map(e => path.join(rootPath, e.name));
    }
}

export class NlsBuilder implements INlsBuilder {

    async createDefaultNlsFile(rootPath: string): Promise<string> {
        const defaultPath = path.join(rootPath, 'package.nls.json');
        await fs.writeFile(defaultPath, JSON.stringify({}, null, 2), 'utf-8');
        return defaultPath;
    }

    async addKeyToNlsFile(filePath: string, key: string, value: string): Promise<void> {
        let content = '{}';
        try { content = await fs.readFile(filePath, 'utf-8'); } catch { }

        const json = JSON.parse(content) as Record<string, string>;
        json[key] = value;

        await fs.writeFile(filePath, JSON.stringify(json, null, 2), 'utf-8');
    }

    private setNestedValue(obj: any, parts: string[], value: string): void {
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            current[part] = current[part] || {};
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;
    }

    async rebuildNlsJs(rootPath: string): Promise<void> {
        const packageNlsPath = path.join(rootPath, 'package.nls.json');
        let allKeys: Record<string, string> = {};
        try {
            allKeys = JSON.parse(await fs.readFile(packageNlsPath, 'utf-8'));
        } catch {
            await this.createDefaultNlsFile(rootPath);
            allKeys = {};
        }

        const nlsObject: any = {};
        for (const key of Object.keys(allKeys)) {
            // Важно: значением ключа в объекте теперь должен быть сам плоский ключ (строка)
            this.setNestedValue(nlsObject, key.split('.'), key);
        }

        let jsonStr = JSON.stringify(nlsObject, null, 2);
        // Убираем кавычки у валидных идентификаторов свойств
        jsonStr = jsonStr.replace(/"([a-zA-Z_$][a-zA-Z0-9_$]*)":/g, '$1:');

        // Модифицированный шаблон содержимого файла nls_ts.js
        const jsContent =
            `// Auto-generated by NLS Refactor. Do not edit manually.\n` +
            `const { translate } = require('./nls_loader');\n\n` + 
            `const ${NLS_OBJECT_NAME} = ${jsonStr};\n\n` +
            `module.exports = { ${NLS_OBJECT_NAME}, translate };`; 

        await fs.writeFile(path.join(rootPath, NLS_JS_NAME), jsContent, 'utf-8');
    }

    async ensureNlsLoader(rootPath: string): Promise<void> {
        const loaderPath = path.join(rootPath, 'nls_loader.js');

        try {
            // Проверяем, существует ли файл. Если существует, метод выполнится успешно.
            await fs.access(loaderPath);
        } catch {
            // Если файла нет, fs.access бросит исключение, и мы создаем файл из константы
            await fs.writeFile(loaderPath, NLS_LOADER_TEMPLATE, 'utf-8');
        }
    }
}

export class JsPatcher implements IJsPatcher {
    constructor(private readonly host: IHost) { }

    async ensureNlsImport(
        text: string,
        currentDir: string,
        rootPath: string
    ): Promise<{ position: vscode.Position; content: string } | null> {

        // Регулярное выражение теперь ищет импорт, содержащий и nls_ts, и translate
        const regex = new RegExp(`const\\s*\\{\\s*${NLS_OBJECT_NAME},\\s*translate\\s*\\}\\s*=\\s*require\\(`);
        if (regex.test(text)) {
            return null;
        }

        let relativePath = path.relative(currentDir, path.join(rootPath, NLS_JS_NAME));
        relativePath = relativePath.replace(/\\/g, '/');
        if (!relativePath.startsWith('.')) relativePath = './' + relativePath;

        // Формируем чистую строку импорта двух сущностей из одного файла
        const requireStatement = `const { ${NLS_OBJECT_NAME}, translate } = require('${relativePath}');\n`;
        const insertLine = text.startsWith('#!') ? 1 : 0;

        return {
            position: new vscode.Position(insertLine, 0),
            content: requireStatement
        };
    }
}

export class CustomNlsReplacer implements INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string {
        // Заменяем вызов на локальный метод translate()
        if (useTypedef) {
            return args.length === 0
                ? `translate(${NLS_OBJECT_NAME}.${key})`
                : `translate(${NLS_OBJECT_NAME}.${key}, ${args.join(', ')})`;
        }
        return args.length === 0
            ? `translate('${key}')`
            : `translate('${key}', ${args.join(', ')})`;
    }
}

export class VscodeL10nReplacer implements INlsReplacer {
    buildReplacement(useTypedef: boolean, key: string, args: string[]): string {
        if (useTypedef) {
            return args.length === 0
                ? `vscode.l10n.t(${NLS_OBJECT_NAME}.${key})`
                : `vscode.l10n.t(${NLS_OBJECT_NAME}.${key}, ${args.join(', ')})`;
        }
        return args.length === 0
            ? `vscode.l10n.t('${key}')`
            : `vscode.l10n.t('${key}', ${args.join(', ')})`;
    }
}

// ====================== СЕРВИС ======================

export class NlsService {
    constructor(
        private readonly host: IHost,
        private readonly documentManager: IDocumentManager,
        private readonly nlsBuilder: INlsBuilder,
        private readonly nlsFinder: INlsFinder,
        private readonly jsPatcher: IJsPatcher,
        private readonly replacer: INlsReplacer
    ) { }

    async createKeyValue(
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string,
        useTypedef: boolean
    ) {
        try {

            const rootPath = this.documentManager.getRootPath();
            if (!rootPath) throw new Error('No workspace folder found');


            // --- ПРОВЕРКА И ПРЕДУПРЕЖДЕНИЕ ---
            const loaderPath = path.join(rootPath, 'nls_loader.js');
            let isFirstRun = false;

            try {
                await fs.access(loaderPath);
            } catch {
                isFirstRun = true;
            }

            if (isFirstRun) {
                // Предупреждаем пользователя и спрашиваем разрешение
                const choice = await vscode.window.showInformationMessage(
                    'This is the first time you run NLS Refactor in this project. ' +
                    'We need to add setup files (nls_loader.js & nls_ts.js) to your workspace. Proceed?',
                    'Yes', 'Cancel'
                );

                if (choice !== 'Yes') {
                    return; // Пользователь отказался, отменяем рефакторинг
                }

                // Создаем nls_loader.js, если пользователь согласился
                await this.nlsBuilder.ensureNlsLoader(rootPath);
            }

            const key = await this.host.showInputBox({
                prompt: useTypedef ? 'Enter NLS key (e.g. "lorem.ipsum.dolor")' : 'Enter NLS key',
                placeHolder: 'section.title',
                validateInput: (v) => !v?.trim() ? 'Key cannot be empty' : null
            });

            if (!key) return;

            let nlsFiles = await this.nlsFinder.findNlsFiles(rootPath);
            if (nlsFiles.length === 0) {
                const newFile = await this.nlsBuilder.createDefaultNlsFile(rootPath);
                nlsFiles = [newFile];
            }

            const { pattern, args } = this.extractTemplate(selectedText);
            for (const file of nlsFiles) {
                await this.nlsBuilder.addKeyToNlsFile(file, key, pattern);
            }

            const replacementText = this.replacer.buildReplacement(useTypedef, key, args);

            const editor = this.documentManager.getActiveTextEditor();
            if (editor?.document === document) {
                await editor.edit(eb => eb.replace(range, replacementText), { undoStopBefore: true, undoStopAfter: true });
            } else {
                this.host.showWarningMessage('Editor focus changed. Please replace manually.');
            }

            if (useTypedef) {
                await this.nlsBuilder.rebuildNlsJs(rootPath);
                const text = this.documentManager.getDocumentText(document);
                const currentDir = path.dirname(document.uri.fsPath);
                let result = await this.jsPatcher.ensureNlsImport(text, currentDir, rootPath);
                if (result !== null) {
                    const inserted = this.documentManager.insertText(document, result.position, result.content);
                    if (!inserted) {
                        this.host.showWarningMessage('Could not add nls import. Please add manually.');
                    }
                }
            }

            this.host.showInformationMessage(`NLS key "${key}" added ${useTypedef ? '(typedef)' : '(string)'}`);
        } catch (err: any) {
            this.host.showErrorMessage(`Error: ${err.message}`);
        }
    }

    private extractTemplate(template: string): { pattern: string; args: string[] } {
        const regex = /\${([^}]+)}/g;
        const args: string[] = [];
        let index = 0;
        const pattern = template.replace(regex, (_, expr) => {
            args.push(expr.trim());
            return `{${index++}}`;
        });
        return { pattern, args };
    }
}

// ====================== CODE ACTION PROVIDER ======================

export class NlsCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {

        if (token.isCancellationRequested) {
            return undefined;
        }

        const selectedText = document.getText(range).trim();
        if (!selectedText) return undefined;

        if (context.only && !context.only.contains(vscode.CodeActionKind.Refactor)) {
            return undefined;
        }

        const stringAction = new vscode.CodeAction('NLS: Create Key-Value (string)', vscode.CodeActionKind.Refactor);
        stringAction.command = {
            command: 'nls_ts.createKeyValueString',
            title: 'NLS: Create Key-Value (string)',
            arguments: [document, range, selectedText]
        };

        const typedefAction = new vscode.CodeAction('NLS: Create Key-Value (typedef)', vscode.CodeActionKind.Refactor);
        typedefAction.command = {
            command: 'nls_ts.createKeyValueTypedef',
            title: 'NLS: Create Key-Value (typedef)',
            arguments: [document, range, selectedText]
        };

        return [stringAction, typedefAction];
    }
}

// ====================== ИНИЦИАЛИЗАЦИЯ ======================

const host = new VsCodeHost();

const nlsService = new NlsService(
    host,
    new VsDocumentManager(),
    new NlsBuilder(),
    new NlsFinder(),
    new JsPatcher(host),
    new CustomNlsReplacer()
);

export const createKeyValueString = (
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string
) => nlsService.createKeyValue(document, range, selectedText, false);

export const createKeyValueTypedef = (
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string
) => nlsService.createKeyValue(document, range, selectedText, true);