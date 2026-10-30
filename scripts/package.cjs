const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const { packager } = await import("@electron/packager");
  const version = require("electron/package.json").version;
  const appVersion = require("../package.json").version;
  const zipDir = path.resolve(".runtime");
  const zip = path.join(zipDir, `electron-v${version}-win32-x64.zip`);
  const stage = path.resolve(".runtime", "package-stage-" + appVersion);
  fs.mkdirSync(stage, { recursive: true });
  for (const folder of ["dist", "assets"]) {
    fs.cpSync(path.resolve(folder), path.join(stage, folder), {
      recursive: true,
    });
  }
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({
      name: "xiaomi-desktop-pet",
      version: appVersion,
      main: "dist/main.js",
      private: true,
    }),
  );
  const output = await packager({
    dir: stage,
    name: "Xiaomi",
    platform: "win32",
    arch: "x64",
    out: path.resolve("release", "V1.1"),
    overwrite: true,
    electronVersion: version,
    prune: false,
    ...(fs.existsSync(zip) ? { electronZipDir: zipDir } : {}),
    ignore:
      /^\/(?:references|art-run|media-analysis|art-tools|tests|src|release|qa|\.runtime)(?:\/|$)|^\/dist\/tests(?:\/|$)/,
  });
  console.log(output.join("\n"));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
