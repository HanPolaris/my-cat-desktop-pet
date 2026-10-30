import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  powerMonitor,
  globalShortcut,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { Behavior, Mode } from "./behavior";
import { QuotaClient } from "./quota";
// The pet only paints small 2D sprites. Software rendering avoids GPU-driver
// initialization failures without changing Chromium's sandbox protections.
app.disableHardwareAcceleration();
const behavior = new Behavior(Date.now());
const quota = new QuotaClient();
let win: BrowserWindow;
let statePath = "";
let card = false;
let menuOpen = false;
let hit = false;
let downAnchor: {
  cursor: Electron.Point;
  window: Electron.Point;
} | null = null;
let lastX = 0,
  lastY = 0;
let lastSave = 0;
let timer: NodeJS.Timeout;
function logDiagnostic(message: string) {
  if (!statePath) return;
  fs.appendFileSync(
    path.join(path.dirname(statePath), "diagnostics.log"),
    `${new Date().toISOString()} ${message}\n`,
  );
}
function save() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  fs.writeFileSync(statePath, JSON.stringify({ x, y, muted: behavior.muted }));
}
function clampPosition(x: number, y: number) {
  const d = screen.getDisplayNearestPoint({ x: x + 300, y: y + 400 }).workArea;
  return {
    x: Math.round(Math.max(d.x - 200, Math.min(d.x + d.width - 400, x))),
    y: Math.round(Math.max(d.y - 240, Math.min(d.y + d.height - 510, y))),
  };
}
function moveTo(x: number, y: number) {
  const p = clampPosition(x, y);
  win.setPosition(p.x, p.y, false);
}
function send(extra: Record<string, unknown> = {}) {
  if (!win?.isDestroyed())
    win.webContents.send("pet:update", {
      mode: behavior.mode,
      muted: behavior.muted,
      suspended: behavior.suspended,
      card,
      ...extra,
    });
}
function esc() {
  card = false;
  if (behavior.mode !== "sleeping") behavior.stop(Date.now());
  send();
}
function syncEscape() {
  const needed = card || ["chase", "wand"].includes(behavior.mode);
  if (needed && !globalShortcut.isRegistered("Escape"))
    globalShortcut.register("Escape", esc);
  if (!needed && globalShortcut.isRegistered("Escape"))
    globalShortcut.unregister("Escape");
}
function begin(mode: Mode) {
  downAnchor = null;
  menuOpen = false;
  card = false;
  behavior.begin(mode, Date.now());
  send();
}
function menu() {
  behavior.interact(Date.now());
  menuOpen = true;
  Menu.buildFromTemplate([
    {
      label:
        behavior.mode === "sleeping" ? "叫醒小米" : "让小米睡觉（20 分钟）",
      click: () => begin(behavior.mode === "sleeping" ? "waking" : "sleeping"),
    },
    { label: "玩耍逗猫棒", click: () => begin("wand") },
    { label: "追逐扑鼠标", click: () => begin("chase") },
    { label: "喂零食", click: () => begin("feeding") },
    { label: "停止玩耍", click: () => begin("idle") },
    { type: "separator" },
    {
      label: "静音",
      type: "checkbox",
      checked: behavior.muted,
      click: (item) => {
        behavior.muted = item.checked;
        save();
        send();
      },
    },
    { type: "separator" },
    { label: "退出小米", click: () => app.quit() },
  ]).popup({
    window: win,
    callback: () => {
      menuOpen = false;
      behavior.interact(Date.now());
    },
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    statePath = path.join(app.getPath("userData"), "position.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    logDiagnostic(`startup software-rendering Electron ${process.versions.electron}`);
    let saved: any = {};
    try {
      saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {}
    behavior.muted = !!saved.muted;
    const area = screen.getPrimaryDisplay().workArea;
    const position = clampPosition(
      Number.isFinite(saved.x) ? saved.x : area.x + area.width - 620,
      Number.isFinite(saved.y) ? saved.y : area.y + area.height - 650,
    );
    win = new BrowserWindow({
      width: 600,
      height: 650,
      ...position,
      transparent: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, "index.html"));
    win.once("ready-to-show", () => win.showInactive());
    win.on("blur", () => {
      if (card) {
        card = false;
        send();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("render-process-gone", (_event, details) => {
      logDiagnostic(`renderer-exit reason=${details.reason} code=${details.exitCode}`);
    });
    win.webContents.on("did-fail-load", (_event, code, description) => {
      logDiagnostic(`load-failed code=${code} ${description}`);
    });
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    const trusted = (event: Electron.IpcMainEvent) =>
      event.sender === win.webContents;
    ipcMain.on("pet:hit", (event, value) => {
      if (!trusted(event)) return;
      hit = value === true;
      win.setIgnoreMouseEvents(!hit && !behavior.pointerHeld, {
        forward: true,
      });
    });
    ipcMain.on("pet:down", (event) => {
      if (!trusted(event)) return;
      const c = screen.getCursorScreenPoint();
      const [x, y] = win.getPosition();
      behavior.pointerDown(Date.now(), c.x, c.y);
      downAnchor = { cursor: c, window: { x, y } };
    });
    ipcMain.on("pet:up", (event) => {
      if (!trusted(event)) return;
      const click = behavior.pointerUp(Date.now());
      downAnchor = null;
      save();
      if (click) {
        card = !card;
        send({ quotaLoading: card });
        if (card) {
          win.focus();
          quota.read().then((q) => send({ quota: q, quotaLoading: false }));
        }
      }
      send();
    });
    ipcMain.on("pet:menu", (event) => {
      if (trusted(event)) menu();
    });
    ipcMain.on("pet:escape", (event) => {
      if (trusted(event)) esc();
    });
    ipcMain.on("pet:close-quota", (event) => {
      if (trusted(event)) {
        card = false;
        send();
      }
    });
    ipcMain.on("pet:quota", (event) => {
      if (trusted(event))
        quota.read().then((q) => send({ quota: q, quotaLoading: false }));
    });
    const suspend = () => {
      behavior.suspend();
      send();
    };
    const resume = () => {
      behavior.resume(Date.now());
      send();
    };
    powerMonitor.on("suspend", suspend);
    powerMonitor.on("lock-screen", suspend);
    powerMonitor.on("resume", resume);
    powerMonitor.on("unlock-screen", resume);
    screen.on("display-removed", () => {
      const [x, y] = win.getPosition();
      moveTo(x, y);
      save();
    });
    screen.on("display-metrics-changed", () => {
      const [x, y] = win.getPosition();
      moveTo(x, y);
    });
    timer = setInterval(() => {
      if (win.isDestroyed()) return;
      const now = Date.now(),
        c = screen.getCursorScreenPoint();
      if (downAnchor && behavior.pointerMove(now, c.x, c.y)) {
        moveTo(
          downAnchor.window.x + c.x - downAnchor.cursor.x,
          downAnchor.window.y + c.y - downAnchor.cursor.y,
        );
      }
      behavior.hover(now, hit && !card && !menuOpen);
      const action = behavior.tick(now);
      const [x, y] = win.getPosition();
      const work = screen.getDisplayNearestPoint({
        x: x + 300,
        y: y + 400,
      }).workArea;
      send({
        viewport: {
          left: Math.max(0, work.x - x),
          right: Math.min(600, work.x + work.width - x),
          top: Math.max(0, work.y - y),
          bottom: Math.min(650, work.y + work.height - y),
        },
        playBounds: {
          left: Math.max(96, work.x - x + 96),
          right: Math.min(504, work.x + work.width - x - 96),
          top: Math.max(104, work.y - y + 104),
          bottom: Math.min(546, work.y + work.height - y - 104),
        },
        cursor: { x: c.x - x, y: c.y - y },
        meow: action === "meow" && !behavior.muted,
      });
      syncEscape();
      if ((x !== lastX || y !== lastY) && now - lastSave > 1000) {
        save();
        lastSave = now;
        lastX = x;
        lastY = y;
      }
    }, 33);
  });
app.on("before-quit", () => {
  clearInterval(timer);
  save();
  quota.close();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => app.quit());
app.on("child-process-gone", (_event, details) => {
  logDiagnostic(`child-exit type=${details.type} reason=${details.reason} code=${details.exitCode}`);
});
