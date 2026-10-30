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
import { Behavior, Mode, PetAction } from "./behavior";
import { QuotaClient } from "./quota";
import { Point, clampAnchor, stepToward } from "./movement";
app.disableHardwareAcceleration();
const behavior = new Behavior(Date.now()),
  quota = new QuotaClient();
let win: BrowserWindow,
  flag: BrowserWindow | null = null,
  statePath = "",
  card = false,
  menuOpen = false,
  hit = false;
let downAnchor: { cursor: Point; window: Point } | null = null;
let anchor: Point = { x: 300, y: 400 },
  wakeTarget: Point | null = null,
  facing: "left" | "right" = "right",
  moving = false;
let lastTick = Date.now(),
  lastSave = 0,
  vocalId = 0,
  timer: NodeJS.Timeout;
let quitting = false;
const areas = () => screen.getAllDisplays().map((d) => d.workArea);
function logDiagnostic(message: string) {
  if (statePath)
    fs.appendFileSync(
      path.join(path.dirname(statePath), "diagnostics.log"),
      new Date().toISOString() + " " + message + "\n",
    );
}
process.on("uncaughtExceptionMonitor", (error) => {
  logDiagnostic("uncaught " + (error.stack || error.message));
});
function save() {
  if (win && !win.isDestroyed())
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        x: anchor.x - 300,
        y: anchor.y - 400,
        muted: behavior.muted,
      }),
    );
}
function setAnchor(p: Point, clamp = true) {
  anchor = clamp ? clampAnchor(p, areas()) : p;
  win.setPosition(
    Math.round(anchor.x - 300),
    Math.round(anchor.y - 400),
    false,
  );
}
function hideFlag() {
  if (flag && !flag.isDestroyed()) flag.hide();
  wakeTarget = null;
}
function markWakeTarget() {
  wakeTarget = screen.getCursorScreenPoint();
  const target = wakeTarget;
  if (!flag || flag.isDestroyed()) {
    flag = new BrowserWindow({
      width: 44,
      height: 56,
      transparent: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    flag.setIgnoreMouseEvents(true);
    const createdFlag = flag;
    createdFlag.once("closed", () => {
      if (flag === createdFlag) flag = null;
    });
    flag
      .loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<html><body style="margin:0;background:transparent"><svg width="44" height="56" xmlns="http://www.w3.org/2000/svg"><path d="M8 52V4" stroke="#886b3b" stroke-width="3"/><path d="M10 5h28l-8 10 8 10H10Z" fill="#e9b64a" stroke="#b88521"/></svg></body></html>',
          ),
      )
      .catch((error) => {
        // Closing during the initial navigation cancels it normally.
        if (!quitting && !createdFlag.isDestroyed())
          logDiagnostic("flag-load-failed " + error.message);
      });
  }
  const a = screen.getDisplayNearestPoint(target).workArea;
  flag.setPosition(
    Math.round(Math.max(a.x, Math.min(a.x + a.width - 44, target.x - 8))),
    Math.round(Math.max(a.y, Math.min(a.y + a.height - 56, target.y - 52))),
  );
  flag.showInactive();
}
function send(extra: Record<string, unknown> = {}) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  win.webContents.send("pet:update", {
    mode: behavior.mode,
    epoch: behavior.epoch,
    modeStartedAt: behavior.modeAt,
    modeDuration: Number.isFinite(behavior.until)
      ? behavior.until - behavior.modeAt
      : null,
    modeElapsed: now - behavior.modeAt,
    progress: Number.isFinite(behavior.until)
      ? Math.max(
          0,
          Math.min(
            1,
            (now - behavior.modeAt) / (behavior.until - behavior.modeAt),
          ),
        )
      : 0,
    muted: behavior.muted,
    suspended: behavior.suspended,
    songPlaying: behavior.songPlaying,
    card,
    facing,
    moving,
    petOffset: { x: 0, y: 0 },
    anchor,
    ...extra,
  });
}
function showQuota() {
  card = !card;
  send({ quotaLoading: card });
  if (card) {
    win.focus();
    quota.read().then((q) => send({ quota: q, quotaLoading: false }));
  }
}
function actions(list: PetAction[]) {
  for (const action of list) {
    if (action.type === "wake-target") markWakeTarget();
    else if (action.type === "quota") showQuota();
    else
      send({
        vocal: {
          id: ++vocalId,
          kind: action.durationMs ? "wake" : action.count === 1 ? "one" : "two",
        },
      });
  }
}
function begin(mode: Mode, duration?: number) {
  downAnchor = null;
  menuOpen = false;
  card = false;
  hideFlag();
  behavior.begin(mode, Date.now(), duration);
  actions(behavior.tick(Date.now()));
  send();
}
function esc() {
  card = false;
  if (!["sleeping", "yawning"].includes(behavior.mode)) begin("idle");
  send();
}
function syncEscape() {
  const needed =
    card ||
    ["chase", "chase-pounce", "ball", "walking"].includes(behavior.mode);
  if (needed && !globalShortcut.isRegistered("Escape"))
    globalShortcut.register("Escape", esc);
  if (!needed && globalShortcut.isRegistered("Escape"))
    globalShortcut.unregister("Escape");
}
function menu() {
  menuOpen = true;
  const asleep = ["sleeping", "yawning"].includes(behavior.mode);
  Menu.buildFromTemplate([
    {
      label: "睡觉",
      submenu: [
        {
          label: "选择睡觉时间",
          submenu: [5, 10, 20, 30, 60].map((minutes) => ({
            label: minutes === 60 ? "1 小时" : minutes + " 分钟",
            click: () => begin("sleeping", minutes * 60000),
          })),
        },
        { label: "停止睡觉", enabled: asleep, click: () => begin("waking") },
      ],
    },
    {
      label: "玩耍",
      enabled: !asleep,
      submenu: [
        { label: "玩球（1 分钟）", click: () => begin("ball") },
        { label: "追逐鼠标", click: () => begin("chase") },
        { label: "停止玩耍", click: () => begin("idle") },
      ],
    },
    { label: "喂食", enabled: !asleep, click: () => begin("feeding") },
    {
      label: behavior.songPlaying ? "停止喵喵" : "喵喵叫",
      enabled: !asleep,
      click: () => {
        behavior.toggleSong();
        send();
      },
    },
    { type: "separator" },
    { label: "猫叫音效：罗小黑", enabled: false },
    {
      label: "静音",
      type: "checkbox",
      checked: behavior.muted,
      click: (item) => {
        behavior.muted = item.checked;
        if (item.checked) behavior.songPlaying = false;
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
    },
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    statePath = path.join(app.getPath("userData"), "position.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    logDiagnostic(
      "startup V1.1 software-rendering Electron " + process.versions.electron,
    );
    let saved: any = {};
    try {
      saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {}
    behavior.muted = !!saved.muted;
    const a = screen.getPrimaryDisplay().workArea;
    anchor = clampAnchor(
      {
        x: Number.isFinite(saved.x) ? saved.x + 300 : a.x + a.width - 320,
        y: Number.isFinite(saved.y) ? saved.y + 400 : a.y + a.height - 250,
      },
      areas(),
    );
    win = new BrowserWindow({
      width: 600,
      height: 650,
      x: Math.round(anchor.x - 300),
      y: Math.round(anchor.y - 400),
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
    win.on("closed", () => {
      if (!quitting) app.quit();
    });
    win.on("blur", () => {
      if (card) {
        card = false;
        send();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", (_event, d) =>
      logDiagnostic("renderer-exit " + d.reason + " " + d.exitCode),
    );
    win.webContents.on("did-fail-load", (_event, c, d) =>
      logDiagnostic("load-failed " + c + " " + d),
    );
    const trusted = (e: Electron.IpcMainEvent) => e.sender === win.webContents;
    ipcMain.on("pet:hit", (e, v) => {
      if (trusted(e)) {
        hit = v === true;
        win.setIgnoreMouseEvents(!hit && !behavior.pointerHeld, {
          forward: true,
        });
      }
    });
    ipcMain.on("pet:down", (e) => {
      if (!trusted(e)) return;
      const c = screen.getCursorScreenPoint(),
        [x, y] = win.getPosition();
      behavior.pointerDown(Date.now(), c.x, c.y);
      downAnchor = { cursor: c, window: { x, y } };
    });
    ipcMain.on("pet:up", (e) => {
      if (!trusted(e)) return;
      behavior.pointerUp(Date.now());
      downAnchor = null;
      save();
      actions(behavior.tick(Date.now()));
      send();
    });
    ipcMain.on("pet:menu", (e) => {
      if (trusted(e)) menu();
    });
    ipcMain.on("pet:escape", (e) => {
      if (trusted(e)) esc();
    });
    ipcMain.on("pet:close-quota", (e) => {
      if (trusted(e)) {
        card = false;
        send();
      }
    });
    ipcMain.on("pet:quota", (e) => {
      if (trusted(e))
        quota.read().then((q) => send({ quota: q, quotaLoading: false }));
    });
    ipcMain.on("pet:song-ended", (e) => {
      if (trusted(e)) {
        behavior.songPlaying = false;
        send();
      }
    });
    const suspend = () => {
      behavior.suspend();
      downAnchor = null;
      hideFlag();
      send();
    };
    const resume = () => {
      behavior.resume(Date.now());
      lastTick = Date.now();
      actions(behavior.tick(Date.now()));
      send();
    };
    powerMonitor.on("suspend", suspend);
    powerMonitor.on("lock-screen", suspend);
    powerMonitor.on("resume", resume);
    powerMonitor.on("unlock-screen", resume);
    const reclamp = () => {
      setAnchor(anchor);
      save();
    };
    screen.on("display-removed", reclamp);
    screen.on("display-metrics-changed", reclamp);
    timer = setInterval(() => {
      if (win.isDestroyed()) return;
      const now = Date.now(),
        dt = (now - lastTick) / 1000,
        c = screen.getCursorScreenPoint();
      lastTick = now;
      moving = false;
      if (downAnchor && behavior.pointerMove(now, c.x, c.y)) {
        hideFlag();
        setAnchor({
          x: downAnchor.window.x + 300 + c.x - downAnchor.cursor.x,
          y: downAnchor.window.y + 400 + c.y - downAnchor.cursor.y,
        });
      }
      behavior.hover(now, hit && !card && !menuOpen);
      actions(behavior.tick(now));
      if (
        !behavior.suspended &&
        !menuOpen &&
        !card &&
        ["walking", "chase", "chase-pounce"].includes(behavior.mode)
      ) {
        const raw = behavior.mode === "walking" ? wakeTarget : c;
        if (raw) {
          const target = clampAnchor(raw, areas()),
            distance = Math.hypot(target.x - anchor.x, target.y - anchor.y),
            stopDistance = behavior.mode === "walking" ? 3 : 38;
          if (distance > stopDistance) {
            facing = target.x < anchor.x ? "left" : "right";
            setAnchor(
              stepToward(
                anchor,
                target,
                behavior.mode === "walking"
                  ? 170
                  : behavior.mode === "chase-pounce"
                    ? 140
                    : 330,
                dt,
              ),
              false,
            );
            moving = true;
          } else if (behavior.mode === "walking") {
            behavior.arrive(now);
            hideFlag();
            save();
          }
        }
      }
      const [x, y] = win.getPosition(),
        work = screen.getDisplayNearestPoint(anchor).workArea;
      send({
        cursor: { x: c.x - x, y: c.y - y },
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
      });
      syncEscape();
      if (moving && now - lastSave > 1000) {
        save();
        lastSave = now;
      }
    }, 16);
  });
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  clearInterval(timer);
  save();
  quota.close();
  const closingFlag = flag;
  flag = null;
  if (closingFlag && !closingFlag.isDestroyed()) closingFlag.destroy();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (!quitting) app.quit();
});
app.on("child-process-gone", (_e, d) =>
  logDiagnostic("child-exit " + d.type + " " + d.reason + " " + d.exitCode),
);
