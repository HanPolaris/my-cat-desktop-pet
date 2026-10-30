const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { _electron } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "C:/Users/WangHangang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const root = path.resolve(__dirname, "..");
const packaged = process.argv.includes("--packaged");
const evidence = path.join(root, "qa", "v11-runtime");
fs.mkdirSync(evidence, { recursive: true });
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const profile =
    "--user-data-dir=" +
    path.join(root, ".runtime", packaged ? "v11-release-test" : "v11-test");
  const application = await _electron.launch({
    executablePath: packaged
      ? path.join(root, "release", "V1.1", "Xiaomi-win32-x64", "Xiaomi.exe")
      : path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    args: packaged
      ? [profile, "--mute-audio"]
      : [root, profile, "--mute-audio"],
    env,
  });
  const failures = [];
  try {
    const page = await application.firstWindow();
    page.on("pageerror", (e) => failures.push(e.message));
    await page.waitForFunction(
      () =>
        manifest &&
        Object.keys(manifest.animations).length === 22 &&
        [...images.values()].every((i) => i.complete && i.naturalWidth),
    );
    assert.equal(await page.locator("#audio-state").count(), 0);
    await application.evaluate(({ Menu, screen }) => {
      globalThis.__realNow = Date.now;
      globalThis.__offset = 0;
      Date.now = () => globalThis.__realNow() + globalThis.__offset;
      globalThis.__cursor = { ...screen.getPrimaryDisplay().workArea };
      globalThis.__cursor = {
        x: globalThis.__cursor.x + 500,
        y: globalThis.__cursor.y + 350,
      };
      screen.getCursorScreenPoint = () => globalThis.__cursor;
      Menu.buildFromTemplate = (items) => {
        globalThis.__items = items;
        return {
          popup(options) {
            globalThis.__menuClose = options.callback;
          },
        };
      };
    });
    const emit = (event) =>
      application.evaluate(
        ({ ipcMain, BrowserWindow }, event) =>
          ipcMain.emit("pet:" + event, {
            sender: BrowserWindow.getAllWindows().find(
              (w) => w.getTitle() === "小米桌宠",
            ).webContents,
          }),
        event,
      );
    const menu = async (labels) => {
      console.log("Menu:", labels.join("/"));
      await emit("menu");
      return application.evaluate((_electron, labels) => {
        let list = globalThis.__items,
          item;
        for (const label of labels) {
          item = list.find((i) => i.label === label);
          if (!item) throw new Error("Missing menu " + label);
          list = item.submenu;
        }
        if (item.enabled === false)
          throw new Error("Disabled menu " + labels.join("/"));
          // Native window creation must run on Electron's event loop rather
          // than inside the inspector evaluation used by the test harness.
          setImmediate(() => {
            item.click();
            globalThis.__menuClose?.();
          });
      }, labels);
    };
    await page.screenshot({
      path: path.join(evidence, "idle.png"),
      omitBackground: true,
    });
    await emit("down");
    await emit("up");
    await page.waitForFunction(() => mode === "meowing");
    assert.equal(await page.evaluate(() => cardOpen), false);
    await page.waitForTimeout(1650);
    await emit("down");
    await emit("up");
    await page.waitForTimeout(80);
    await emit("down");
    await emit("up");
    await page.waitForFunction(
      () => cardOpen && bodyEl.textContent.includes("%"),
      null,
      { timeout: 25000 },
    );
    await page.screenshot({
      path: path.join(evidence, "quota.png"),
      omitBackground: true,
    });
    await emit("close-quota");
    await menu(["喵喵叫"]);
    await page.waitForFunction(
      () => songPlaying && !song.paused && song.duration > 1,
    );
    await menu(["停止喵喵"]);
    await page.waitForFunction(() => !songPlaying && song.paused);
    await menu(["玩耍", "玩球（1 分钟）"]);
    await page.waitForFunction(() => mode === "ball");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(evidence, "ball.png"),
      omitBackground: true,
    });
    await menu(["喂食"]);
    await page.waitForFunction(() => mode === "feeding");
    await application.evaluate(() => (globalThis.__offset += 30000));
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(evidence, "feeding-half.png"),
      omitBackground: true,
    });
    await menu(["睡觉", "选择睡觉时间", "5 分钟"]);
    await page.waitForFunction(() => mode === "yawning");
    await application.evaluate(() => (globalThis.__offset += 2100));
    await page.waitForFunction(() => mode === "sleeping");
    await menu(["睡觉", "停止睡觉"]);
    await page.waitForFunction(() => mode === "waking");
    const flag = await application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    assert.equal(flag, 2);
    await application.evaluate(() => (globalThis.__offset += 3100));
    await page.waitForFunction(() =>
      ["walking", "lying-down", "lying"].includes(mode),
    );
    await page.waitForFunction(() => mode === "lying", null, {
      timeout: 16000,
    });
    await menu(["玩耍", "追逐鼠标"]);
    await page.waitForFunction(() => mode === "chase-pounce");
    await application.evaluate(() => (globalThis.__offset += 1400));
    await page.waitForFunction(() => mode === "chase");
    const before = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "小米桌宠")
        .getPosition(),
    );
    await application.evaluate(({ screen }) => {
      const a = screen.getPrimaryDisplay().workArea;
      globalThis.__cursor = { x: a.x + 180, y: a.y + 180 };
    });
    await page.waitForTimeout(700);
    const after = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "小米桌宠")
        .getPosition(),
    );
    assert.ok(
      Math.hypot(before[0] - after[0], before[1] - after[1]) > 30,
      "Chase must move native window across desktop",
    );
    await emit("escape");
    await page.waitForFunction(() => mode === "idle");
    assert.deepEqual(failures, []);
    fs.writeFileSync(
      path.join(evidence, packaged ? "release-smoke.json" : "smoke.json"),
      JSON.stringify(
        {
          passed: true,
          packaged,
          version: "1.1.0",
          animations: 22,
          singleDoubleClick: true,
          sleepWakeFlag: true,
          fullScreenNativeMovement: true,
          ballAndFeeding: true,
          localSongPlayback: true,
          quota: true,
          errors: failures,
        },
        null,
        2,
      ),
    );
    console.log("V1.1 native smoke passed");
  } catch (error) {
    console.error("Smoke failure before shutdown:", error);
    throw error;
  } finally {
    console.log("Closing test application");
    const force = setTimeout(() => application.process().kill(), 10000);
    try {
      await application.close();
    } finally {
      clearTimeout(force);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
