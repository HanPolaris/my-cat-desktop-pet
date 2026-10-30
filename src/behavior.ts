export type Mode =
  | "idle"
  | "yawning"
  | "sleeping"
  | "waking"
  | "walking"
  | "lying-down"
  | "lying"
  | "chase-pounce"
  | "chase"
  | "ball"
  | "feeding"
  | "dragging"
  | "head-tilt"
  | "meowing";
export type PetAction =
  | { type: "meow"; count: 1 | 2; durationMs?: number }
  | { type: "quota" }
  | { type: "wake-target" };
export class Behavior {
  mode: Mode = "idle";
  modeAt: number;
  epoch = 0;
  until = Infinity;
  muted = false;
  suspended = false;
  songPlaying = false;
  hoverStart: number | null = null;
  hoverArmed = true;
  pointerHeld = false;
  drag = false;
  press: {
    at: number;
    x: number;
    y: number;
    previous: Mode;
    until: number;
  } | null = null;
  pendingClick: number | null = null;
  private sleepMs = 1200000;
  private lastTick: number;
  private lastBoundarySlot: number | null = null;
  private actions: PetAction[] = [];
  constructor(now = 0) {
    this.modeAt = now;
    this.lastTick = now;
  }
  private set(mode: Mode, now: number, duration = Infinity) {
    this.mode = mode;
    this.modeAt = now;
    this.epoch++;
    this.until = now + duration;
    this.hoverStart = null;
    this.hoverArmed = false;
  }
  private meow(count: 1 | 2, durationMs?: number) {
    if (!this.muted && !this.suspended)
      this.actions.push({ type: "meow", count, durationMs });
  }
  begin(mode: Mode, now: number, duration?: number) {
    this.pendingClick = null;
    this.press = null;
    this.pointerHeld = false;
    this.drag = false;
    if (mode === "sleeping") {
      this.sleepMs = duration ?? 1200000;
      this.songPlaying = false;
      this.set("yawning", now, 2000);
      return;
    }
    if (mode === "waking") {
      this.songPlaying = false;
      this.set("waking", now, 3000);
      this.actions.push({ type: "wake-target" });
      this.meow(2, 3000);
      return;
    }
    if (mode === "chase") {
      this.set("chase-pounce", now, 1300);
      return;
    }
    this.set(
      mode,
      now,
      duration ?? (mode === "ball" || mode === "feeding" ? 60000 : Infinity),
    );
  }
  stop(now: number) {
    this.begin("idle", now);
  }
  interact(_now: number) {}
  toggleSong() {
    this.songPlaying = !this.songPlaying;
  }
  pointerDown(now: number, x: number, y: number) {
    this.hoverStart = null;
    this.pointerHeld = true;
    this.press = { at: now, x, y, previous: this.mode, until: this.until };
    this.drag = false;
  }
  pointerMove(now: number, x: number, y: number) {
    if (
      this.press &&
      now - this.press.at >= 300 &&
      Math.hypot(x - this.press.x, y - this.press.y) > 6 &&
      !this.drag
    ) {
      this.pendingClick = null;
      this.drag = true;
      this.set("dragging", now);
    }
    return this.drag;
  }
  pointerUp(now: number) {
    const previous = this.press;
    this.press = null;
    this.pointerHeld = false;
    if (this.drag) {
      this.drag = false;
      if (previous?.previous === "sleeping") {
        this.set("sleeping", now);
        this.until = previous.until;
      } else this.stop(now);
      return;
    }
    if (!previous) return;
    if (this.pendingClick !== null && now - this.pendingClick <= 300) {
      this.pendingClick = null;
      this.actions.push({ type: "quota" });
    } else this.pendingClick = now;
  }
  hover(now: number, inside: boolean) {
    if (!inside) {
      this.hoverStart = null;
      this.hoverArmed = true;
      return;
    }
    if (
      !["idle", "lying"].includes(this.mode) ||
      this.pointerHeld ||
      this.pendingClick !== null ||
      !this.hoverArmed ||
      this.suspended
    )
      return;
    this.hoverStart ??= now;
    if (now - this.hoverStart >= 2000) {
      this.set("head-tilt", now, 1800);
      this.meow(2);
    }
  }
  suspend() {
    this.suspended = true;
    this.songPlaying = false;
    this.pendingClick = null;
    this.press = null;
    this.pointerHeld = false;
    this.drag = false;
    this.hoverStart = null;
    this.actions = [];
  }
  resume(now: number) {
    this.suspended = false;
    this.lastTick = now;
    if (this.mode === "sleeping") {
      if (now >= this.until) this.begin("waking", now);
    } else this.stop(now);
  }
  arrive(now: number) {
    if (this.mode === "walking") this.set("lying-down", now, 1300);
  }
  tick(now: number): PetAction[] {
    if (this.suspended) {
      this.lastTick = now;
      return [];
    }
    const wasAsleep = ["sleeping", "yawning"].includes(this.mode);
    if (
      this.pendingClick !== null &&
      now - this.pendingClick > 300 &&
      !this.pointerHeld
    ) {
      this.pendingClick = null;
      if (!["sleeping", "yawning"].includes(this.mode)) {
        if (["idle", "lying", "meowing", "head-tilt"].includes(this.mode))
          this.set("meowing", now, 1600);
        this.meow(2);
      }
    }
    if (!this.pointerHeld && now >= this.until) {
      if (this.mode === "yawning") this.set("sleeping", now, this.sleepMs);
      else if (this.mode === "sleeping") this.begin("waking", now);
      else if (this.mode === "waking") this.set("walking", now);
      else if (this.mode === "chase-pounce") this.set("chase", now);
      else if (this.mode === "lying-down") this.set("lying", now);
      else this.stop(now);
    }
    const currentDate = new Date(now);
    const boundarySlot = Math.floor(now / 1800000);
    if (
      now >= this.lastTick &&
      now - this.lastTick < 2000 &&
      Math.floor(now / 60000) !== Math.floor(this.lastTick / 60000) &&
      currentDate.getMinutes() % 30 === 0 &&
      this.lastBoundarySlot !== boundarySlot
    ) {
      this.lastBoundarySlot = boundarySlot;
      if (!wasAsleep && !["sleeping", "yawning"].includes(this.mode))
        this.meow(1);
    }
    this.lastTick = now;
    const actions = this.actions;
    this.actions = [];
    return actions;
  }
}
