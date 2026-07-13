const SESSION_KEY = "shared-ledger:mini-session";
let refreshPromise: Promise<boolean> | null = null;

type JsonObject = Record<string, unknown>;

function apiOrigin() {
  return getApp<IAppOption>().globalData.apiOrigin;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

function storedSession(): StoredSession | null {
  const value = wx.getStorageSync(SESSION_KEY) as StoredSession | string | undefined;
  return value && typeof value === "object" && value.accessToken && value.refreshToken ? value : null;
}

export function storeSession(tokens: StoredSession) {
  wx.setStorageSync(SESSION_KEY, tokens);
}

export function rawRequest<T extends string | JsonObject | ArrayBuffer = JsonObject>(
  options: ApiRequestOptions,
) {
  return new Promise<WechatMiniprogram.RequestSuccessCallbackResult<T>>((resolve, reject) => {
    const header: Record<string, string> = {
      Accept: "application/json",
      ...(options.header || {}),
    };
    const session = storedSession();
    if (options.auth !== false && session?.accessToken) {
      header.Authorization = `Bearer ${session.accessToken}`;
    }
    wx.request<T>({
      url: `${apiOrigin()}${options.path}`,
      method: (options.method || "GET") as WechatMiniprogram.RequestOption["method"],
      data: options.data as WechatMiniprogram.IAnyObject | string | ArrayBuffer | undefined,
      header,
      timeout: options.timeout || 20000,
      success(response) {
        resolve(response);
      },
      fail: reject,
    });
  });
}

async function refresh() {
  if (!refreshPromise) {
    const session = storedSession();
    if (!session?.refreshToken) return false;
    refreshPromise = rawRequest<{ accessToken: string; refreshToken: string }>({
      path: "/auth/refresh",
      method: "POST",
      auth: false,
      header: { "Content-Type": "application/json" },
      data: { refreshToken: session.refreshToken },
    })
      .then((response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) return false;
        storeSession(response.data);
        return true;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function request<T extends JsonObject = JsonObject>(options: ApiRequestOptions) {
  let response = await rawRequest<T>(options);
  if (response.statusCode === 401 && options.auth !== false && options.path !== "/auth/refresh") {
    const renewed = await refresh();
    if (renewed) response = await rawRequest<T>(options);
  }
  if (response.statusCode >= 200 && response.statusCode < 300) return response.data;
  throw apiError(response.data, response.statusCode);
}

export function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
}

export function storedRefreshToken() {
  return storedSession()?.refreshToken;
}

export function upload<T extends JsonObject = JsonObject>(options: ApiUploadOptions) {
  if (options.method && options.method !== "POST") return uploadWithRequest<T>(options);
  return new Promise<T>((resolve, reject) => {
    const header: Record<string, string> = {};
    const session = storedSession();
    if (session?.accessToken) header.Authorization = `Bearer ${session.accessToken}`;
    wx.uploadFile({
      url: `${apiOrigin()}${options.path}`,
      filePath: options.filePath,
      name: options.name || "file",
      formData: options.formData || {},
      header,
      timeout: 60000,
      success(response) {
        let data: unknown = response.data;
        try {
          data = JSON.parse(response.data);
        } catch {
          // Preserve non-JSON server responses for the error message below.
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data as T);
        else reject(apiError(data, response.statusCode, "上传失败"));
      },
      fail: reject,
    });
  });
}

function uploadWithRequest<T extends JsonObject>(options: ApiUploadOptions) {
  return new Promise<T>((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: options.filePath,
      success(file) {
        if (typeof file.data === "string") {
          reject(new Error("头像文件读取失败"));
          return;
        }
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
        const header: Record<string, string> = {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        };
        const session = storedSession();
        if (session?.accessToken) header.Authorization = `Bearer ${session.accessToken}`;
        wx.request<T>({
          url: `${apiOrigin()}${options.path}`,
          method: options.method,
          data: body.buffer,
          header,
          timeout: 60000,
          success(response) {
            if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
            else reject(apiError(response.data, response.statusCode, "上传失败"));
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

function apiError(data: unknown, statusCode: number, fallback?: string): ApiError {
  const body = data && typeof data === "object" ? (data as JsonObject) : undefined;
  const message =
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.message === "string" && body.message) ||
    fallback ||
    `请求失败（${statusCode}）`;
  return Object.assign(new Error(message), { statusCode });
}

function encodeUtf8(value: string) {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff)
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    else
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
}
