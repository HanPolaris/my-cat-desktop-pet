import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("xiaomi", {
  send: (type: string, value: unknown) => {
    if (
      [
        "hit",
        "down",
        "up",
        "menu",
        "quota",
        "close-quota",
        "escape",
        "song-ended",
      ].includes(type)
    )
      ipcRenderer.send("pet:" + type, value);
  },
  on: (callback: (x: unknown) => void) => {
    ipcRenderer.on("pet:update", (_event, value) => callback(value));
  },
  assets: "../../assets/",
});
