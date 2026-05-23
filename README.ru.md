# nls-ts

**Удобный инструмент для работы с локализацией в расширениях VS Code**

Расширение помогает быстро извлекать строки в NLS (Natural Language Support) с автоматическим созданием ключей и поддержкой современного API `vscode.l10n`.

## Возможности

- Два режима извлечения строк:
  - **(string)** — простая строка `vscode.l10n.t('key')`
  - **(typedef)** — типизированная структура через `nls.js` + `vscode.l10n.t(nls.key.subkey)`
- Автоматическое создание и обновление `package.nls.json`
- Автоматическое создание `nls.js` с вложенной объектной структурой (по точкам в ключе)
- Поддержка плейсхолдеров `${variable}` → автоматически преобразуется в `vscode.l10n.t(key, arg1, arg2)`
- Автоматическое добавление `require` для `nls.js`

## Как использовать

1. Выделите текст, который хотите локализовать
2. Нажмите `Ctrl + .` (Quick Fix)
3. Выберите один из вариантов:
   - **NLS: Create Key-Value (string)**
   - **NLS: Create Key-Value (typedef)**

### Пример работы (typedef)

**Выделили:**
```js
"Добро пожаловать, ${userName}!"

**Ввели ключ:** `greeting.welcome`

**Результат: **
```js
const { nls } = require('./nls.js');

vscode.l10n.t(nls.greeting.welcome, userName)
```

А в `nls.js` появится:

```js
const nls = {
  greeting: {
    welcome: "greeting.welcome"
  }
};

module.exports = { nls };
```

## Создаваемые файлы

- `package.nls.json` — основной файл переводов
- `nls.js` — типизированная структура (только при выборе (**typedef**))

## Установка

Установите расширение из VS Code Marketplace

Или склонируйте репозиторий и выполните `npm install && npm run compile`

## Команды

`nls-refactor.createKeyValueString` — создание строкового ключа
`nls-refactor.createKeyValueTypedef` — создание ключа с typedef-структурой

## Рекомендации

Используйте (typedef) режим для больших проектов — удобнее навигация и автодополнение.
Не редактируйте `nls.js` вручную — он автоматически пересобирается при создании новых ключей.

## Лицензия

MIT

**Автор**: paul.yestchick
**Версия**: 0.1.0
