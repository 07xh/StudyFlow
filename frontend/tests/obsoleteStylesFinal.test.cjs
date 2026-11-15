const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const readCss = (file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("obsolete styles do not reappear in the unified platform UI", () => {
  const style = readCss("style.css");
  const foundation = readCss("ui/foundation.css");
  for (const obsolete of ["login-v2", "sf-zd-detail-filters", "sf-zd-filter-count"]) {
    assert.doesNotMatch(style, new RegExp("\\." + obsolete + "(?![\\w-])"), obsolete);
  }
  for (const obsolete of [
    "sf-platform-task-section",
    "sf-task-shortcut",
    "sf-zhs-local",
    "sf-zd-mode-selector",
    "sf-live-course-progress",
    "sf-live-course-heading",
    "credential-form",
  ]) {
    assert.doesNotMatch(foundation, new RegExp("\\." + obsolete + "(?![\\w-])"), obsolete);
  }
});

test("shared controls and server-evidence styles stay available", () => {
  const style = readCss("style.css");
  const foundation = readCss("ui/foundation.css");
  assert.match(style, /\\.sf-ykt-single-recheck\\b/);
  for (const live of [
    "sf-provider-blue",
    "sf-verified-track",
    "sf-live-state",
    "sf-zd-mode-options",
  ]) {
    assert.match(foundation, new RegExp("\\." + live + "(?![\\w-])"), live);
  }
  assert.match(foundation, /:is\\(\\.main,\\.sf-settings-modal-body\\)/);
});
