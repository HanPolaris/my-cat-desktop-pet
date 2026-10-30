const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { _electron } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "C:/Users/WangHangang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const root = path.resolve(__dirname, "..");
const output = path.join(root, "qa", "v11-runtime");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const cases = [];
  const runId = Date.now();
  for (const name of [
    "startup-exit",
    "wake-flag-exit",
    "quota-pending-exit",
    "repeated-wake",
    "main-window-close",
  ]) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const profileDir = path.join(
      root,
      ".runtime",
      "lifecycle-" + name + "-" + runId,
    );
    const profile = path.join(profileDir, "diagnostics.log");
    const oldLog = fs.existsSync(profile)
      ? fs.readFileSync(profile, "utf8")
      : "";
    const source = process.argv.includes("--source");
    const application = await _electron.launch({
      executablePath: source
        ? path.join(root, "node_modules", "electron", "dist", "electron.exe")
        : path.join(root, "release", "V1.1", "Xiaomi-win32-x64", "Xiaomi.exe"),
      args: [
        ...(source ? [root] : []),
        "--user-data-dir=" + profileDir,
        "--mute-audio",
      ],
      env,
    });
    const errors = [],
      stderr = [],
      child = application.process();
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    try {
      const page = await application.firstWindow();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForFunction(
        () =>
          manifest &&
          images.size === 22 &&
          [...images.values()].every((i) => i.complete && i.naturalWidth),
      );
      await application.evaluate(({ Menu, dialog }) => {
        globalThis.__errors = [];
        process.on("uncaughtExceptionMonitor", (e) =>
          globalThis.__errors.push(e.stack || e.message),
        );
        dialog.showErrorBox = (title, content) =>
          globalThis.__errors.push(title + ": " + content);
        Menu.buildFromTemplate = (items) => {
          globalThis.__items = items;
          return {
            popup(o) {
              globalThis.__closeMenu = o.callback;
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
        await emit("menu");
        await application.evaluate((_e, labels) => {
          let items = globalThis.__items,
            item;
          for (const label of labels) {
            item = items.find((i) => i.label === label);
            if (!item) throw Error("Missing " + label);
            items = item.submenu;
          }
          setImmediate(() => {
            item.click();
            globalThis.__closeMenu?.();
          });
        }, labels);
      };
      if (
        name === "wake-flag-exit" ||
        name === "repeated-wake" ||
        name === "main-window-close"
      ) {
        for (let i = 0; i < (name === "repeated-wake" ? 4 : 1); i++) {
          await menu(["睡觉", "选择睡觉时间", "5 分钟"]);
          await page.waitForFunction(() => mode === "yawning");
          await menu(["睡觉", "停止睡觉"]);
          await page.waitForFunction(() => mode === "waking");
          const windows = await application.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
          );
          assert.equal(windows, 2, "Exactly one reusable flag window");
        }
      }
      if (name === "quota-pending-exit") await emit("quota");
      errors.push(...(await application.evaluate(() => globalThis.__errors)));
      if (name === "main-window-close") {
        await application.evaluate(({ BrowserWindow }) =>
          setImmediate(() =>
            BrowserWindow.getAllWindows()
              .find((w) => w.getTitle() === "小米桌宠")
              .close(),
          ),
        );
        const exited = await new Promise((resolve) => {
          if (child.exitCode !== null) return resolve(true);
          const timeout = setTimeout(() => resolve(false), 2000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve(true);
          });
        });
        assert.equal(
          exited,
          true,
          "Closing the main window must not leave the flag process running",
        );
      }
      if (name !== "main-window-close")
        await application.evaluate(({ app }) => setImmediate(() => app.quit()));
      let forced = false;
      const deadline = setTimeout(() => {
        forced = true;
        child.kill();
      }, 8000);
      try {
        if (child.exitCode === null) await application.close();
      } finally {
        clearTimeout(deadline);
      }
      assert.equal(
        forced,
        false,
        "Exit must complete without forced termination",
      );
      const diagnostic = fs.readFileSync(profile, "utf8").slice(oldLog.length);
      assert.doesNotMatch(
        diagnostic,
        /uncaught |renderer-exit.*crash|child-exit.*crash|load-failed/,
      );
      assert.deepEqual(errors, []);
      cases.push({ name, passed: true, errors, stderr: stderr.join("") });
      console.log("Lifecycle PASS:", name);
    } catch (error) {
      console.error("Lifecycle FAIL", name, error);
      try {
        await application.evaluate(({ app }) => setImmediate(() => app.quit()));
        await application.close();
      } catch {
        child.kill();
      }
      throw error;
    }
  }
  fs.writeFileSync(
    path.join(output, "lifecycle.json"),
    JSON.stringify({ passed: true, cases }, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
