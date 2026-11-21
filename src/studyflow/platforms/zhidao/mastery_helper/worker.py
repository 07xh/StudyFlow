"""Background-only ZhiHuiShuHelper worker; no Tk or standalone UI."""
from __future__ import annotations
import contextlib
import json
import os
from pathlib import Path
import sys
import time
from . import mastery as m
from .private_state import PrivateStore, CookieKeeper
from .settings import ROOT, DATA, load_config, save_work_url


class Reporter:
    def __init__(self):
        self.file = ROOT / "status.json"
        self.stop_file = ROOT / "stop.flag"
        self.pause_file = ROOT / "pause.flag"
        self.started = time.time()
        self.state = {"state": "starting", "phase": "准备运行", "message": "",
                      "mastery": None, "round": 0, "points_completed": 0,
                      "points_skipped": 0, "bank_hit": 0, "ai_count": 0,
                      "api_calls": 0, "course": "", "chapter": "",
                      "knowledge": "", "question": "", "logs": [], "updated_at": self.started}
        self.stop_file.unlink(missing_ok=True)
        self.pause_file.unlink(missing_ok=True)
        self.save()

    def save(self):
        self.state["updated_at"] = time.time()
        tmp = self.file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.file)

    def emit(self, kind, **values):
        if kind == "phase":
            self.state["phase"] = str(values.get("status", ""))[:80]
            self.state["message"] = str(values.get("message", ""))[:260]
        elif kind == "metadata":
            self.state["course"] = str(values.get("course_title", ""))[:120]
            self.state["chapter"] = str(values.get("chapter_title", ""))[:120]
            self.state["knowledge"] = str(values.get("knowledge_title", ""))[:120]
            self.state["mastery"] = None
            self.state["round"] = 0
        elif kind == "round":
            self.state["round"] = int(values.get("round", 0))
        elif kind == "score":
            self.state["mastery"] = values.get("mastery")
        elif kind == "answered":
            key = "bank_hit" if values.get("source") == "bank" else "ai_count"
            self.state[key] += 1
        elif kind == "metrics":
            self.state["api_calls"] = int(values.get("api_calls", 0))
        elif kind == "question":
            self.state["question"] = str(values.get("question", ""))[:180]
        elif kind == "point_done":
            self.state["points_completed"] += 1
        elif kind == "point_skipped":
            self.state["points_skipped"] += 1
        elif kind == "log":
            line = str(values.get("message", "")).strip()[:220]
            if line:
                self.state["logs"] = (self.state["logs"] + [line])[-12:]
        self.save()

    def checkpoint(self):
        if self.stop_file.exists():
            raise m.Halt("用户已停止任务")
        if self.pause_file.exists():
            self.state["phase"] = "已暂停"
            self.save()
        start = time.monotonic()
        while self.pause_file.exists():
            if self.stop_file.exists():
                raise m.Halt("用户已停止任务")
            time.sleep(0.15)
        if self.state["phase"] == "已暂停":
            self.state["phase"] = "运行中"
            self.save()
        return time.monotonic() - start

    def take_api_limit_update(self):
        return None

    def wait_for_retry(self, stage, message, reason=None):
        # Unattended worker must not block forever on an invisible console prompt.
        self.emit("phase", status="需要处理", message=f"{stage}：{str(message)[:190]}")
        raise m.Halt("当前步骤需要人工处理；保存题库后可重新启动")


class LogStream:
    def __init__(self, reporter):
        self.reporter = reporter
        self.buf = ""

    def write(self, value):
        self.buf += str(value)
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            self.reporter.emit("log", message=line)
        return len(value)

    def flush(self):
        if self.buf:
            self.reporter.emit("log", message=self.buf)
            self.buf = ""


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    reporter = Reporter()
    bank = None
    context = None
    log = LogStream(reporter)
    try:
        cfg = load_config()
        api_key = PrivateStore(DATA).load_key()
        if not api_key:
            raise m.Halt("请先在学序「掌握度」设置中填写 DeepSeek API Key")
        from playwright.sync_api import sync_playwright
        bank = m.Bank(DATA / "question-bank.sqlite3")
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            with sync_playwright() as pw:
                # The first authorized login needs a visible official browser.
                # Subsequent runs use the saved official exercise URL in headless Edge.
                saved_url = cfg.get("last_work_url")
                headless = bool(saved_url)
                reporter.emit("phase", status="启动中" if headless else "等待登录",
                              message="正在静默进入已保存的知识点" if headless else "请在打开的 Edge 中登录并进入目标掌握度练习，之后即可静默运行")
                options = {"channel": cfg.get("browser", "msedge")}
                context = pw.chromium.launch_persistent_context(str(DATA / "browser-profile"),
                    headless=headless, viewport={"width": 1440, "height": 950},
                    args=m.BROWSER_BACKGROUND_ARGS, **options)
                m.watch_image_responses(context)
                cookies = CookieKeeper(context, PrivateStore(DATA))
                cookies.restore()
                try:
                    page = context.pages[0] if context.pages else context.new_page()
                    page.set_default_timeout(10000)
                    page.goto(saved_url or cfg["url"], wait_until="domcontentloaded", timeout=60000)
                    limits = m.Limits(cfg, reporter, on_checkpoint=cookies.maybe_save)
                    page = m.wait_for_work_page(context, page, cfg, reporter, on_poll=cookies.maybe_save)
                    # Only remember a verified exercise page, never a login page.
                    save_work_url(page.url)
                    cookies.maybe_save(force=True)
                    reporter.emit("phase", status="运行中", message="已识别掌握度练习，开始处理")
                    score = m.run_course(context, page, cfg, bank, limits,
                        ai=m.DeepSeek(cfg, limits, api_key=api_key))
                    reporter.state["mastery"] = score
                    reporter.state["state"] = "completed"
                    reporter.emit("phase", status="已完成", message="当前知识点范围已处理完成")
                finally:
                    try:
                        cookies.maybe_save(force=True)
                    finally:
                        context.close()
                        context = None
    except Exception as error:
        reporter.state["state"] = "stopped" if reporter.stop_file.exists() else "error"
        message = str(error) if isinstance(error, (m.Halt, ValueError)) else "运行异常：" + type(error).__name__
        reporter.emit("phase", status="已停止" if reporter.state["state"] == "stopped" else "需要处理", message=message[:240])
        return 1
    finally:
        if bank is not None:
            try:
                bank.export(DATA / "question-bank.json")
                bank.close()
            except Exception:
                pass
        log.flush()
        reporter.save()
    return 0


if __name__ == "__main__":
    sys.exit(main())
