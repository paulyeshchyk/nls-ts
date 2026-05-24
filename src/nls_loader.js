const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

let currentTranslations = {};

/**
 * Инициализация локализации. Вызывается один раз в методе activate() вашего расширения.
 * @param {vscode.ExtensionContext} context 
 */
function initNls(context) {
    // Получаем текущий язык интерфейса VS Code (например, 'ru', 'en')
    const locale = vscode.env.language; 
    const rootPath = context.extensionPath;
    
    // Пытаемся загрузить файл для текущего языка, иначе берем дефолтный
    let nlsPath = path.join(rootPath, `package.nls.${locale}.json`);
    if (!fs.existsSync(nlsPath)) {
        nlsPath = path.join(rootPath, 'package.nls.json');
    }

    try {
        if (fs.existsSync(nlsPath)) {
            const content = fs.readFileSync(nlsPath, 'utf8');
            currentTranslations = JSON.parse(content);
        }
    } catch (err) {
        console.error('Failed to load NLS file:', err);
    }
}

/**
 * Функция перевода. Она заменяет собой vscode.l10n.t
 * @param {string} key - Абстрактный строковый ключ (например, 'errors.notFound')
 * @param {...any} args - Аргументы для шаблона
 * @returns {string}
 */
function translate(key, ...args) {
    // Получаем строку-шаблон из загруженного JSON по плоскому ключу
    let template = currentTranslations[key] || key;
    
    // Подставляем аргументы {0}, {1} вместо плейсхолдеров
    if (args.length > 0) {
        template = template.replace(/{(\d+)}/g, (match, number) => {
            return typeof args[number] !== 'undefined' ? args[number] : match;
        });
    }
    return template;
}

module.exports = { initNls, translate };