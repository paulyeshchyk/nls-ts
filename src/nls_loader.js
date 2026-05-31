// nls_loader.js

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
    template = template.replace(/\{(\d+)\}/g, (match, number) => {
      const index = parseInt(number, 10);
      return typeof args[index] !== "undefined" ? String(args[index]) : match;
    });
  }
  return template;
}

module.exports = { initNls, translate };