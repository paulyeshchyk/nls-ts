# nls-ts

**Tool for working with localization in VS Code extensions**

This extension helps you quickly extract strings for NLS (Natural Language Support) with automatic key creation and support for the modern `vscode.l10n` API.

## Features

- Two modes for string extraction:
  - **(string)** — simple string using `vscode.l10n.t('key')`
  - **(typedef)** — typed structure via `nls.js` + `vscode.l10n.t(nls.key.subkey)`
- Automatic creation and updating of `package.nls.json`
- Automatic generation of `nls.js` with nested object structure based on dot notation
- Support for placeholders `${variable}` — automatically converted to `vscode.l10n.t(key, arg1, arg2)`
- Automatic addition of `require` statement for `nls.js`

## How to Use

1. Select the text you want to localize
2. Press `Ctrl + .` (Quick Fix)
3. Choose one of the options:
   - **NLS: Create Key-Value (string)**
   - **NLS: Create Key-Value (typedef)**

### Example (typedef mode)

Select the text:  
"Welcome, ${userName}!"

Enter the key: `greeting.welcome`

Result:  

```js
const { nls } = require('./nls.js');

vscode.l10n.t(nls.greeting.welcome, userName)
```

And in `nls.js` you will get:

```js
const nls = {
  greeting: {
    welcome: "greeting.welcome"
  }
};

module.exports = { nls };
```

## Created Files

- `package.nls.json` — main translation file
- `nls.js` — typed structure (created only when using **(typedef)** mode)

## Installation

Install the extension from the VS Code Marketplace

Or clone the repository and run:  
`npm install && npm run compile`

## Commands

- `nls-refactor.createKeyValueString` — create string key
- `nls-refactor.createKeyValueTypedef` — create key with typedef structure

## Recommendations

Use **(typedef)** mode for large projects — it provides better navigation and autocompletion.  
Do not edit `nls.js` manually — it is automatically regenerated when new keys are added.

## License

MIT

**Author**: paul.yestchick  
**Version**: 0.1.0