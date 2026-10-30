const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const errors = [];
  const evidence = path.join(root, "qa", "runtime");
  fs.mkdirSync(evidence, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes("--packaged");
  const profile =
    "--user-data-dir=" +
    path.join(root, ".runtime", packaged ? "smoke-release" : "smoke");
  const application = await _electron.launch({
    executablePath: packaged
      ? path.join(root, "release", "Xiaomi-win32-x64", "Xiaomi.exe")
      : path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    args: packaged ? [profile] : [root, profile],
    env,
  });
  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(
      () =>
        manifest &&
        images.size > 0 &&
        [...images.values()].every((i) => i.complete && i.naturalWidth),
    );
    await page.screenshot({
      path: path.join(evidence, "idle.png"),
      omitBackground: true,
    });
    const loaded = await page.evaluate(() => ({
      animations: Object.keys(manifest.animations),
      pixels: ctx
        .getImageData(0, 0, 600, 650)
        .data.filter((v, i) => i % 4 === 3 && v > 0).length,
    }));
    assert.ok(loaded.pixels > 100, "Actual sprite must be rendered");
    if (process.argv.includes("--complete")) {
      const required = [
        "idle",
        "running-right",
        "running-left",
        "waving",
        "jumping",
        "failed",
        "waiting",
        "running",
        "review",
        "side-lie",
        "stretch-paws",
        "grooming",
        "stretching",
        "sleeping",
        "waking",
        "pouncing",
        "dragging",
        "eating",
        "meowing",
      ];
      assert.deepEqual([...loaded.animations].sort(), required.sort());
      const audio = await page.evaluate(async () => {
        if (sound.readyState < 1) {
          await new Promise((resolve, reject) => {
            sound.addEventListener("loadedmetadata", resolve, { once: true });
            sound.addEventListener("error", reject, { once: true });
            sound.load();
          });
        }
        return {
          available: soundAvailable,
          duration: sound.duration,
          label: document.getElementById("audio-state").textContent,
        };
      });
      assert.equal(audio.available, true);
      assert.ok(audio.duration > 0 && audio.duration <= 1.6);
      assert.equal(audio.label, "罗小黑猫叫");
      loaded.audio = audio;
    }
    await application.evaluate(({ Menu, ipcMain, BrowserWindow }) => {
      Menu.buildFromTemplate = (template) => {
        globalThis.__petMenu = template;
        return { popup() {} };
      };
      ipcMain.emit("pet:menu", {
        sender: BrowserWindow.getAllWindows()[0].webContents,
      });
      globalThis.__petMenu
        .find((item) => item.label.startsWith("让小米睡觉"))
        .click();
    });
    await page.waitForFunction(() => mode === "sleeping");
    await application.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.emit("pet:menu", {
        sender: BrowserWindow.getAllWindows()[0].webContents,
      });
      globalThis.__petMenu.find((item) => item.label === "叫醒小米").click();
    });
    await page.waitForFunction(() => mode === "waking");
    await application.evaluate(({ ipcMain, BrowserWindow }) => {
      const e = { sender: BrowserWindow.getAllWindows()[0].webContents };
      ipcMain.emit("pet:menu", e);
      globalThis.__petMenu.find((item) => item.label === "玩耍逗猫棒").click();
    });
    await page.waitForFunction(() => mode === "wand");
    await application.evaluate(({ ipcMain, BrowserWindow }) =>
      ipcMain.emit("pet:escape", {
        sender: BrowserWindow.getAllWindows()[0].webContents,
      }),
    );
    await page.waitForFunction(() => mode === "idle");
    await application.evaluate(({ ipcMain, BrowserWindow }) => {
      const e = { sender: BrowserWindow.getAllWindows()[0].webContents };
      ipcMain.emit("pet:down", e);
      ipcMain.emit("pet:up", e);
    });
    await page.waitForFunction(
      () =>
        !document.getElementById("quota").hidden &&
        document.getElementById("quota-body").textContent.includes("%"),
      null,
      { timeout: 25000 },
    );
    await page.screenshot({
      path: path.join(evidence, "quota.png"),
      omitBackground: true,
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(evidence, "smoke.json"),
      JSON.stringify(
        {
          passed: true,
          packaged,
          loaded,
          nativeWindow: true,
          sleepWake: true,
          wandEscape: true,
          realQuota: true,
          rendererErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "Native smoke passed: actual sprites, sleep/wake, wand/Esc, real quota; evidence qa/runtime.",
    );
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
