const DEFAULTS = { inhale: 4, exhale: 6, followPage: true, ballColor: "#ffffff" };
const BBH_ENABLED = "bbh_enabled_v1";
const BBH_GLOBAL = "bbh_global_v1"; // true=所有网页；false=仅当前网页
const BBH_PAGE_URL = "bbh_page_url_v1"; // 仅当前网页时绑定的 URL

const inhaleEl = document.getElementById("inhale");
const exhaleEl = document.getElementById("exhale");
const followEl = document.getElementById("followPage");
const colorEl = document.getElementById("ballColor");
const globalEl = document.getElementById("globalMode");

const showBtn = document.getElementById("show");
const hideBtn = document.getElementById("hide");
const msgEl = document.getElementById("msg");

function setMsg(t) { msgEl.textContent = t || ""; }

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function syncColorEnabled() {
  colorEl.disabled = followEl.checked;
  colorEl.style.opacity = followEl.checked ? "0.5" : "1";
}

async function loadSettings() {
  const data = await chrome.storage.local.get({
    inhale: 4,
    exhale: 6,
    followPage: true,
    ballColor: "#ffffff",
    [BBH_GLOBAL]: true,
    [BBH_ENABLED]: false
    });

  globalEl.checked = !!data[BBH_GLOBAL];
  inhaleEl.value = data.inhale;
  exhaleEl.value = data.exhale;
  followEl.checked = !!data.followPage;
  colorEl.value = data.ballColor || "#ffffff";
  syncColorEnabled();

  setMsg('正常吸气4s呼气6s.................紧张吸气4s呼气7s');
}

async function saveSettings() {
  const inhale = clampInt(inhaleEl.value, 1, 20, DEFAULTS.inhale);
  const exhale = clampInt(exhaleEl.value, 1, 20, DEFAULTS.exhale);
  const followPage = !!followEl.checked;
  const ballColor = String(colorEl.value || DEFAULTS.ballColor);
  const globalMode = !!globalEl.checked;
  await chrome.storage.local.set({ inhale, exhale, followPage, ballColor, [BBH_GLOBAL]: globalMode });  
  return { inhale, exhale, followPage, ballColor, globalMode };

}

async function sendToActiveTab(cmd, payload = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { cmd, ...payload });
  } catch {
    // 有些页面不允许content script（例如 chrome web store / 新标签页等），忽略即可
  }
}

showBtn.addEventListener("click", async () => {
  const settings = await saveSettings();

  await chrome.storage.local.set({ [BBH_ENABLED]: true });

  // 让当前页立刻生效；若是“仅当前网页”，由 content.js 记录 location.href 到 BBH_PAGE_URL
  await sendToActiveTab("SHOW", settings);

  setMsg(settings.globalMode ? "已开启：所有网页都会显示" : "已开启：仅当前网页显示");
});


hideBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [BBH_ENABLED]: false });
  await sendToActiveTab("HIDE");
  setMsg("已关闭");
});


[inhaleEl, exhaleEl, followEl, colorEl].forEach(el => {
  el.addEventListener("change", async () => {
    if (el === followEl) syncColorEnabled();
    await saveSettings();

    // 如果当前全局是开启状态，改参数时让当前页立刻更新
    const data = await chrome.storage.local.get(BBH_ENABLED);
    if (data[BBH_ENABLED]) {
      const settings = await chrome.storage.local.get(DEFAULTS);
      await sendToActiveTab("SHOW", settings);
    }
  });
});

loadSettings();
