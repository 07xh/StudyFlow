const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/studyflow-startup.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

function createHarness(storedTheme = "dark", options = {}) {
  let now = 0;
  let sequence = 0;
  let mounted = options.mounted !== false;
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
  const reactRoot = {get firstElementChild() { return mounted ? {} : null; }};
  const document = {
    documentElement: root, readyState: "complete",
    getElementById: id => ({
      root: reactRoot,
      "studyflow-startup": node,
      "studyflow-startup-skip": button,
      "studyflow-startup-message": message
    }[id] || null)
  };
  const window = {
    localStorage: {getItem: () => storedTheme},
    matchMedia: query => ({matches: query.includes("reduced-motion") ? options.reducedMotion === true : false}),
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
  return {window, root, classes, message, advance, isRemoved: () => removed, skip: () => skipHandler(), setMounted: value => { mounted = value; }};
}

test("splash prepaints before React without CSP-blocked inline scripts", () => {
  assert.match(markup, /<script src="\/studyflow-startup\.js"><\/script>/);
  assert.match(markup, /<div id="studyflow-startup"/);
  assert.match(markup, /<div id="root"><\/div>/);
  assert.match(markup, /prefers-reduced-motion: reduce/);
  assert.match(markup, /opacity 180ms ease/);
  assert.doesNotMatch(markup, /<script>(?!\s*<\/script>)/);
});

test("splash uses StudyFlow's saved appearance before React loads", () => {
  const light = createHarness("light");
  const system = createHarness("system");
  assert.equal(light.root.dataset.studyflowStartupTheme, "light");
  assert.equal(system.root.dataset.studyflowStartupTheme, "light");
  assert.equal(createHarness("invalid").root.dataset.studyflowStartupTheme, "dark");
});

test("warm startup uses a shorter minimum display and an idempotent fade-out", () => {
  const h = createHarness();
  h.window.studyflowStartupReady();
  h.window.studyflowStartupReady();
  h.advance(519);
  assert.equal(h.classes.has("sf-startup--leaving"), false);
  h.advance(1);
  assert.equal(h.classes.has("sf-startup--leaving"), true);
  assert.equal(h.isRemoved(), false);
  h.advance(180);
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
  h.advance(180);
  assert.equal(h.isRemoved(), true);
});

test("cold startup exits at readiness without a second fixed wait", () => {
  const h = createHarness();
  h.advance(1100);
  h.window.studyflowStartupReady();
  h.advance(0);
  assert.equal(h.classes.has("sf-startup--leaving"), true);
  h.advance(180);
  assert.equal(h.isRemoved(), true);
});

test("reduced-motion mode removes the cover immediately", () => {
  const h = createHarness("dark", {reducedMotion: true});
  h.window.studyflowStartupReady();
  h.advance(0);
  assert.equal(h.isRemoved(), true);
});

test("the slow-start skip never reveals a blank React root", () => {
  const h = createHarness("dark", {mounted: false});
  h.advance(12000);
  assert.equal(h.classes.has("sf-startup--slow"), false);
  assert.match(h.message.textContent, /主界面尚未就绪/);
  h.skip();
  h.advance(180);
  assert.equal(h.isRemoved(), false);
  h.setMounted(true);
  h.advance(350);
  assert.equal(h.classes.has("sf-startup--slow"), true);
  h.skip();
  h.advance(180);
  assert.equal(h.isRemoved(), true);
});

test("the consent check has one deadline and discards stale requests", () => {
  const gate = fs.readFileSync(path.join(__dirname, "../src/components/StudyFlowConsentGate.tsx"), "utf8");
  assert.match(gate, /withTimeout\(readConsent\(\)\)/);
  assert.match(gate, /const revision=\+\+checkRevision\.current/);
  assert.match(gate, /if\(revision!==checkRevision\.current\)return/);
  assert.match(gate, /CONSENT_READ_TIMEOUT/);
});
