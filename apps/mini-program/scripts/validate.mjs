import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../miniprogram/", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(.:\/)/, "$1");
const app = JSON.parse(readFileSync(join(rootPath, "app.json"), "utf8"));
const failures = [];
const nativeTags = new Set([
  "block",
  "button",
  "image",
  "input",
  "label",
  "picker",
  "scroll-view",
  "text",
  "textarea",
  "view",
]);

for (const page of app.pages) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    const path = join(rootPath, `${page}.${extension}`);
    if (!existsSync(path)) failures.push(`缺少页面文件：${relative(rootPath, path)}`);
  }
}

for (const path of walk(rootPath)) {
  const extension = path.split(".").pop();
  const source = readFileSync(path, "utf8");
  if (extension === "json") {
    try {
      JSON.parse(source);
    } catch (error) {
      failures.push(`${relative(rootPath, path)} JSON 无效：${error.message}`);
    }
  }
  if (extension === "js") {
    try {
      new Function(source);
    } catch (error) {
      failures.push(`${relative(rootPath, path)} JavaScript 无效：${error.message}`);
    }
  }
  if (["js", "wxml", "wxss"].includes(extension) && /\b(Taro|React|react-router|WebView)\b/.test(source)) {
    failures.push(`${relative(rootPath, path)} 引入了非原生运行时`);
  }
  if (extension === "wxml" && /\{\{[^}]*\.[A-Za-z_$][\w$]*\s*\(/.test(source)) {
    failures.push(`${relative(rootPath, path)} 在模板表达式中调用了方法`);
  }
  if (extension === "wxml") {
    const components = new Set(Object.keys(readPageComponents(path)));
    const tags = [...source.matchAll(/<\/?([a-z][a-z0-9-]*)\b/g)].map((match) => match[1]);
    for (const tag of tags) {
      if (!nativeTags.has(tag) && !components.has(tag)) {
        failures.push(`${relative(rootPath, path)} 使用了未声明的组件：${tag}`);
      }
    }
  }
}

if (!app.tabBar || app.tabBar.custom !== true || app.tabBar.list.length !== 4) {
  failures.push("app.json 必须配置四个原生自定义 Tab");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`原生小程序结构检查通过：${app.pages.length} 个页面。`);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readPageComponents(wxmlPath) {
  const jsonPath = wxmlPath.replace(/\.wxml$/, ".json");
  if (!existsSync(jsonPath)) return {};
  const config = JSON.parse(readFileSync(jsonPath, "utf8"));
  return config.usingComponents || {};
}
