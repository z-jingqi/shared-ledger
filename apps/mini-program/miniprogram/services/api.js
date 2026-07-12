const SESSION_KEY = "shared-ledger:mini-cookie";
let refreshPromise = null;

function apiOrigin() {
  return getApp().globalData.apiOrigin;
}

function storedCookie() {
  return wx.getStorageSync(SESSION_KEY) || "";
}

function persistCookie(headers) {
  const raw = headers && (headers["Set-Cookie"] || headers["set-cookie"]);
  if (!raw) return;
  const values = Array.isArray(raw) ? raw : String(raw).split(/,(?=[^;,]+=[^;,]+)/);
  const next = values
    .map((value) => String(value).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  if (next) wx.setStorageSync(SESSION_KEY, next);
}

function rawRequest(options) {
  return new Promise((resolve, reject) => {
    const header = Object.assign({ Accept: "application/json" }, options.header || {});
    const cookie = storedCookie();
    if (cookie) header.Cookie = cookie;
    wx.request({
      url: `${apiOrigin()}${options.path}`,
      method: options.method || "GET",
      data: options.data,
      header,
      timeout: options.timeout || 20000,
      success(response) {
        persistCookie(response.header);
        resolve(response);
      },
      fail: reject,
    });
  });
}

async function refresh() {
  if (!refreshPromise) {
    refreshPromise = rawRequest({ path: "/auth/refresh", method: "POST" })
      .then((response) => response.statusCode === 204)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(options) {
  let response = await rawRequest(options);
  if (response.statusCode === 401 && options.auth !== false && options.path !== "/auth/refresh") {
    const renewed = await refresh();
    if (renewed) response = await rawRequest(options);
  }
  if (response.statusCode >= 200 && response.statusCode < 300) return response.data;
  const message =
    (response.data && (response.data.error || response.data.message)) || `请求失败（${response.statusCode}）`;
  const error = new Error(message);
  error.statusCode = response.statusCode;
  throw error;
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
}

function upload(options) {
  if (options.method && options.method !== "POST") return uploadWithRequest(options);
  return new Promise((resolve, reject) => {
    const header = {};
    const cookie = storedCookie();
    if (cookie) header.Cookie = cookie;
    wx.uploadFile({
      url: `${apiOrigin()}${options.path}`,
      filePath: options.filePath,
      name: options.name || "file",
      formData: options.formData || {},
      header,
      timeout: 60000,
      success(response) {
        persistCookie(response.header);
        let data = response.data;
        try {
          data = JSON.parse(response.data);
        } catch {}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
        else
          reject(
            Object.assign(new Error((data && (data.error || data.message)) || "上传失败"), {
              statusCode: response.statusCode,
            }),
          );
      },
      fail: reject,
    });
  });
}

function uploadWithRequest(options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: options.filePath,
      success(file) {
        const boundary = `ledger-${Date.now().toString(16)}`;
        const name = options.name || "file";
        const filename = options.filename || "upload.jpg";
        const prefix = encodeUtf8(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        );
        const suffix = encodeUtf8(`\r\n--${boundary}--\r\n`);
        const bytes = new Uint8Array(file.data);
        const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
        body.set(prefix, 0);
        body.set(bytes, prefix.length);
        body.set(suffix, prefix.length + bytes.length);
        const header = { "Content-Type": `multipart/form-data; boundary=${boundary}` };
        const cookie = storedCookie();
        if (cookie) header.Cookie = cookie;
        wx.request({
          url: `${apiOrigin()}${options.path}`,
          method: options.method,
          data: body.buffer,
          header,
          timeout: 60000,
          success(response) {
            persistCookie(response.header);
            if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
            else
              reject(
                Object.assign(
                  new Error((response.data && (response.data.error || response.data.message)) || "上传失败"),
                  { statusCode: response.statusCode },
                ),
              );
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

function encodeUtf8(value) {
  const encoded = unescape(encodeURIComponent(value));
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

module.exports = { clearSession, request, rawRequest, upload };
