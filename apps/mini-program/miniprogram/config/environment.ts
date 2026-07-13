export const origins = {
  develop: "https://dev.leger.aleph-cat.com/api",
  trial: "https://dev.leger.aleph-cat.com/api",
  release: "https://leger.aleph-cat.com/api",
};

export function apiOrigin() {
  try {
    const account = wx.getAccountInfoSync();
    const version = account && account.miniProgram && account.miniProgram.envVersion;
    return origins[version] || origins.develop;
  } catch {
    return origins.develop;
  }
}
