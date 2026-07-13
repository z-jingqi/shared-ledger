import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "node:test";

test("all native runtime sources use TypeScript", () => {
  const files = walk(new URL("../miniprogram/", import.meta.url));
  assert.equal(files.filter((path) => path.endsWith(".js")).length, 0);
  assert.ok(files.some((path) => path.endsWith("app.ts")));
});

test("analysis page starts from the current week", () => {
  const source = readFileSync(new URL("../miniprogram/pages/analysis/index.ts", import.meta.url), "utf8");
  assert.match(source, /range:\s*"week"/);
});

test("environment resolver separates preview and production", () => {
  const source = readFileSync(new URL("../miniprogram/config/environment.ts", import.meta.url), "utf8");
  assert.match(source, /develop:\s*"https:\/\/dev\.leger\.aleph-cat\.com\/api"/);
  assert.match(source, /release:\s*"https:\/\/leger\.aleph-cat\.com\/api"/);
});

test("uses WeChat login while keeping the four main tabs available to guests", () => {
  const sessionSource = readFileSync(new URL("../miniprogram/services/session.ts", import.meta.url), "utf8");
  assert.match(sessionSource, /wx\.login\(/);
  assert.match(sessionSource, /auth\/wechat\/session/);
  assert.match(sessionSource, /optionalSession/);
  assert.doesNotMatch(sessionSource, /auth\/login/);

  const loginTemplate = readFileSync(
    new URL("../miniprogram/pages/login/index.wxml", import.meta.url),
    "utf8",
  );
  assert.match(loginTemplate, /微信一键登录/);
  assert.doesNotMatch(loginTemplate, /用户名|密码/);

  const appConfig = JSON.parse(readFileSync(new URL("../miniprogram/app.json", import.meta.url), "utf8"));
  const tabPages = appConfig.tabBar.list.map((item) => item.pagePath);
  assert.equal(tabPages.length, 4);
  assert.ok(!tabPages.includes("pages/login/index"));

  for (const page of ["home", "records", "analysis", "settings"]) {
    const source = readFileSync(new URL(`../miniprogram/pages/${page}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /optionalSession/);
    assert.doesNotMatch(source, /reLaunch\(\{ url: "\/pages\/login\/index"/);
  }
});

test("native app does not depend on a cross-platform framework", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies, undefined);
});

function walk(directoryUrl) {
  const directory = decodeURIComponent(directoryUrl.pathname).replace(/^\/(.:\/)/, "$1");
  return readdirSync(directory).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    return statSync(path).isDirectory() ? walk(new URL(`${entry}/`, directoryUrl)) : [path];
  });
}
