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

  var reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (_) { /* Use normal animation. */ }
  var minVisibleMs = reducedMotion ? 0 : 520;
  var fadeMs = reducedMotion ? 0 : 180;
  var startedAt = performance.now();
  var leaving = false;
  var slowTimer;
  var slowWarningTimer;
  function splash() { return document.getElementById("studyflow-startup"); }
  function appMounted() {
    var node = document.getElementById("root");
    return !!(node && node.firstElementChild);
  }

  function dismiss() {
    if (leaving) return;
    leaving = true;
    window.clearTimeout(slowTimer);
    window.clearTimeout(slowWarningTimer);
    var delay = Math.max(0, minVisibleMs - (performance.now() - startedAt));
    window.setTimeout(function () {
      var node = splash();
      if (!node) return;
      node.classList.add("sf-startup--leaving");
      window.setTimeout(function () { node.remove(); }, fadeMs);
    }, delay);
  }

  // A slow-start skip must never uncover an empty React root.
  function offerSkipWhenMounted() {
    if (leaving) return;
    if (appMounted()) {
      var node = splash();
      if (node) node.classList.add("sf-startup--slow");
    } else {
      slowTimer = window.setTimeout(offerSkipWhenMounted, 350);
    }
  }

  // Called after React has mounted and consent state has resolved.
  window.studyflowStartupReady = dismiss;
  slowTimer = window.setTimeout(offerSkipWhenMounted, 3200);
  slowWarningTimer = window.setTimeout(function () {
    if (leaving) return;
    var message = document.getElementById("studyflow-startup-message");
    if (message) message.textContent = appMounted()
      ? "启动耗时较长，可先进入学序查看状态"
      : "主界面尚未就绪，请尝试重新打开学序";
  }, 12000);

  function bindSkip() {
    var button = document.getElementById("studyflow-startup-skip");
    if (button) button.addEventListener("click", function () {
      if (appMounted()) dismiss();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSkip, {once: true});
  } else {
    bindSkip();
  }
})();
