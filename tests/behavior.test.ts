import { test } from "node:test";
import assert from "node:assert/strict";
import { Behavior } from "../src/behavior";
import { stepToward, clampAnchor } from "../src/movement";
function click(b: Behavior, t: number) {
  b.pointerDown(t, 0, 0);
  b.pointerUp(t + 20);
}
test("single waits for double-click interval and emits two meows, double only quota", () => {
  const b = new Behavior();
  click(b, 0);
  assert.deepEqual(b.tick(200), []);
  assert.deepEqual(b.tick(321), [
    { type: "meow", count: 2, durationMs: undefined },
  ]);
  const d = new Behavior();
  click(d, 0);
  click(d, 150);
  assert.deepEqual(d.tick(171), [{ type: "quota" }]);
  assert.deepEqual(d.tick(1000), []);
});
test("drag requires hold and movement, cancels pending click and active chase", () => {
  const b = new Behavior();
  click(b, 0);
  b.pointerDown(100, 0, 0);
  assert.equal(b.pointerMove(399, 30, 30), false);
  assert.equal(b.pointerMove(401, 30, 30), true);
  b.pointerUp(500);
  assert.equal(b.mode, "idle");
  assert.deepEqual(b.tick(1000), []);
  b.begin("chase", 1100);
  b.pointerDown(1200, 0, 0);
  b.pointerMove(1600, 20, 0);
  b.pointerUp(1700);
  assert.equal(b.mode, "idle");
});
test("hover does not chase and rearms only after leave", () => {
  const b = new Behavior();
  b.hover(0, true);
  b.hover(2000, true);
  assert.equal(b.mode, "head-tilt");
  assert.equal(b.tick(2000)[0].type, "meow");
  b.tick(3800);
  b.hover(4000, true);
  b.hover(8000, true);
  assert.equal(b.mode, "idle");
  b.hover(8100, false);
  b.hover(8200, true);
  b.hover(10200, true);
  assert.equal(b.mode, "head-tilt");
});
test("sleep duration starts after yawn; auto/manual wake captures target and vocal three seconds", () => {
  const b = new Behavior();
  b.begin("sleeping", 0, 300000);
  assert.equal(b.mode, "yawning");
  b.tick(2000);
  assert.equal(b.mode, "sleeping");
  assert.equal(b.until, 302000);
  click(b, 3000);
  assert.deepEqual(b.tick(3400), []);
  b.hover(5000, true);
  b.hover(8000, true);
  assert.equal(b.mode, "sleeping");
  const events = b.tick(302000);
  assert.equal(b.mode, "waking");
  assert.ok(events.some((e) => e.type === "wake-target"));
  assert.ok(events.some((e) => e.type === "meow" && e.durationMs === 3000));
  b.tick(305000);
  assert.equal(b.mode, "walking");
  b.arrive(306000);
  assert.equal(b.mode, "lying-down");
  b.tick(307300);
  assert.equal(b.mode, "lying");
  const d = new Behavior();
  d.begin("sleeping", 0, 600000);
  d.begin("waking", 1000);
  assert.equal(d.mode, "waking");
});
test("sleep supports double click quota and drag without waking", () => {
  const b = new Behavior();
  b.begin("sleeping", 0, 600000);
  b.tick(2000);
  click(b, 2100);
  click(b, 2250);
  assert.deepEqual(b.tick(2300), [{ type: "quota" }]);
  b.pointerDown(2400, 0, 0);
  b.pointerMove(2800, 20, 0);
  b.pointerUp(2900);
  assert.equal(b.mode, "sleeping");
  assert.equal(b.until, 602000);
});
test("ball and canned feeding last one minute; chase begins pounce then indefinite run", () => {
  const b = new Behavior();
  for (const mode of ["ball", "feeding"] as const) {
    b.begin(mode, 0);
    b.tick(59999);
    assert.equal(b.mode, mode);
    b.tick(60000);
    assert.equal(b.mode, "idle");
  }
  b.begin("chase", 100000);
  assert.equal(b.mode, "chase-pounce");
  b.tick(101300);
  assert.equal(b.mode, "chase");
  b.tick(3600000);
  assert.equal(b.mode, "chase");
});
test("idle no longer emits fifteen-minute attention reminder", () => {
  const b = new Behavior();
  assert.deepEqual(b.tick(900000), []);
  assert.equal(b.mode, "idle");
});
test("wallclock half-hour and midnight chime once, no duplicate on backward clock", () => {
  for (const boundary of [
    new Date(2026, 9, 30, 12, 30).getTime(),
    new Date(2026, 9, 31, 0, 0).getTime(),
  ]) {
    const b = new Behavior(boundary - 800);
    assert.equal(b.tick(boundary).filter((a) => a.type === "meow").length, 1);
    assert.deepEqual(b.tick(boundary + 100), []);
    b.tick(boundary - 500);
    assert.deepEqual(b.tick(boundary), []);
  }
});
test("sleep mute and suspended boundaries skip without catchup", () => {
  const at = new Date(2026, 9, 30, 13, 0).getTime();
  for (const kind of ["sleep", "mute", "suspend"] as const) {
    const b = new Behavior(at - 1000);
    if (kind === "sleep") {
      b.begin("sleeping", at - 1000, 300000);
    }
    if (kind === "mute") b.muted = true;
    if (kind === "suspend") b.suspend();
    assert.deepEqual(b.tick(at), []);
    b.muted = false;
    if (kind === "suspend") b.resume(at + 500);
    assert.deepEqual(b.tick(at + 600), []);
  }
  const b = new Behavior(at - 60000);
  assert.deepEqual(b.tick(at + 500), []);
});
test("song permits interactive meows and sleep/suspend stop song", () => {
  const b = new Behavior();
  b.toggleSong();
  click(b, 100);
  assert.equal(b.tick(500).filter((e) => e.type === "meow").length, 1);
  b.begin("sleeping", 600);
  assert.equal(b.songPlaying, false);
  b.toggleSong();
  b.suspend();
  assert.equal(b.songPlaying, false);
});
test("song does not suppress half-hour chime", () => {
  const at = new Date(2026, 9, 30, 13, 30).getTime();
  const b = new Behavior(at - 500);
  b.songPlaying = true;
  assert.deepEqual(b.tick(at), [
    { type: "meow", count: 1, durationMs: undefined },
  ]);
});
test("movement is time-based, reaches exact target without overshoot and clamps multiple displays", () => {
  const p = stepToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 0.1);
  assert.equal(p.x, 10);
  assert.equal(stepToward({ x: 99, y: 0 }, { x: 100, y: 0 }, 100, 0.1).x, 100);
  assert.deepEqual(
    clampAnchor({ x: -500, y: 300 }, [
      { x: 0, y: 0, width: 1000, height: 800 },
      { x: -1000, y: 0, width: 1000, height: 800 },
    ]),
    { x: -500, y: 300 },
  );
  assert.deepEqual(
    clampAnchor({ x: 1, y: 1 }, [{ x: 0, y: 0, width: 1000, height: 800 }]),
    { x: 96, y: 104 },
  );
});
