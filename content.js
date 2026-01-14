(() => {
  // ---------- Keys ----------
  const DOT_ID = "bbh-dot";
  const POS_KEY = "bbh_dot_pos_v1";
  const BBH_ENABLED = "bbh_enabled_v1";
  const BBH_GLOBAL = "bbh_global_v1";
  const BBH_PAGE_URL = "bbh_page_url_v1";

  // settings keys are stored by popup.js:
  // inhale, exhale, followPage, ballColor

  // ---------- Safe storage wrappers ----------
  function isContextInvalidated(err) {
    const msg = String(err?.message || err || "");
    return msg.includes("Extension context invalidated");
  }

  async function safeGet(keyOrKeys) {
    try {
      return await chrome.storage.local.get(keyOrKeys);
    } catch (e) {
      if (isContextInvalidated(e)) return null;
      throw e;
    }
  }

  async function safeSet(obj) {
    try {
      await chrome.storage.local.set(obj);
    } catch (e) {
      if (isContextInvalidated(e)) return;
      throw e;
    }
  }

  // ---------- Clean old tooltip (if any from previous versions) ----------
  const oldTip = document.getElementById("bbh-tip");
  if (oldTip) oldTip.remove();

  // ---------- Create / reuse dot ----------
  let dot = document.getElementById(DOT_ID);
  if (!dot) {
    dot = document.createElement("div");
    dot.id = DOT_ID;
    dot.className = "idle hidden";
    dot.innerHTML = `
      <div class="ball">
        <div class="label">呼吸</div>
      </div>
    `;
    document.documentElement.appendChild(dot);
  }

  const ball = dot.querySelector(".ball");
  const label = dot.querySelector(".label");

  // Ensure base CSS vars exist (styles.css will also set defaults)
  dot.style.setProperty("--bbh-color", "#ffffff");
  dot.style.setProperty("--bbh-glow", "rgba(255,255,255,.35)");
  dot.style.setProperty("--bbh-text", "rgba(0,0,0,.70)");

  // ---------- State ----------
  let inhale = 4;
  let exhale = 6;
  let running = false;
  let phaseTimer = null;

  // ---------- Position (drag persist) ----------
  let pos = { right: 18, bottom: 18 };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function applyPos() {
    dot.style.left = "auto";
    dot.style.top = "auto";
    dot.style.right = `${pos.right}px`;
    dot.style.bottom = `${pos.bottom}px`;
  }

  async function loadPos() {
    const data = await safeGet(POS_KEY);
    if (data && data[POS_KEY]) {
      pos.right = Number(data[POS_KEY].right ?? pos.right);
      pos.bottom = Number(data[POS_KEY].bottom ?? pos.bottom);
    }
    pos.right = clamp(pos.right, 0, Math.max(0, window.innerWidth - 72));
    pos.bottom = clamp(pos.bottom, 0, Math.max(0, window.innerHeight - 72));
    applyPos();
  }

  async function savePos() {
    await safeSet({ [POS_KEY]: { right: pos.right, bottom: pos.bottom } });
  }

  loadPos();
  window.addEventListener("resize", () => {
    pos.right = clamp(pos.right, 0, Math.max(0, window.innerWidth - 72));
    pos.bottom = clamp(pos.bottom, 0, Math.max(0, window.innerHeight - 72));
    applyPos();
  });

  // ---------- Visibility ----------
  function setVisible(v) {
    dot.classList.toggle("hidden", !v);
  }

  function clearTimers() {
    if (phaseTimer) clearTimeout(phaseTimer);
    phaseTimer = null;
  }

  // ---------- Color helpers ----------
  function parseColorToRGB(colorStr) {
    // supports #rgb/#rrggbb/rgb(...)
    const el = document.createElement("div");
    el.style.color = colorStr;
    document.documentElement.appendChild(el);
    const rgb = getComputedStyle(el).color;
    el.remove();
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return { r: 255, g: 255, b: 255 };
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  function rgbToHex({ r, g, b }) {
    const to = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function mix(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t)
    };
  }

  function luminance({ r, g, b }) {
    const srgb = [r, g, b]
      .map(v => v / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function pickPageBaseColor() {
    // 1) meta theme-color (很多网站有)
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta?.content) return meta.content;

    // 2) body bg
    const bg1 = getComputedStyle(document.body).backgroundColor;
    if (bg1 && bg1 !== "rgba(0, 0, 0, 0)" && bg1 !== "transparent") return bg1;

    // 3) html bg
    const bg2 = getComputedStyle(document.documentElement).backgroundColor;
    if (bg2 && bg2 !== "rgba(0, 0, 0, 0)" && bg2 !== "transparent") return bg2;

    return "#ffffff";
  }

/**
 * 应用主题样式（颜色适配）
 * @param {Object} opts - 主题配置
 * @param {boolean} opts.followPage - 是否跟随页面背景色
 * @param {string} opts.ballColor - 球体基础颜色
 */
function applyTheme({ followPage, ballColor }) {
  let base = ballColor;

  // 如果开启跟随页面背景色
  if (followPage) {
    // 取body背景色（排除透明情况）
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      base = bg;
    } else {
      // body透明时，取根元素背景色
      const bg2 = getComputedStyle(document.documentElement).backgroundColor;
      base = (bg2 && bg2 !== "rgba(0, 0, 0, 0)" && bg2 !== "transparent") ? bg2 : "#ffffff";
    }
  }

  // 解析基础颜色为RGB
  const rgb = parseColorToRGB(base);
  // 计算亮度
  const L = luminance(rgb);

  // ========== 核心修改：基于原颜色调整明暗，而非混合黑白 ==========
  // 调整系数：可根据需求修改（0.2-0.8之间效果最佳）
  const BRIGHTEN_FACTOR = 0.7; // 深色时提亮的系数（越小提亮越多）
  const DARKEN_FACTOR = 1.3;   // 浅色时加深的系数（越大颜色越深）
  
  let glowRgb;
  if (L < 0.5) {
    // 深色球：将原颜色的RGB值向白色靠近（提亮）
    glowRgb = {
      r: Math.round(Math.min(255, rgb.r / BRIGHTEN_FACTOR)),
      g: Math.round(Math.min(255, rgb.g / BRIGHTEN_FACTOR)),
      b: Math.round(Math.min(255, rgb.b / BRIGHTEN_FACTOR))
    };
  } else {
    // 浅色球：将原颜色的RGB值向黑色靠近（加深）
    glowRgb = {
      r: Math.round(Math.max(0, rgb.r * DARKEN_FACTOR)),
      g: Math.round(Math.max(0, rgb.g * DARKEN_FACTOR)),
      b: Math.round(Math.max(0, rgb.b * DARKEN_FACTOR))
    };
  }
  // ==============================================================

  // 根据亮度确定文字颜色：深色球用白色文字，浅色球用黑色文字
  const text = (L < 0.5) ? "rgba(255,255,255,.80)" : "rgba(0,0,0,.70)";

  // 设置CSS变量，供样式使用
  dot.style.setProperty("--bbh-color", rgbToHex(rgb));
  dot.style.setProperty("--bbh-glow", `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0.55)`);
  dot.style.setProperty("--bbh-text", text);
}

  // ---------- Breathing ----------
  function setPhase(name, seconds) {
    dot.classList.remove("inhale", "exhale", "idle");
    ball.style.transitionDuration = `${Math.max(0.2, seconds)}s`;

    if (name === "inhale") {
      dot.classList.add("inhale");
      label.textContent = "吸气";
    } else if (name === "exhale") {
      dot.classList.add("exhale");
      label.textContent = "呼气";
    } else {
      dot.classList.add("idle");
      label.textContent = "呼吸";
    }
  }

  function loop() {
    if (!running) return;

    setPhase("inhale", inhale);
    phaseTimer = setTimeout(() => {
      if (!running) return;

      setPhase("exhale", exhale);
      phaseTimer = setTimeout(() => {
        if (!running) return;
        loop();
      }, exhale * 1000);
    }, inhale * 1000);
  }

  function start(opts = {}) {
    inhale = Math.max(1, Number(opts.inhale ?? inhale));
    exhale = Math.max(1, Number(opts.exhale ?? exhale));

    applyTheme({
      followPage: !!opts.followPage,
      ballColor: opts.ballColor || "#ffffff"
    });

    running = true;
    clearTimers();
    setVisible(true);
    loop();
  }

  function stop() {
    running = false;
    clearTimers();
    setPhase("idle", 0.6);
    setVisible(false);
  }

  // ---------- Drag ----------
  let dragging = false;
  let dragMoved = false;
  let startX = 0, startY = 0;
  let startRight = pos.right, startBottom = pos.bottom;
  const DRAG_THRESHOLD = 4;

  dot.addEventListener("mousedown", (e) => {
    if (dot.classList.contains("hidden")) return;
    dragging = true;
    dragMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    startRight = pos.right;
    startBottom = pos.bottom;
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;

    pos.right = clamp(startRight - dx, 0, Math.max(0, window.innerWidth - 72));
    pos.bottom = clamp(startBottom - dy, 0, Math.max(0, window.innerHeight - 72));
    applyPos();
  });

  window.addEventListener("mouseup", async () => {
    if (!dragging) return;
    dragging = false;
    if (dragMoved) await savePos();
  });

  // ---------- Apply from storage (global enable + settings) ----------
  async function applyFromStorage() {
  const data = await safeGet([BBH_ENABLED, BBH_GLOBAL, BBH_PAGE_URL, "inhale", "exhale", "followPage", "ballColor"]);
  if (!data) return;

  const enabled = !!data[BBH_ENABLED];
  if (!enabled) {
    stop();
    return;
  }

  const globalMode = (data[BBH_GLOBAL] ?? true) === true;

  // 仅当前网页：必须 URL 精确匹配
  if (!globalMode) {
    const pageUrl = String(data[BBH_PAGE_URL] || "");
    if (pageUrl !== location.href) {
      stop();
      return;
    }
  }

  start({
    inhale: data.inhale ?? 4,
    exhale: data.exhale ?? 6,
    followPage: data.followPage ?? true,
    ballColor: data.ballColor ?? "#ffffff"
  });
}


  // initial apply
  applyFromStorage();

  // sync across all pages when user changes popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (
      changes[BBH_ENABLED] ||
      changes.inhale ||
      changes.exhale ||
      changes.followPage ||
      changes.ballColor
    ) {
      applyFromStorage();
    }
  });

  // ---------- Messages from popup (optional immediate response on current tab) ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.cmd) return;

  if (msg.cmd === "SHOW") {
    const globalMode = !!msg.globalMode;

    // 开启标记 + 范围标记
    safeSet({ [BBH_ENABLED]: true, [BBH_GLOBAL]: globalMode });

    // 如果仅当前网页：绑定当前页面 URL（不需要 popup 读取 tab.url）
    if (!globalMode) {
      safeSet({ [BBH_PAGE_URL]: location.href });
    }

    start(msg);
  }

  if (msg.cmd === "HIDE") {
    safeSet({ [BBH_ENABLED]: false });
    stop();
  }
});

})();
