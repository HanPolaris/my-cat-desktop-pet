interface Window {
  xiaomi: {
    send: (type: string, value?: unknown) => void;
    on: (f: (x: any) => void) => void;
    assets: string;
  };
}
const canvas = document.getElementById("pet") as HTMLCanvasElement,
  ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const cardEl = document.getElementById("quota")!,
  bodyEl = document.getElementById("quota-body")!;
let manifest: any = null;
const images = new Map<string, HTMLImageElement>();
let mode = "idle",
  previousMode = "",
  modeAt = performance.now(),
  clipId = "",
  clipAt = performance.now(),
  cursor = { x: 300, y: 400 },
  pet = { x: 300, y: 400 },
  cardOpen = false,
  held = false,
  lastHit = false,
  suspended = false;
const base = window.xiaomi.assets;
let playBounds = { left: 96, right: 504, top: 104, bottom: 546 };
const sound = new Audio(base + "audio/meow.wav");
let soundAvailable = false;
fetch(base + "audio/status.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => {
    soundAvailable = s?.available === true;
    document.getElementById("audio-state")!.textContent = soundAvailable
      ? s.label || "猫叫音效"
      : "猫叫待补充录音";
  })
  .catch(() => {
    document.getElementById("audio-state")!.textContent = "猫叫待补充录音";
  });
fetch(base + "animations.json")
  .then((r) => r.json())
  .then(async (m) => {
    manifest = m;
    await Promise.all(
      Object.values(m.animations).map(async (a: any) => {
        if (images.has(a.file)) return;
        const img = new Image();
        images.set(a.file, img);
        img.src = base + a.file;
        await img.decode().catch(() => {});
      }),
    );
  })
  .catch(() => {});
function node(tag: string, text: string, className = "") {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
}
function showQuota(q: any) {
  bodyEl.replaceChildren();
  for (const [key, label] of [
    ["short", "5 小时额度"],
    ["week", "周额度"],
  ]) {
    const w = q?.[key],
      row = node("div", "", "row"),
      labelEl = node("div", "", "label");
    labelEl.append(
      node("span", label),
      node("strong", w ? `${Math.round(w.remaining)}% 剩余` : "暂不可用"),
    );
    row.append(labelEl);
    if (w) {
      const track = node("div", "", "track"),
        fill = node("div", "", "fill");
      fill.style.width = `${w.remaining}%`;
      track.append(fill);
      row.append(track);
      if (w.resetAt)
        row.append(
          node(
            "div",
            `重置：${new Date(w.resetAt * 1000).toLocaleString("zh-CN")}`,
            "sub",
          ),
        );
    }
    bodyEl.append(row);
  }
  if (q?.message) bodyEl.append(node("div", q.message, "error"));
  if (q?.updatedAt)
    bodyEl.append(
      node(
        "div",
        `${q.stale ? "上次成功更新" : "更新"}：${new Date(q.updatedAt).toLocaleTimeString("zh-CN")}`,
        "sub",
      ),
    );
}
window.xiaomi.on((s) => {
  if (s.viewport && s.card) {
    const v = s.viewport;
    cardEl.style.left = `${Math.max(v.left + 8, Math.min(140, v.right - 328))}px`;
    cardEl.style.top = `${Math.max(v.top + 8, Math.min(20, v.bottom - cardEl.offsetHeight - 8))}px`;
  }
  playBounds = s.playBounds ?? playBounds;
  mode = s.mode;
  suspended = s.suspended;
  cursor = s.cursor ?? cursor;
  cardOpen = s.card;
  cardEl.hidden = !cardOpen;
  if (s.quotaLoading) bodyEl.replaceChildren(node("div", "正在读取额度…"));
  if (s.quota) showQuota(s.quota);
  if (
    s.meow &&
    soundAvailable &&
    !s.muted &&
    !s.suspended &&
    mode !== "sleeping"
  ) {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
  if (s.muted || s.suspended || mode === "sleeping") {
    sound.pause();
    sound.currentTime = 0;
  }
});
document.getElementById("close")!.onclick = () =>
  window.xiaomi.send("close-quota");
document.getElementById("refresh")!.onclick = () => {
  bodyEl.textContent = "正在读取额度…";
  window.xiaomi.send("quota");
};
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  held = true;
  canvas.setPointerCapture(e.pointerId);
  window.xiaomi.send("down");
});
canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0 || !held) return;
  held = false;
  if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId);
  window.xiaomi.send("up");
});
canvas.addEventListener("lostpointercapture", () => {
  if (held) {
    held = false;
    window.xiaomi.send("up");
  }
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.xiaomi.send("menu");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.xiaomi.send("escape");
});
function pick(now: number) {
  const seconds = (now - modeAt) / 1000;
  if (mode === "sleeping") return "sleeping";
  if (mode === "waking") return "waking";
  if (mode === "dragging") return "dragging";
  if (mode === "feeding") return "eating";
  if (mode === "meowing") return "meowing";
  if (mode === "chase" || mode === "wand")
    return Math.hypot(cursor.x - 300, cursor.y - 400) > 230 || seconds % 3 < 1.2
      ? "waiting"
      : "pouncing";
  const cycle = Math.floor(seconds / 13) % 12;
  const phase = seconds % 13;
  return cycle === 3 && phase < 4
    ? "grooming"
    : cycle === 6 && phase < 2
      ? "stretching"
      : cycle === 8 && phase < 2
        ? "stretch-paws"
        : cycle >= 9
          ? "side-lie"
          : "idle";
}
function draw(now: number) {
  requestAnimationFrame(draw);
  if (mode !== previousMode) {
    modeAt = now;
    previousMode = mode;
    pet = { x: 300, y: 400 };
  }
  ctx.clearRect(0, 0, 600, 650);
  const elapsed = now - modeAt;
  let id = pick(now);
  if (id !== clipId) {
    clipId = id;
    clipAt = now;
  }
  const clipElapsed = now - clipAt;
  if (mode === "chase" || mode === "wand") {
    const dx = cursor.x - 300,
      dy = cursor.y - 400,
      len = Math.hypot(dx, dy),
      r = Math.min(len, 180),
      target = {
        x: Math.max(
          playBounds.left,
          Math.min(playBounds.right, 300 + (dx / (len || 1)) * r),
        ),
        y: Math.max(
          playBounds.top,
          Math.min(playBounds.bottom, 400 + (dy / (len || 1)) * r),
        ),
      };
    const active = len <= 230 && elapsed % 3000 > 1100;
    pet.x += (active ? target.x - pet.x : 300 - pet.x) * 0.08;
    pet.y += (active ? target.y - pet.y : 400 - pet.y) * 0.08;
    if (mode === "wand") {
      ctx.strokeStyle = "#c8a173";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cursor.x + 45, cursor.y - 60);
      ctx.lineTo(cursor.x + 12, cursor.y - 20);
      ctx.stroke();
      ctx.strokeStyle = "#d3bda8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursor.x + 12, cursor.y - 20);
      ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
      ctx.fillStyle = "#bd7971";
      ctx.beginPath();
      ctx.ellipse(cursor.x, cursor.y, 7, 14, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (mode === "feeding") {
    ctx.fillStyle = "#a76735";
    ctx.beginPath();
    ctx.ellipse(345, 500, 7, 4, 0.3, 0, Math.PI * 2);
    if (elapsed < 3300) ctx.fill();
  }
  let a = manifest?.animations?.[id] ?? manifest?.animations?.idle;
  if (a) {
    const img = images.get(a.file);
    if (img?.complete && img.naturalWidth) {
      const count = Array.isArray(a.frames) ? a.frames.length : a.frames,
        durations = a.durations ?? Array(count).fill(140),
        total = durations.reduce((sum: number, x: number) => sum + x, 0);
      let t = suspended
          ? 0
          : a.loop === false
            ? Math.min(clipElapsed, total - 1)
            : clipElapsed % total,
        f = 0;
      while (f < count - 1 && t >= durations[f]) {
        t -= durations[f];
        f++;
      }
      const w = manifest.cellWidth ?? 192,
        h = manifest.cellHeight ?? 208,
        rect = Array.isArray(a.frames)
          ? a.frames[f]
          : {
              x: (f % (a.columns ?? 8)) * w,
              y: ((a.row ?? 0) + Math.floor(f / (a.columns ?? 8))) * h,
              width: w,
              height: h,
            };
      const faceLeft = (mode === "chase" || mode === "wand") && cursor.x < 300;
      ctx.save();
      if (faceLeft) {
        ctx.translate(pet.x * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        img,
        rect.x,
        rect.y,
        rect.width ?? w,
        rect.height ?? h,
        pet.x - w / 2,
        pet.y - h / 2,
        w,
        h,
      );
      ctx.restore();
    }
  } else {
    ctx.fillStyle = "#bd8550";
    ctx.font = "13px Microsoft YaHei";
    ctx.textAlign = "center";
    ctx.fillText("小米的动画资源正在准备", 300, 420);
  }
  const cardRect = cardEl.getBoundingClientRect();
  let hit =
    held ||
    (cardOpen &&
      cursor.x >= cardRect.left &&
      cursor.x <= cardRect.right &&
      cursor.y >= cardRect.top &&
      cursor.y <= cardRect.bottom);
  if (
    !hit &&
    cursor.x >= 0 &&
    cursor.x < 600 &&
    cursor.y >= 0 &&
    cursor.y < 650
  ) {
    hit =
      ctx.getImageData(Math.floor(cursor.x), Math.floor(cursor.y), 1, 1)
        .data[3] > 30;
  }
  if (hit !== lastHit) {
    window.xiaomi.send("hit", hit);
    lastHit = hit;
  }
}
requestAnimationFrame(draw);
