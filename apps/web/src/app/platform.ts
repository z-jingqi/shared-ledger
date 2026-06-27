export function applyPlatformClasses() {
  document.documentElement.classList.toggle("is-ios", isIosDevice());
}

function isIosDevice() {
  const { maxTouchPoints, platform, userAgent } = window.navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
