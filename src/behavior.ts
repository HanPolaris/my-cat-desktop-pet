export type Mode =
  | "idle"
  | "sleeping"
  | "waking"
  | "chase"
  | "wand"
  | "feeding"
  | "dragging"
  | "meowing";
export class Behavior {
  mode: Mode = "idle";
  muted = false;
  suspended = false;
  nextReminder: number;
  until = Infinity;
  hoverStart: number | null = null;
  hoverArmed = true;
  pointerHeld = false;
  press: {
    at: number;
    x: number;
    y: number;
    previous: Mode;
  } | null = null;
  drag = false;
  constructor(now = 0) {
    this.nextReminder = now + 900000;
  }
  interact(now: number) {
    this.nextReminder = now + 900000;
  }
  begin(mode: Mode, now: number) {
    this.interact(now);
    this.press = null;
    this.pointerHeld = false;
    this.drag = false;
    this.hoverStart = null;
    this.hoverArmed = false;
    this.mode = mode;
    this.until =
      mode === "sleeping"
        ? now + 1200000
        : mode === "feeding"
          ? now + 5000
          : mode === "waking"
            ? now + 1400
            : Infinity;
  }
  stop(now: number) {
    this.begin("idle", now);
  }
  pointerDown(now: number, x: number, y: number) {
    this.interact(now);
    this.hoverStart = null;
    this.pointerHeld = true;
    this.press = { at: now, x, y, previous: this.mode };
    this.drag = false;
  }
  pointerMove(now: number, x: number, y: number) {
    if (
      this.press &&
      now - this.press.at >= 300 &&
      Math.hypot(x - this.press.x, y - this.press.y) > 6
    ) {
      this.drag = true;
      this.mode = "dragging";
    }
    return this.drag;
  }
  pointerUp(now: number) {
    const click = !!this.press && !this.drag;
    const previous = this.press?.previous;
    this.press = null;
    this.pointerHeld = false;
    if (this.drag) {
      this.drag = false;
      if (previous === "sleeping") {
        this.mode = "sleeping";
      } else this.stop(now);
    }
    this.interact(now);
    return click;
  }
  hover(now: number, inside: boolean) {
    if (this.mode !== "idle" || this.suspended) return;
    if (!inside) {
      this.hoverStart = null;
      this.hoverArmed = true;
      return;
    }
    if (this.pointerHeld || !this.hoverArmed) return;
    this.hoverStart ??= now;
    if (now - this.hoverStart >= 2000) {
      this.begin("chase", now);
      this.until = now + 8000;
    }
  }
  suspend() {
    this.suspended = true;
    this.hoverStart = null;
    this.press = null;
    this.pointerHeld = false;
    this.drag = false;
  }
  resume(now: number) {
    this.suspended = false;
    if (this.mode !== "sleeping") this.stop(now);
    else if (now >= this.until) this.begin("waking", now);
    this.interact(now);
  }
  tick(now: number): "meow" | null {
    if (this.suspended) return null;
    if (now >= this.until) {
      if (this.mode === "sleeping") this.begin("waking", now);
      else if (this.mode === "meowing") {
        this.mode = "idle";
        this.until = Infinity;
      } else this.stop(now);
    }
    if (
      this.mode === "chase" ||
      this.mode === "wand" ||
      this.mode === "feeding" ||
      this.mode === "dragging"
    ) {
      this.interact(now);
      return null;
    }
    if (this.mode === "idle" && now >= this.nextReminder) {
      this.mode = "meowing";
      this.until = now + 1600;
      this.nextReminder = now + 300000;
      return "meow";
    }
    if (this.mode === "meowing" && now >= this.until) {
      this.mode = "idle";
      this.until = Infinity;
    }
    return null;
  }
}
