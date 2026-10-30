const fs = require("fs");
const path = require("path");
for (const f of ["index.html", "style.css"])
  fs.copyFileSync(path.join("src", f), path.join("dist", "src", f));
fs.copyFileSync("dist/src/main.js", "dist/main.js");
// The entry remains beside src/ so all compiled modules share a stable path.
fs.writeFileSync("dist/main.js", "require('./src/main.js');\n");
