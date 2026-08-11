const productionSiteKey = __TURNSTILE_SITE_KEY__;
const localTestSiteKey = "1x00000000000000000000AA";
const siteKey = productionSiteKey || (["localhost", "127.0.0.1"].includes(location.hostname) ? localTestSiteKey : "");
const widgets = new WeakMap();
let loader = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error("无法加载人机验证，请检查网络后重试。"));
    document.head.append(script);
  });
  return loader;
}

export async function mountTurnstile(element, action) {
  if (!element) return;
  if (!siteKey) throw new Error("网站尚未配置人机验证。请联系管理员。");
  const api = await loadTurnstile();
  const existing = widgets.get(element);
  if (existing !== undefined) {
    element.dataset.turnstileToken = "";
    api.reset(existing);
    return;
  }
  const widgetId = api.render(element, {
    sitekey: siteKey,
    action,
    theme: "light",
    callback: (token) => { element.dataset.turnstileToken = token; },
    "expired-callback": () => { element.dataset.turnstileToken = ""; },
    "error-callback": () => { element.dataset.turnstileToken = ""; }
  });
  widgets.set(element, widgetId);
}

export function turnstileToken(element) {
  return element?.dataset.turnstileToken || "";
}

export function resetTurnstile(element) {
  const widgetId = widgets.get(element);
  element?.removeAttribute("data-turnstile-token");
  if (widgetId !== undefined && window.turnstile) window.turnstile.reset(widgetId);
}
