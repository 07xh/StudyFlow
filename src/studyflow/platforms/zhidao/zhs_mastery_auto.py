"""Course-wide, browser-free background scheduler for Zhidao AI-course mastery.

The existing zhs_mastery_service remains the only HTTP transport. This module
owns scheduling, bounded answer trials and persistence, not a second protocol.

No credentials or responses are written to the local files. The official
platform alone decides mastery; unfinished and ambiguous submissions are never
reported as completed, and the same POST is never retried.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any

from studyflow.platforms.zhidao import zhs_mastery_service as service

DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".studyflow") / "StudyFlow" / "ZhidaoMasteryAuto"
STATUS_PATH = DATA / "status.json"
BANK_PATH = DATA / "answer-bank.sqlite3"
_LOCK = threading.RLock()
_THREAD: threading.Thread | None = None
_STOP = threading.Event()
_RESUME = threading.Event()
_RESUME.set()
_STATUS: dict[str, Any] = {}

DEFAULTS = {"target": 100, "max_rounds": 12, "stagnation_rounds": 3, "max_minutes": 180}
CHOICE_TYPES = (1, 2, 14)


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _save(snapshot: dict[str, Any]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    temp = STATUS_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    temp.replace(STATUS_PATH)


def _loaded() -> dict[str, Any]:
    try:
        data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        if data.get("state") in {"running", "paused", "stopping", "starting"}:
            data["state"] = "interrupted"
            data["message"] = "应用上次退出时任务尚未结束。不会自动重发交卷请求。"
        return data
    except (OSError, ValueError):
        return {}


def _update(**fields: Any) -> None:
    with _LOCK:
        _STATUS.update(fields)
        _STATUS["updated_at"] = _utc()
        _save(_STATUS.copy())


def _step(course_key: str, point: dict[str, Any], *, done: bool = False,
          reason: str = "", mastery: int | float | None = None) -> None:
    with _LOCK:
        tasks = _STATUS.setdefault("tasks", [])
        task = next((x for x in tasks if x["knowledge_id"] == point["knowledge_id"]), None)
        if task is not None:
            task["state"] = "done" if done else "skipped"
            task["reason"] = reason
            if mastery is not None:
                task["mastery"] = mastery
        _STATUS["done"] = sum(x["state"] == "done" for x in tasks)
        _STATUS["skipped"] = sum(x["state"] == "skipped" for x in tasks)
        _STATUS["processed"] = _STATUS["done"] + _STATUS["skipped"]
        _STATUS["updated_at"] = _utc()
        _save(_STATUS.copy())


def _progress(point: dict[str, Any], **fields: Any) -> None:
    with _LOCK:
        task = next((x for x in _STATUS.get("tasks", [])
                     if x["knowledge_id"] == point["knowledge_id"]), None)
        if task is not None:
            task.update(fields)
        _STATUS["updated_at"] = _utc()
        _save(_STATUS.copy())


def _checkpoint(deadline: float) -> None:
    if time.monotonic() > deadline:
        raise StopRequested("已到达本次运行时长上限")
    if _STOP.is_set():
        raise StopRequested("已停止：不会继续提交或新建试卷")
    while not _RESUME.wait(0.2):
        if _STOP.is_set():
            raise StopRequested("已停止：不会继续提交或新建试卷")
        if time.monotonic() > deadline:
            raise StopRequested("已到达本次运行时长上限")


class StopRequested(RuntimeError):
    pass


def _normalize(value: Any) -> str:
    text = unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip().casefold()


def _identity(question: dict[str, Any]) -> tuple[str, list[tuple[int, str]]]:
    qtype = question.get("question_type")
    options = question.get("options") or []
    pairs: list[tuple[int, str]] = []
    for option in options:
        if type(option.get("id")) is not int:
            return "", []
        pairs.append((option["id"], _normalize(option.get("content"))))
    texts = [text for _, text in pairs]
    if (not _normalize(question.get("content"))
            or any(not text for text in texts) or len(texts) != len(set(texts))):
        return "", []
    seed = json.dumps(
        [qtype, _normalize(question["content"]), sorted(texts)],
        ensure_ascii=False, separators=(",", ":"),
    )
    return hashlib.sha256(seed.encode("utf-8")).hexdigest(), pairs


class AnswerBank:
    """Verified correct options plus bounded choices tried on prior rounds."""

    def __init__(self, path: Path = BANK_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS answers "
            "(identity TEXT PRIMARY KEY, choice_texts TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS trials "
            "(identity TEXT NOT NULL, choice_texts TEXT NOT NULL, "
            "PRIMARY KEY(identity, choice_texts))"
        )
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def _known(self, identity: str) -> list[str] | None:
        row = self.db.execute("SELECT choice_texts FROM answers WHERE identity=?", (identity,)).fetchone()
        return json.loads(row[0]) if row else None

    def choose(self, question: dict[str, Any]) -> tuple[Any, str, list[str]]:
        identity, pairs = _identity(question)
        qtype = question.get("question_type")
        if not identity:
            raise ValueError("题目或选项不完整，需要手动处理")
        known = self._known(identity)
        if qtype == 3:
            # Known fill answers may only come from a prior officially released
            # answer. Trial text is not fabricated.
            if known is None:
                raise ValueError("填空题没有已验证答案，需要手动补充")
            return known if len(known) > 1 else known[0], identity, known
        if qtype not in CHOICE_TYPES or not (2 <= len(pairs) <= 8):
            raise ValueError("当前题型或选项数量不支持自动试答")
        by_text = {text: option_id for option_id, text in pairs}
        if known is not None and all(item in by_text for item in known):
            values = [by_text[item] for item in known]
            return (values if qtype == 2 else values[0]), identity, known

        # Deterministic trial sequence: enumerate untried answers, not a
        # random answer that can repeat forever. Multi-choice is capped.
        sorted_texts = sorted(by_text)
        sizes = range(1, len(pairs) + 1) if qtype == 2 else (1,)
        for size in sizes:
            for combo in itertools.combinations(sorted_texts, size):
                choice_texts = list(combo)
                key = json.dumps(choice_texts, ensure_ascii=False)
                tried = self.db.execute(
                    "SELECT 1 FROM trials WHERE identity=? AND choice_texts=?",
                    (identity, key),
                ).fetchone()
                if not tried:
                    values = [by_text[item] for item in choice_texts]
                    return (values if qtype == 2 else values[0]), identity, choice_texts
        raise ValueError("已尝试所有可用选项组合，但仍没有已验证答案")

    def attempted(self, identity: str, choice_texts: list[str]) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO trials(identity,choice_texts) VALUES(?,?)",
            (identity, json.dumps(sorted(choice_texts), ensure_ascii=False)),
        )
        self.db.commit()

    def confirm(self, question: dict[str, Any], graded: dict[str, Any],
                chosen_texts: list[str]) -> bool:
        identity, pairs = _identity(question)
        if not identity or not isinstance(graded, dict):
            return False
        answer_texts: list[str] = []
        if question.get("question_type") == 3:
            if graded.get("isCorrect") is True:
                answer_texts = chosen_texts
            else:
                answer_texts = [
                    _normalize(text) for text in graded.get("correctTexts") or []
                    if _normalize(text)
                ]
        else:
            correct_ids = {str(v) for v in (graded.get("correctOptionIds") or [])}
            answer_texts = sorted(text for option_id, text in pairs if str(option_id) in correct_ids)
            if not answer_texts and graded.get("isCorrect") is True:
                answer_texts = sorted(chosen_texts)
        if not answer_texts:
            return False
        self.db.execute(
            "INSERT INTO answers(identity,choice_texts,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(identity) DO UPDATE SET "
            "choice_texts=excluded.choice_texts,updated_at=excluded.updated_at",
            (identity, json.dumps(answer_texts, ensure_ascii=False), _utc()),
        )
        self.db.commit()
        return True


def _execute_point(
    course_key: str, point: dict[str, Any], bank: AnswerBank,
    config: dict[str, int], deadline: float,
) -> tuple[bool, str, int | float | None]:
    kid = point["knowledge_id"]
    before = point.get("mastery")
    score: int | float | None = before
    stagnant = 0
    for round_index in range(1, config["max_rounds"] + 1):
        _checkpoint(deadline)
        _progress(point, state="working", rounds=round_index,
                  reason="正在读取本轮题目", mastery=score)
        active = service.active_round(course_key, kid)
        if active is not None:
            # Do not overwrite an unsubmitted manual draft or an ambiguous POST.
            return False, "已有未解决的练习卷，请先在手动界面处理", score
        paper = service.start_round(course_key, kid)
        selections: list[tuple[dict[str, Any], str, list[str]]] = []
        try:
            for question in paper["questions"]:
                _checkpoint(deadline)
                choice, identity, texts = bank.choose(question)
                selections.append((question, identity, texts))
                service.save_answer(course_key, kid, str(question["question_id"]), choice)

            _checkpoint(deadline)
            # Read the server's answerCount before submitting, not only our
            # in-memory save counter.
            check = service.check_saved_answers(course_key, kid)
            if not check["complete"] or check["answered"] != len(paper["questions"]):
                raise ValueError("服务器尚未确认整卷答案保存，未提交")
            _checkpoint(deadline)
            _progress(point, state="working", reason="正在提交本轮并核验官方结果")
            _update(submitting={"knowledge_id": kid, "exam_test_id": paper["exam_test_id"]})
            # The service's state machine ensures an unknown POST is never resent.
            result = service.submit_round(course_key, kid)
            for _ in range(3):
                if not result.get("verification_pending"):
                    break
                _checkpoint(deadline)
                time.sleep(1.5)
                result = service.submit_round(course_key, kid)  # read-only after submit
            if result.get("verification_pending"):
                return False, "本轮交卷后判分或掌握度未确认；已停止该知识点", score
            # Verified server readback is complete; safe to clear the pending
            # submission marker before preparing a fresh paper.
            _update(submitting=None)
            graded = {str(item["questionId"]): item for item in result.get("graded", [])}
            for question, identity, texts in selections:
                entry = graded.get(str(question["question_id"]))
                bank.attempted(identity, texts)
                if entry is not None:
                    bank.confirm(question, entry, texts)
            latest = result.get("high_mastery_now")
            if latest is None:
                return False, "服务器未返回可确认的掌握度", score
            if score is not None and latest <= score:
                stagnant += 1
            else:
                stagnant = 0
            score = latest
            _progress(point, rounds=round_index, mastery=score, reason="本轮已核验")
            if score >= config["target"]:
                return True, "掌握度达到目标", score
            if stagnant >= config["stagnation_rounds"]:
                return False, "连续多轮无进步，已停止该知识点", score
        except StopRequested:
            raise
        except service.MasteryError as exc:
            if exc.code in {"SUBMIT_STATUS_UNKNOWN", "SUBMIT_IN_PROGRESS"}:
                return False, "交卷状态未明确，未重复发送提交", score
            return False, "接口错误：" + exc.code, score
        except ValueError as exc:
            return False, str(exc)[:120], score
        except Exception:
            return False, "请求异常；本卷保留，未自动重试交卷", score
    return False, "达到单知识点最大轮次，未保证满分", score


def _run(course_key: str, config: dict[str, int]) -> None:
    bank: AnswerBank | None = None
    try:
        deadline = time.monotonic() + config["max_minutes"] * 60
        _update(state="running", message="正在获取课程全部章节与掌握度")
        catalog = service.read_catalog(course_key, with_mastery=True)
        tasks = []
        for item in catalog["knowledge"]:
            tasks.append({
                "knowledge_id": item["knowledge_id"], "name": item["name"],
                "theme": item["theme"], "mastery": item.get("mastery"),
                "state": "pending", "rounds": 0, "reason": "",
            })
        _update(total=len(tasks), tasks=tasks, course_name=catalog["course_name"])
        bank = AnswerBank()
        for item in catalog["knowledge"]:
            _checkpoint(deadline)
            _update(current={"knowledge_id": item["knowledge_id"],
                             "name": item["name"], "theme": item["theme"]})
            if item["knowledge_id"] in _STATUS.get("blocked", []):
                _step(course_key, item, done=False,
                      reason="上次交卷状态不确定，已保护该知识点不重复提交")
                continue
            if item.get("free_exam"):
                _step(course_key, item, done=False, reason="官方免考知识点")
                continue
            value = item.get("mastery")
            if value is None:
                _step(course_key, item, done=False, reason="无法读取真实掌握度")
                continue
            if value >= config["target"]:
                _step(course_key, item, done=True, reason="服务器已达标", mastery=value)
                continue
            passed, reason, final_score = _execute_point(course_key, item, bank, config, deadline)
            _step(course_key, item, done=passed, reason=reason, mastery=final_score)
        _update(state="completed", current=None, submitting=None,
                message="已扫描课程全部章节；未达标或需手动处理的知识点已单独标明")
    except StopRequested as error:
        _update(state="stopped", message=str(error), current=None)
    except Exception:
        _update(state="error", message="后台任务运行失败；可查看已保存的进度", current=None)
    finally:
        if bank is not None:
            bank.close()


def start(course_key: str, options: Any = None) -> dict[str, Any]:
    if not isinstance(course_key, str) or not re.fullmatch(r"[0-9a-f]{64}", course_key):
        raise service.MasteryError("INVALID_REQUEST")
    raw = options if isinstance(options, dict) else {}
    config = {}
    for field, low, high in (
        ("target", 1, 100),
        ("max_rounds", 1, 30),
        ("stagnation_rounds", 1, 10),
        ("max_minutes", 1, 720),
    ):
        value = raw.get(field, DEFAULTS[field])
        if type(value) is not int or not low <= value <= high:
            raise service.MasteryError("INVALID_REQUEST")
        config[field] = value
    with _LOCK:
        global _THREAD
        if _THREAD is not None and _THREAD.is_alive():
            raise service.MasteryError("MASTERY_AUTO_RUNNING")
        prior = _loaded()
        blocked = list(prior.get("blocked", [])) if prior.get("course_key") == course_key else []
        # A previous process may have died after the POST reached the server.
        # Never blindly resubmit or create another paper for that point.
        if prior.get("course_key") == course_key and isinstance(prior.get("submitting"), dict):
            pending_id = prior["submitting"].get("knowledge_id")
            if isinstance(pending_id, str) and pending_id not in blocked:
                blocked.append(pending_id)
        _STOP.clear()
        _RESUME.set()
        _STATUS.clear()
        _STATUS.update({
            "run_id": uuid.uuid4().hex, "course_key": course_key,
            "state": "starting", "message": "正在启动", "config": config,
            "total": 0, "processed": 0, "done": 0, "skipped": 0,
            "current": None, "submitting": None, "blocked": blocked, "tasks": [], "updated_at": _utc(),
        })
        _save(_STATUS.copy())
        _THREAD = threading.Thread(
            target=_run, args=(course_key, config), daemon=True,
            name="zhidao-mastery-auto",
        )
        _THREAD.start()
        return deepcopy(_STATUS)


def status(course_key: str) -> dict[str, Any]:
    with _LOCK:
        snapshot = deepcopy(_STATUS) if _STATUS else _loaded()
    if snapshot.get("course_key") != course_key:
        return {"state": "idle", "total": 0, "processed": 0, "done": 0,
                "skipped": 0, "tasks": [], "message": "", "current": None}
    return snapshot


def control(course_key: str, action: str) -> dict[str, Any]:
    if action not in {"pause", "resume", "stop"}:
        raise service.MasteryError("INVALID_REQUEST")
    with _LOCK:
        if not _THREAD or not _THREAD.is_alive() or _STATUS.get("course_key") != course_key:
            raise service.MasteryError("MASTERY_AUTO_NOT_RUNNING")
        if action == "pause":
            _RESUME.clear()
            _update(state="paused", message="已暂停，将在当前 HTTP 调用结束后生效")
        elif action == "resume":
            _RESUME.set()
            _update(state="running", message="继续处理后续练习")
        else:
            _STOP.set()
            _RESUME.set()
            _update(state="stopping", message="正在安全停止，不再开始下一次交卷")
    return status(course_key)
