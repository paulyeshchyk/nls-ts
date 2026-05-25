const { nls_ts, translate } = require("../nls_ts.js");
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as template from "./nls_loader_template";

/** Константы */
export const NLS_OBJECT_NAME = "nls_ts";
export const NLS_JS_NAME = "nls_ts.js";

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
  insertText(
    document: vscode.TextDocument,
    position: vscode.Position,
    content: string,
  ): Promise<boolean>;
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
  ensureNlsImport(
    text: string,
    currentDir: string,
    rootPath: string,
  ): Promise<{ position: vscode.Position; content: string } | null>;
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
    content: string,
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
      .filter(
        (e) =>
          e.isFile() &&
          e.name.startsWith("package.nls") &&
          e.name.endsWith(".json"),
      )
      .map((e) => path.join(rootPath, e.name));
  }
}

export class NlsBuilder implements INlsBuilder {
  async createDefaultNlsFile(rootPath: string): Promise<string> {
    const defaultPath = path.join(rootPath, "package.nls.json");
    await fs.writeFile(defaultPath, JSON.stringify({}, null, 2), "utf-8");
    return defaultPath;
  }

  async addKeyToNlsFile(
    filePath: string,
    key: string,
    value: string,
  ): Promise<void> {
    let content = "{}";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {}

    const json = JSON.parse(content) as Record<string, string>;
    json[key] = value;

    await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf-8");
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
    const packageNlsPath = path.join(rootPath, "package.nls.json");
    let allKeys: Record<string, string> = {};
    try {
      allKeys = JSON.parse(await fs.readFile(packageNlsPath, "utf-8"));
    } catch {
      await this.createDefaultNlsFile(rootPath);
      allKeys = {};
    }

    const nlsObject: any = {};
    for (const key of Object.keys(allKeys)) {
      try {
        this.setNestedValue(nlsObject, key.split("."), key);
      } catch (err) {
        let msg = err instanceof Error ? err.message : "${err}";
        console.error(msg);
      }
    }

    let jsonStr = JSON.stringify(nlsObject, null, 2);
    // Убираем кавычки у валидных идентификаторов свойств
    jsonStr = jsonStr.replace(/"([a-zA-Z_$][a-zA-Z0-9_$]*)":/g, "$1:");

    // Модифицированный шаблон содержимого файла nls_ts.js
    const jsContent =
      `// Auto-generated by NLS Refactor. Do not edit manually.\n` +
      `const { translate } = require('./nls_loader');\n\n` +
      `const ${NLS_OBJECT_NAME} = ${jsonStr};\n\n` +
      `module.exports = { ${NLS_OBJECT_NAME}, translate };`;

    await fs.writeFile(path.join(rootPath, NLS_JS_NAME), jsContent, "utf-8");
  }

  async ensureNlsLoader(rootPath: string): Promise<void> {
    const loaderPath = path.join(rootPath, "nls_loader.js");

    try {
      // Проверяем, существует ли файл. Если существует, метод выполнится успешно.
      await fs.access(loaderPath);
    } catch {
      // Если файла нет, fs.access бросит исключение, и мы создаем файл из константы
      await fs.writeFile(loaderPath, template.NLS_LOADER_TEMPLATE, "utf-8");
    }
  }
}

export class JsPatcher implements IJsPatcher {
  constructor(private readonly host: IHost) {}

  async ensureNlsImport(
    text: string,
    currentDir: string,
    rootPath: string,
  ): Promise<{ position: vscode.Position; content: string } | null> {
    // Регулярное выражение теперь ищет импорт, содержащий и nls_ts, и translate
    const regex = new RegExp(
      `const\\s*\\{\\s*${NLS_OBJECT_NAME},\\s*translate\\s*\\}\\s*=\\s*require\\(`,
    );
    if (regex.test(text)) {
      return null;
    }

    let relativePath = path.relative(
      currentDir,
      path.join(rootPath, NLS_JS_NAME),
    );
    relativePath = relativePath.replace(/\\/g, "/");
    if (!relativePath.startsWith(".")) relativePath = "./" + relativePath;

    // Формируем чистую строку импорта двух сущностей из одного файла
    const requireStatement = `const { ${NLS_OBJECT_NAME}, translate } = require('${relativePath}');\n`;
    const insertLine = text.startsWith("#!") ? 1 : 0;

    return {
      position: new vscode.Position(insertLine, 0),
      content: requireStatement,
    };
  }
}

export class CustomNlsReplacer implements INlsReplacer {
  buildReplacement(useTypedef: boolean, key: string, args: string[]): string {
    if (useTypedef) {
      return args.length === 0
        ? `translate(${NLS_OBJECT_NAME}.${key})`
        : `translate(${NLS_OBJECT_NAME}.${key}, ${args.join(", ")})`;
    }
    return args.length === 0
      ? `translate('${key}')`
      : `translate('${key}', ${args.join(", ")})`;
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
    private readonly replacer: INlsReplacer,
  ) {}

  async createKeyValue(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string,
    useTypedef: boolean,
  ) {
    try {
      const rootPath = this.documentManager.getRootPath();
      if (!rootPath)
        throw new Error(
          translate(nls_ts.nlsService.key.create.error.workspacenotfound),
        );

      // --- проверка существования nls_loader.js (первый запуск) ---
      const loaderPath = path.join(rootPath, "nls_loader.js");
      let isFirstRun = false;
      try {
        await fs.access(loaderPath);
      } catch {
        isFirstRun = true;
      }
      if (isFirstRun) {
        const choice = await vscode.window.showInformationMessage(
          translate(nls_ts.nlsService.key.create.firsttime.info.title),
          translate(nls_ts.nlsService.key.create.firsttime.info.yes),
          translate(nls_ts.nlsService.key.create.firsttime.info.cancel),
        );
        if (
          choice !== translate(nls_ts.nlsService.key.create.firsttime.info.yes)
        )
          return;
        await this.nlsBuilder.ensureNlsLoader(rootPath);
      }

      const key = await this.host.showInputBox({
        prompt: useTypedef
          ? translate(nls_ts.nlsService.key.create.input.prompt.typedef)
          : translate(nls_ts.nlsService.key.create.input.prompt.string),
        placeHolder: translate(nls_ts.nlsService.key.create.input.prompt.title),
        validateInput: (v) => (!v?.trim() ? "Key cannot be empty" : null),
      });
      if (!key) return;

      const canAdd = await this.checkPrefixCollision(rootPath, key);
      if (!canAdd) {
        this.host.showErrorMessage(
          translate(nls_ts.nlsService.key.create.collision.message, key),
        );
        return;
      }

      let nlsFiles = await this.nlsFinder.findNlsFiles(rootPath);
      if (nlsFiles.length === 0) {
        const newFile = await this.nlsBuilder.createDefaultNlsFile(rootPath);
        nlsFiles = [newFile];
      }

      const { pattern, args } = this.extractTemplate(selectedText);
      for (const file of nlsFiles) {
        await this.nlsBuilder.addKeyToNlsFile(file, key, pattern);
      }

      const replacementText = this.replacer.buildReplacement(
        useTypedef,
        key,
        args,
      );
      const editor = this.documentManager.getActiveTextEditor();
      if (editor?.document === document) {
        await editor.edit((eb) => eb.replace(range, replacementText), {
          undoStopBefore: true,
          undoStopAfter: true,
        });
      } else {
        this.host.showWarningMessage(
          translate(nls_ts.nlsService.key.create.editorfocuschanged.warning),
        );
      }

      await this.nlsBuilder.rebuildNlsJs(rootPath);
      const text = this.documentManager.getDocumentText(document);
      const currentDir = path.dirname(document.uri.fsPath);
      let result = await this.jsPatcher.ensureNlsImport(
        text,
        currentDir,
        rootPath,
      );
      if (result !== null) {
        const inserted = await this.documentManager.insertText(
          document,
          result.position,
          result.content,
        );
        if (!inserted)
          this.host.showWarningMessage(
            translate(nls_ts.nlsService.key.create.warning.notinserted),
          );
      }

      this.host.showInformationMessage(
        translate(
          nls_ts.nlsService.key.create.info.success,
          key,
          useTypedef ? "(typedef)" : "(string)",
        ),
      );
    } catch (err: any) {
      this.host.showErrorMessage(
        translate(nls_ts.nlsService.key.create.error.critical, err.message),
      );
    }
  }

  private async checkPrefixCollision(
    rootPath: string,
    newKey: string,
  ): Promise<boolean> {
    const nlsFiles = await this.nlsFinder.findNlsFiles(rootPath);
    const allKeys = new Set<string>();

    for (const file of nlsFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const json = JSON.parse(content) as Record<string, string>;
        Object.keys(json).forEach((k) => allKeys.add(k));
      } catch {
        /* ignore */
      }
    }

    for (const existingKey of allKeys) {
      if (
        newKey.startsWith(existingKey + ".") ||
        existingKey.startsWith(newKey + ".")
      ) {
        return false;
      }
    }
    return true;
  }

  private extractTemplate(template: string): {
    pattern: string;
    args: string[];
  } {
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
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.Refactor,
  ];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const selectedText = document.getText(range).trim();
    if (!selectedText) return undefined;

    if (
      context.only &&
      !context.only.contains(vscode.CodeActionKind.Refactor)
    ) {
      return undefined;
    }

    const stringAction = new vscode.CodeAction(
      translate(nls_ts.nls.action.string.title),
      vscode.CodeActionKind.Refactor,
    );
    stringAction.command = {
      command: "nls_ts.createKeyValueString",
      title: translate(nls_ts.nls.command.string.title),
      arguments: [document, range, selectedText],
    };

    const typedefAction = new vscode.CodeAction(
      translate(nls_ts.nls.action.typedef.title),
      vscode.CodeActionKind.Refactor,
    );
    typedefAction.command = {
      command: "nls_ts.createKeyValueTypedef",
      title: translate(nls_ts.nls.command.typedef.title),
      arguments: [document, range, selectedText],
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
  new CustomNlsReplacer(),
);

export const createKeyValueString = (
  document: vscode.TextDocument,
  range: vscode.Range,
  selectedText: string,
) => nlsService.createKeyValue(document, range, selectedText, false);

export const createKeyValueTypedef = (
  document: vscode.TextDocument,
  range: vscode.Range,
  selectedText: string,
) => nlsService.createKeyValue(document, range, selectedText, true);
