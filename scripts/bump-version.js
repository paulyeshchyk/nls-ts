// scripts/bump-version.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Определяем корень проекта (папка на уровень выше scripts)
const projectRoot = path.resolve(__dirname, "..");

// 1. Увеличиваем версию в package.json (находится в корне)
const pkgPath = path.join(projectRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const parts = pkg.version.split(".");
parts[2] = parseInt(parts[2], 10) + 1;
const newVersion = parts.join(".");
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log(`Version bumped to ${newVersion}`);

// 2. Сборка VSIX в папку build (в корне проекта)
const outDir = path.join(projectRoot, "build");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${pkg.name}-${newVersion}.vsix`);

// Запускаем vsce из корня проекта, чтобы он видел все файлы расширения
execSync(`vsce package --out "${outFile}" --allow-missing-repository`, {
  stdio: "inherit",
  cwd: projectRoot,
});
