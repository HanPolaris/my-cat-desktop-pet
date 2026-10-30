interface Window {
  xiaomi: {
    send: (type: string, value?: unknown) => void;
    on: (f: (x: any) => void) => void;
    assets: string;
  };
}
type Clip = {
  file: string;
  frames: number | { x: number; y: number; width: number; height: number }[];
  durations: number[];
  row?: number;
  columns?: number;
  loop?: boolean;
};
type Pose = {
  id: string;
  frame: number;
  next: number;
  blend: number;
  left: boolean;
};
const canvas = document.getElementById("pet") as HTMLCanvasElement,
  ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const catLayer = document.createElement("canvas");
catLayer.width = 600;
catLayer.height = 650;
const catCtx = catLayer.getContext("2d", { willReadFrequently: true })!;
const cardEl = document.getElementById("quota")!,
  bodyEl = document.getElementById("quota-body")!;
const base = window.xiaomi.assets;
let manifest: any = null;
const images = new Map<string, HTMLImageElement>();
let mode = "idle",
  modeAt = performance.now(),
  modeElapsed = 0,
  epoch: unknown = null,
  facing = "right",
  ballFacing = "right",
  songPlaying = false,
  muted = false,
  suspended = false;
let cursor = { x: 300, y: 400 },
  pet = { x: 300, y: 400 },
  cardOpen = false,
  held = false,
  lastHit = false;
let clipId = "",
  clipAt = 0,
  transitionAt = 0,
  currentPose: Pose | null = null,
  previousPose: Pose | null = null,
  lastDraw = performance.now(),
  lastVocalId: unknown = null;
let playBounds = { left: 96, right: 504, top: 104, bottom: 546 };
const sound = new Audio(base + "audio/meow.wav"),
  singleSound = new Audio(base + "audio/meow-one.wav"),
  wakeSound = new Audio(base + "audio/meow-wake.wav"),
  song = new Audio(base + "audio/goodnight-meow.mp3");
const songVolume = 0.22;
let soundAvailable = false;
let activeVoice: HTMLAudioElement | null = null;
song.volume = songVolume;
song.onended = () => window.xiaomi.send("song-ended");
song.onerror = () =>
  window.xiaomi.send("song-ended", { error: "歌曲播放失败" });
fetch(base + "audio/status.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => (soundAvailable = s?.available === true))
  .catch(() => {});
fetch(base + "animations.json")
  .then((r) => r.json())
  .then(async (m) => {
    manifest = m;
    await Promise.all(
      Object.values(m.animations).map(async (a: any) => {
        if (images.has(a.file)) return;
        const image = new Image();
        images.set(a.file, image);
        image.src = base + a.file;
        await image.decode();
      }),
    );
  })
  .catch((error) => console.error("动画加载失败", error));
function stopVoice() {
  for (const audio of [sound, singleSound, wakeSound]) {
    audio.pause();
    audio.currentTime = 0;
  }
  activeVoice = null;
  song.volume = songVolume;
}
function vocal(kind: "one" | "two" | "wake") {
  if (muted || suspended || mode === "sleeping" || !soundAvailable) return;
  stopVoice();
  const audio =
    kind === "one" ? singleSound : kind === "wake" ? wakeSound : sound;
  activeVoice = audio;
  song.volume = 0.04;
  audio.onended = () => {
    activeVoice = null;
    song.volume = songVolume;
  };
  audio.play().catch(() => {
    activeVoice = null;
    song.volume = songVolume;
  });
}
function syncSong(requested: boolean) {
  if (requested === songPlaying) return;
  songPlaying = requested;
  if (requested) {
    song.currentTime = 0;
    song
      .play()
      .catch(() => window.xiaomi.send("song-ended", { error: "歌曲播放失败" }));
  } else {
    song.pause();
    song.currentTime = 0;
  }
}
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
    const value = q?.[key],
      row = node("div", "", "row"),
      labelEl = node("div", "", "label");
    labelEl.append(
      node("span", label),
      node(
        "strong",
        value ? `${Math.round(value.remaining)}% 剩余` : "暂不可用",
      ),
    );
    row.append(labelEl);
    if (value) {
      const track = node("div", "", "track"),
        fill = node("div", "", "fill");
      fill.style.width = `${value.remaining}%`;
      track.append(fill);
      row.append(track);
      if (value.resetAt)
        row.append(
          node(
            "div",
            `重置：${new Date(value.resetAt * 1000).toLocaleString("zh-CN")}`,
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
  if ((s.epoch !== undefined && s.epoch !== epoch) || s.mode !== mode) {
    epoch = s.epoch;
    modeAt = performance.now() - (s.modeElapsed ?? 0);
    clipId = "";
  }
  mode = s.mode;
  modeElapsed = s.modeElapsed ?? performance.now() - modeAt;
  facing = s.facing ?? facing;
  cursor = s.cursor ?? cursor;
  playBounds = s.playBounds ?? playBounds;
  muted = !!s.muted;
  suspended = !!s.suspended;
  cardOpen = !!s.card;
  cardEl.hidden = !cardOpen;
  if (s.viewport && cardOpen) {
    const v = s.viewport;
    cardEl.style.left = `${Math.max(v.left + 8, Math.min(140, v.right - 328))}px`;
    cardEl.style.top = `${Math.max(v.top + 8, Math.min(20, v.bottom - cardEl.offsetHeight - 8))}px`;
  }
  if (s.quotaLoading) bodyEl.replaceChildren(node("div", "正在读取额度…"));
  if (s.quota) showQuota(s.quota);
  syncSong(!!s.songPlaying);
  song.muted = muted;
  if (muted || suspended || mode === "sleeping") stopVoice();
  if ((suspended || mode === "sleeping") && songPlaying) {
    syncSong(false);
    window.xiaomi.send("song-ended");
  }
  if (s.vocal && s.vocal.id !== lastVocalId) {
    lastVocalId = s.vocal.id;
    vocal(s.vocal.kind);
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
function pick(elapsed: number) {
  if (mode === "yawning") return "yawning";
  if (mode === "sleeping") return "sleeping";
  if (mode === "waking") return elapsed < 1300 ? "waking" : "stretching";
  if (mode === "walking" || mode === "chase")
    return facing === "left" ? "running-left" : "running-right";
  if (mode === "lying-down") return "lying-down";
  if (mode === "lying") return "side-lie";
  if (mode === "chase-pounce") return "pouncing";
  if (mode === "dragging") return "dragging";
  if (mode === "feeding") return "eating";
  if (mode === "head-tilt" || mode === "tilting") return "head-tilt";
  if (mode === "meowing") return "meowing";
  if (mode === "ball") {
    const phase = elapsed % 5000;
    return phase < 1200
      ? "waiting"
      : phase < 2600
        ? "pouncing"
        : phase < 4200
          ? ballFacing === "left"
            ? "running-left"
            : "running-right"
          : "idle";
  }
  const seconds = elapsed / 1000,
    cycle = Math.floor(seconds / 14) % 12,
    phase = seconds % 14;
  if (cycle === 3 && phase < 4) return "grooming";
  if (cycle === 6 && phase < 2) return "stretching";
  if (cycle === 8 && phase < 2) return "stretch-paws";
  if (cycle === 11 && phase >= 12) return "waking";
  if (cycle >= 9) return cycle === 9 && phase < 1.5 ? "lying-down" : "side-lie";
  return "idle";
}
function poseFor(id: string, elapsed: number): Pose | null {
  const a: Clip = manifest?.animations?.[id];
  if (!a) return null;
  const count = Array.isArray(a.frames) ? a.frames.length : a.frames,
    durations = a.durations ?? Array(count).fill(140),
    total = durations.reduce((sum, v) => sum + v, 0);
  let t =
    a.loop === false
      ? Math.min(Math.max(0, elapsed), total - 1)
      : Math.max(0, elapsed) % total;
  let frame = 0;
  while (frame < count - 1 && t >= durations[frame]) {
    t -= durations[frame];
    frame++;
  }
  const next = frame + 1 < count ? frame + 1 : a.loop === false ? frame : 0,
    window = Math.min(65, durations[frame] * 0.45);
  let blend = Math.max(0, (t - (durations[frame] - window)) / window);
  blend = blend * blend * (3 - 2 * blend);
  const directional =
    ["pouncing", "waiting"].includes(id) &&
    ["chase-pounce", "ball"].includes(mode);
  return {
    id,
    frame,
    next,
    blend,
    left:
      directional &&
      (mode === "ball" ? ballFacing === "left" : facing === "left"),
  };
}
function drawFrame(
  context: CanvasRenderingContext2D,
  id: string,
  frame: number,
  opacity: number,
  left: boolean,
) {
  const a: Clip = manifest?.animations?.[id];
  if (!a || opacity <= 0) return;
  const image = images.get(a.file);
  if (!image?.complete || !image.naturalWidth) return;
  const w = manifest.cellWidth ?? 192,
    h = manifest.cellHeight ?? 208,
    rect = Array.isArray(a.frames)
      ? a.frames[frame]
      : {
          x: (frame % (a.columns ?? 8)) * w,
          y: ((a.row ?? 0) + Math.floor(frame / (a.columns ?? 8))) * h,
          width: w,
          height: h,
        };
  context.save();
  context.globalAlpha = opacity;
  if (left) {
    context.translate(pet.x * 2, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width ?? w,
    rect.height ?? h,
    pet.x - w / 2,
    pet.y - h / 2,
    w,
    h,
  );
  context.restore();
}
function drawPose(
  context: CanvasRenderingContext2D,
  pose: Pose,
  opacity: number,
) {
  drawFrame(
    context,
    pose.id,
    pose.frame,
    opacity * (1 - pose.blend),
    pose.left,
  );
  drawFrame(context, pose.id, pose.next, opacity * pose.blend, pose.left);
}
function drawBall(elapsed: number) {
  const seconds = elapsed / 1000,
    x = 300 + Math.sin(seconds * 1.35) * 105 + Math.sin(seconds * 2.7) * 20,
    y = 486 - Math.abs(Math.sin(seconds * 2.2)) * 22;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(seconds * 2);
  const gradient = ctx.createRadialGradient(-3, -4, 1, 0, 0, 10);
  gradient.addColorStop(0, "#f9ca83");
  gradient.addColorStop(1, "#bd673a");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f8e1ba";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 9, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return { x, y };
}
function drawCan(progress: number) {
  const x = 350,
    y = 489,
    w = 37,
    h = 25;
  ctx.fillStyle = "#bac2c5";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = "#9da8ac";
  ctx.beginPath();
  ctx.ellipse(x, y + h / 2, w / 2, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e4e9e7";
  ctx.beginPath();
  ctx.ellipse(x, y - h / 2, w / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#795345";
  ctx.beginPath();
  ctx.ellipse(x, y - h / 2, 16, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (progress < 1) {
    ctx.fillStyle = "#b68b6a";
    ctx.beginPath();
    ctx.ellipse(
      x,
      y - h / 2,
      Math.max(1, 15 * (1 - progress)),
      Math.max(0.3, 4 * (1 - progress)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = "#80a6a4";
  ctx.fillRect(x - w / 2 + 1, y - 5, w - 2, 10);
  ctx.fillStyle = "#e5eeee";
  ctx.beginPath();
  ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
}
function draw(now: number) {
  requestAnimationFrame(draw);
  const dt = Math.min(0.08, (now - lastDraw) / 1000);
  lastDraw = now;
  const elapsed = suspended ? modeElapsed : Math.max(modeElapsed, now - modeAt);
  ctx.clearRect(0, 0, 600, 650);
  catCtx.clearRect(0, 0, 600, 650);
  catCtx.globalCompositeOperation = "lighter";
  let target = { x: 300, y: 400 };
  if (mode === "ball") {
    const ball = drawBall(elapsed);
    if (elapsed % 5000 >= 1200)
      target = {
        x: Math.max(playBounds.left, Math.min(playBounds.right, ball.x - 25)),
        y: Math.max(playBounds.top, Math.min(playBounds.bottom, ball.y - 88)),
      };
  }
  if (mode !== "dragging") {
    if (mode === "ball" && Math.abs(target.x - pet.x) > 2)
      ballFacing = target.x < pet.x ? "left" : "right";
    const ease = 1 - Math.exp(-dt * (mode === "ball" ? 5 : 9));
    pet.x += (target.x - pet.x) * ease;
    pet.y += (target.y - pet.y) * ease;
  }
  if (mode === "feeding") drawCan(Math.min(1, elapsed / 60000));
  const id = pick(elapsed);
  if (id !== clipId) {
    previousPose = currentPose;
    clipId = id;
    clipAt = now;
    transitionAt = now;
  }
  const pose = suspended ? currentPose : poseFor(id, now - clipAt);
  if (pose) {
    const phase = Math.min(1, (now - transitionAt) / 160),
      fade = phase * phase * (3 - 2 * phase);
    if (previousPose && phase < 1) drawPose(catCtx, previousPose, 1 - fade);
    drawPose(catCtx, pose, previousPose ? fade : 1);
    currentPose = pose;
    ctx.drawImage(catLayer, 0, 0);
  }
  const rect = cardEl.getBoundingClientRect();
  let hit =
    held ||
    (cardOpen &&
      cursor.x >= rect.left &&
      cursor.x <= rect.right &&
      cursor.y >= rect.top &&
      cursor.y <= rect.bottom);
  if (
    !hit &&
    cursor.x >= 0 &&
    cursor.x < 600 &&
    cursor.y >= 0 &&
    cursor.y < 650
  )
    hit =
      catCtx.getImageData(Math.floor(cursor.x), Math.floor(cursor.y), 1, 1)
        .data[3] > 30;
  if (hit !== lastHit) {
    window.xiaomi.send("hit", hit);
    lastHit = hit;
  }
}
requestAnimationFrame(draw);
