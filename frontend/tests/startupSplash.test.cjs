const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/studyflow-startup.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

function createHarness(storedTheme = "dark") {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const classes = new Set();
  let removed = false;
  let skipHandler;
  const root = {dataset: {}};
  const node = {
    classList: {add: value => classes.add(value)},
    remove: () => { removed = true; }
  };
  const button = {addEventListener: (_, handler) => { skipHandler = handler; }};
  const message = {textContent: "正在打开学习空间…"};
  const document = {
    documentElement: root, readyState: "complete",
    getElementById: id => ({
      "studyflow-startup": node,
      "studyflow-startup-skip": button,
      "studyflow-startup-message": message
    }[id] || null)
  };
  const window = {
    localStorage: {getItem: () => storedTheme},
    matchMedia: () => ({matches: false}),
    setTimeout(fn, delay) {
      const id = ++sequence;
      timers.set(id, {due: now + delay, fn});
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, {document, window, performance: {now: () => now}});
  function advance(ms) {
    const finish = now + ms;
    while (true) {
      const upcoming = [...timers].filter(([, v]) => v.due <= finish).sort((a, b) => a[1].due - b[1].due)[0];
      if (!upcoming) break;
      now = upcoming[1].due;
      timers.delete(upcoming[0]);
      upcoming[1].fn();
    }
    now = finish;
  }
  return {window, root, classes, message, advance, isRemoved: () => removed, skip: () => skipHandler()};
}

test("splash prepaints before React without CSP-blocked inline scripts", () => {
  assert.match(markup, /<script src="\/studyflow-startup\.js"><\/script>/);
  assert.match(markup, /<div id="studyflow-startup"/);
  assert.match(markup, /<div id="root"><\/div>/);
  assert.match(markup, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(markup, /<script>(?!\s*<\/script>)/);
});

test("splash uses StudyFlow's saved appearance before React loads", () => {
  const light = createHarness("light");
  const system = createHarness("system");
  assert.equal(light.root.dataset.studyflowStartupTheme, "light");
  assert.equal(system.root.dataset.studyflowStartupTheme, "light");
  assert.equal(createHarness("invalid").root.dataset.studyflowStartupTheme, "dark");
});

test("ready signal uses a minimum display and an idempotent fade-out", () => {
  const h = createHarness();
  h.window.studyflowStartupReady();
  h.window.studyflowStartupReady();
  h.advance(649);
  assert.equal(h.classes.has("sf-startup--leaving"), false);
  h.advance(1);
  assert.equal(h.classes.has("sf-startup--leaving"), true);
  assert.equal(h.isRemoved(), false);
  h.advance(240);
  assert.equal(h.isRemoved(), true);
});

test("slow startup allows a manual skip without faking progress", () => {
  const h = createHarness();
  h.advance(3200);
  assert.equal(h.classes.has("sf-startup--slow"), true);
  h.advance(8800);
  assert.match(h.message.textContent, /启动耗时较长/);
  assert.equal(h.isRemoved(), false);
  h.skip();
  h.advance(240);
  assert.equal(h.isRemoved(), true);
});
