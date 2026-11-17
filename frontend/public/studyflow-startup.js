// Runs before React. Keep the UI responsive even when the Python bridge is cold.
(function () {
  "use strict";
  var root = document.documentElement;
  var mode = "dark";
  try {
    var stored = window.localStorage.getItem("studyflow.appearance.v2");
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
  } catch (_) {
    // Match useAppearance's default when storage is unavailable.
  }
  var systemDark = true;
  try { systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch (_) { /* Keep the same fallback as useAppearance. */ }
  root.dataset.studyflowStartupTheme = mode === "system"
    ? (systemDark ? "dark" : "light") : mode;

  var startedAt = performance.now();
  var leaving = false;
  var slowTimer;
  var slowWarningTimer;
  var exitTimer;
  var removeTimer;
  function splash() { return document.getElementById("studyflow-startup"); }

  function dismiss() {
    if (leaving) return;
    leaving = true;
    window.clearTimeout(slowTimer);
    window.clearTimeout(slowWarningTimer);
    var elapsed = Math.max(0, performance.now() - startedAt);
    exitTimer = window.setTimeout(function () {
      var node = splash();
      if (!node) return;
      node.classList.add("sf-startup--leaving");
      removeTimer = window.setTimeout(function () { node.remove(); }, 240);
    }, Math.max(0, 650 - elapsed));
  }

  // App calls this only after its consent check has resolved (accepted / needed / error).
  // A repeated callback from React StrictMode is harmless.
  window.studyflowStartupReady = dismiss;
  slowTimer = window.setTimeout(function () {
    if (leaving) return;
    var node = splash();
    if (node) node.classList.add("sf-startup--slow");
  }, 3200);
  slowWarningTimer = window.setTimeout(function () {
    if (leaving) return;
    var message = document.getElementById("studyflow-startup-message");
    if (message) message.textContent = "启动耗时较长，可先进入学序查看状态";
  }, 12000);

  function bindSkip() {
    var button = document.getElementById("studyflow-startup-skip");
    if (button) button.addEventListener("click", dismiss);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSkip, {once: true});
  } else {
    bindSkip();
  }
})();
