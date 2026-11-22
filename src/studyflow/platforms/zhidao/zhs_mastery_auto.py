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
from studyflow.platforms.zhidao.zhs_mastery_ai import AiAnswerError, suggest as ai_suggest

DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".studyflow") / "StudyFlow" / "ZhidaoMasteryAuto"
STATUS_PATH = DATA / "status.json"
BANK_PATH = DATA / "answer-bank.sqlite3"
_LOCK = threading.RLock()
_THREAD: threading.Thread | None = None
_STOP = threading.Event()
_RESUME = threading.Event()
_RESUME.set()
_STATUS: dict[str, Any] = {}

DEFAULTS = {"target": 100, "max_rounds": 12, "stagnation_rounds": 3, "max_minutes": 180, "max_ai_calls": 30}
FIRST_ROUND_MODES = {"bank_only", "bank_ai", "ai_first", "arbitrary_first"}
CHOICE_TYPES = (1, 2, 14)


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _course_status_path(course_key: str) -> Path:
    """Use a validated course key as the only on-disk journal filename."""
    if not isinstance(course_key, str) or not re.fullmatch(r"[0-9a-f]{64}", course_key):
        raise ValueError("Invalid course status key")
    return DATA / "courses" / f"{course_key}.json"


def _write_snapshot(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)


def _save(snapshot: dict[str, Any]) -> None:
    # Preserve the legacy last-run file for older installations while keeping
    # each course's unresolved submissions independent. A later course start
    # must never erase another course's pending-paper evidence.
    _write_snapshot(STATUS_PATH, snapshot)
    course_key = snapshot.get("course_key")
    if isinstance(course_key, str) and re.fullmatch(r"[0-9a-f]{64}", course_key):
        _write_snapshot(_course_status_path(course_key), snapshot)


def _loaded(course_key: str | None = None) -> dict[str, Any]:
    candidates = [STATUS_PATH]
    if course_key is not None:
        candidates.insert(0, _course_status_path(course_key))
    for path in candidates:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            if course_key is not None and data.get("course_key") != course_key:
                continue
            if data.get("state") in {"running", "paused", "stopping", "starting"}:
                data["state"] = "interrupted"
                data["message"] = "应用上次退出时任务尚未结束。不会自动重发交卷请求。"
            return data
        except (OSError, ValueError):
            continue
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
    # Fill-in questions sometimes carry placeholder optionVos with empty
    # content. These do not identify the question or form a usable choice.
    if qtype == 3:
        options = []
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

    def verified(self, question: dict[str, Any]) -> tuple[Any, str, list[str]] | None:
        """Return an officially confirmed answer, never a speculative trial."""
        identity, pairs = _identity(question)
        if not identity:
            return None
        known = self._known(identity)
        if known is None:
            return None
        kind = question.get("question_type")
        if kind == 3:
            return (known if len(known) > 1 else known[0]), identity, known
        by_text = {text: option_id for option_id, text in pairs}
        if not all(value in by_text for value in known):
            return None
        selected = [by_text[x] for x in known]
        if (kind in (1, 14) and len(selected) != 1) or (kind == 2 and not selected):
            return None
        return (selected if kind == 2 else selected[0]), identity, known

    def choose(self, question: dict[str, Any]) -> tuple[Any, str, list[str]]:
        identity, pairs = _identity(question)
        qtype = question.get("question_type")
        if not identity:
            raise ValueError("题目或选项不完整，需要手动处理")
        verified = self.verified(question)
        if verified is not None:
            return verified
        known = None
        if qtype == 3:
            if known is not None:
                return known if len(known) > 1 else known[0], identity, known
            # The platform may publish the answer *after* grading. Try a
            # clearly labelled placeholder only once for each distinct stem.
            # This isn't an answer key and is never marked verified.
            placeholder = ["待复习"]
            key = json.dumps(placeholder, ensure_ascii=False)
            already_tried = self.db.execute(
                "SELECT 1 FROM trials WHERE identity=? AND choice_texts=?",
                (identity, key),
            ).fetchone()
            if already_tried:
                raise ValueError("未知填空题占位尝试过一次，官方未公布可确认的答案")
            return placeholder[0], identity, placeholder
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
                # Preserve original letter case and punctuation. Some fill-in
                # questions are case-sensitive or have multiple blanks.
                answer_texts = [
                    unescape(re.sub(r"<[^>]*>", " ", str(text))).strip()
                    for text in graded.get("correctTexts") or []
                    if isinstance(text, str) and text.strip()
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


def _arbitrary_first_answer(question: dict[str, Any]) -> tuple[Any, str, list[str]]:
    """Provide a valid but unverified answer for *one complete first paper*.

    Do not consult the bank or AI. This is not a blank submission: use a
    real option ID for choices and a single placeholder for a fill-in blank.
    Server-side answer-count verification still gates the submit POST.
    """
    identity, pairs = _identity(question)
    if not identity:
        raise ValueError("题目格式不完整，无法完成首轮随意作答")
    kind = question.get("question_type")
    if kind == 3:
        return "待复习", identity, ["待复习"]
    if kind in CHOICE_TYPES and pairs:
        option_id, option_text = pairs[0]
        return ([option_id] if kind == 2 else option_id), identity, [option_text]
    raise ValueError("当前题型不支持首轮随意作答")


def _execute_point(
    course_key: str, point: dict[str, Any], bank: AnswerBank,
    config: dict[str, Any], deadline: float, api_key: str = "",
) -> tuple[bool, str, int | float | None]:
    kid = point["knowledge_id"]
    before = point.get("mastery")
    score: int | float | None = before
    stagnant = 0
    ai_attempted: set[str] = set()  # once per distinct question per point/run
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
                mode = config.get("first_round_mode", "bank_only")
                if mode == "arbitrary_first" and round_index == 1:
                    choice, identity, texts = _arbitrary_first_answer(question)
                    selections.append((question, identity, texts))
                    _progress(point, reason="首轮已随意作答（非空白卷，等待官方判分）")
                    service.save_answer(course_key, kid, str(question["question_id"]), choice)
                    _update(trials=_STATUS.get("trials", 0) + 1)
                    continue
                verified = bank.verified(question)
                identity, pairs = _identity(question)
                ai_first = mode == "ai_first" and round_index == 1
                ai_fallback = (mode == "bank_ai" or ai_first) and verified is None
                may_ai = (
                    (ai_first or ai_fallback) and identity not in ai_attempted
                    and bool(api_key) and _STATUS.get("ai_calls", 0) < config.get("max_ai_calls", 30)
                )
                choice = None
                texts: list[str] = []
                source = "trial"
                if may_ai:
                    ai_attempted.add(identity)
                    _update(ai_calls=_STATUS.get("ai_calls", 0) + 1)
                    try:
                        candidate = ai_suggest(question, api_key, deadline - time.monotonic())
                        if question.get("question_type") == 3:
                            texts = candidate if isinstance(candidate, list) else [candidate]
                        else:
                            lookup = dict(pairs)
                            selected = candidate if isinstance(candidate, list) else [candidate]
                            texts = [lookup[option] for option in selected]
                        choice, source = candidate, "ai"
                        _update(ai_used=_STATUS.get("ai_used", 0) + 1)
                    except (AiAnswerError, KeyError):
                        _update(ai_errors=_STATUS.get("ai_errors", 0) + 1)
                        # A third-party AI failure never becomes a confirmed
                        # answer and never triggers repeated network calls.
                if choice is None:
                    if verified is not None:
                        choice, identity, texts = verified
                        source = "bank"
                        _update(bank_hits=_STATUS.get("bank_hits", 0) + 1)
                    else:
                        choice, identity, texts = bank.choose(question)
                        source = "trial"
                        _update(trials=_STATUS.get("trials", 0) + 1)
                selections.append((question, identity, texts))
                _progress(point, reason={"bank":"已验证题库作答", "ai":"AI 建议作答（待判分）",
                                         "trial":"本地有界试答（待判分）"}[source])
                service.save_answer(course_key, kid, str(question["question_id"]), choice)

            _checkpoint(deadline)
            # Read the server's answerCount before submitting, not only our
            # in-memory save counter.
            check = service.check_saved_answers(course_key, kid)
            if not check["complete"] or check["answered"] != len(paper["questions"]):
                raise ValueError("服务器尚未确认整卷答案保存，未提交")
            _checkpoint(deadline)
            _progress(point, state="working", reason="正在提交本轮并核验官方结果")
            marker = {
                "knowledge_id": kid, "exam_test_id": paper["exam_test_id"],
                "exam_paper_id": paper.get("exam_paper_id"),
                "question_ids": [q["question_id"] for q in paper["questions"]],
            }
            _update(submitting=marker)
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
            unknown_fill_not_revealed = False
            for question, identity, texts in selections:
                entry = graded.get(str(question["question_id"]))
                bank.attempted(identity, texts)
                confirmed = bank.confirm(question, entry, texts) if entry is not None else False
                if question.get("question_type") == 3 and not confirmed:
                    unknown_fill_not_revealed = True
            # The official *current* mastery is not the historical maximum.
            # Old test/service fixtures may not yet expose mastery_after, but
            # a present null mastery_after must never be treated as a score.
            after = result.get("mastery_after")
            latest = (after.get("mastery") if isinstance(after, dict)
                      else result.get("high_mastery_now") if "mastery_after" not in result
                      else None)
            if type(latest) not in (int, float) or not 0 <= latest <= 100:
                return False, "服务器未返回可确认的当前掌握度", score
            if score is not None and latest <= score:
                stagnant += 1
            else:
                stagnant = 0
            score = latest
            _progress(point, rounds=round_index, mastery=score, reason="本轮已核验")
            if score >= config["target"]:
                return True, "掌握度达到目标", score
            if unknown_fill_not_revealed:
                return False, "未知填空题已占位作答一次，但平台未公布正确答案；请手动补充", score
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


def _run(course_key: str, config: dict[str, Any], api_key: str = "") -> None:
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
                pending = (_STATUS.get("pending_submissions") or {}).get(item["knowledge_id"])
                verified = None
                # Recover ONLY by authenticated readback. No openExam,
                # saveAnswer or submit call is made for the old paper.
                if (isinstance(pending, dict)
                        and type(pending.get("exam_test_id")) is int
                        and type(pending.get("exam_paper_id")) is int
                        and isinstance(pending.get("question_ids"), list)):
                    try:
                        verified = service.verify_previous_submission(
                            course_key, item["knowledge_id"],
                            pending["exam_test_id"], pending["exam_paper_id"],
                            pending["question_ids"],
                        )
                    except Exception:
                        verified = None
                if not (isinstance(verified, dict) and verified.get("submitted") is True
                        and verified.get("grading_complete") is True
                        and type(verified.get("mastery")) in (int, float)):
                    _step(course_key, item, done=False,
                          reason="上次提交的判分或掌握度仍待核验；不会重复交卷")
                    _update(state="needs_attention", current=None,
                            message="旧试卷未能完整核验，已保护整门课不再继续自动交卷")
                    return
                # Server confirmed both the prior POST and every grading
                # response. Remove just this point's persisted block.
                remaining_blocks = [
                    kid for kid in _STATUS.get("blocked", [])
                    if kid != item["knowledge_id"]
                ]
                remaining_pending = dict(_STATUS.get("pending_submissions") or {})
                remaining_pending.pop(item["knowledge_id"], None)
                _update(blocked=remaining_blocks, pending_submissions=remaining_pending)
                item = dict(item, mastery=verified["mastery"])
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
            # Preserve one authenticated SDK session through this point instead
            # of performing a fresh CAS exchange for every saved question.
            with service.mastery_session_scope(course_key):
                passed, reason, final_score = _execute_point(course_key, item, bank, config, deadline, api_key)
            _step(course_key, item, done=passed, reason=reason, mastery=final_score)
            if _STATUS.get("submitting") is not None:
                # A POST might have been accepted by the server. Do not clear
                # this marker, create new papers or continue submitting other
                # knowledge points until a human verifies the affected round.
                pending_id = _STATUS["submitting"].get("knowledge_id")
                blocked = list(_STATUS.get("blocked", []))
                if pending_id and pending_id not in blocked:
                    blocked.append(pending_id)
                pending = dict(_STATUS.get("pending_submissions") or {})
                if pending_id:
                    pending[pending_id] = dict(_STATUS["submitting"])
                _update(state="needs_attention", blocked=blocked,
                        pending_submissions=pending, current=None,
                        message="交卷状态或判分尚未确认；保留待核验记录，已停止后续自动提交")
                return
        _update(state="completed", current=None,
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
    api_key = raw.get("api_key", "")
    if not isinstance(api_key, str) or len(api_key) > 256:
        raise service.MasteryError("INVALID_REQUEST")
    mode = raw.get("first_round_mode", "bank_only")
    if mode not in FIRST_ROUND_MODES:
        raise service.MasteryError("INVALID_REQUEST")
    if mode in ("bank_ai", "ai_first") and not api_key.strip():
        raise service.MasteryError("AI_KEY_REQUIRED")
    config = {"first_round_mode": mode}
    for field, low, high in (
        ("target", 1, 100),
        ("max_rounds", 1, 30),
        ("stagnation_rounds", 1, 10),
        ("max_minutes", 1, 720),
        ("max_ai_calls", 1, 100),
    ):
        value = raw.get(field, DEFAULTS[field])
        if type(value) is not int or not low <= value <= high:
            raise service.MasteryError("INVALID_REQUEST")
        config[field] = value
    with _LOCK:
        global _THREAD
        if _THREAD is not None and _THREAD.is_alive():
            raise service.MasteryError("MASTERY_AUTO_RUNNING")
        prior = _loaded(course_key)
        blocked = list(prior.get("blocked", []))
        pending = dict(prior.get("pending_submissions") or {})
        # Preserve the original paper identifiers across restarts. A missing
        # examPaperId / question IDs in an older record stays blocked rather
        # than silently creating a replacement paper.
        if isinstance(prior.get("submitting"), dict):
            marker = prior["submitting"]
            pending_id = marker.get("knowledge_id")
            if isinstance(pending_id, str):
                pending[pending_id] = dict(marker)
                if pending_id not in blocked:
                    blocked.append(pending_id)
        _STOP.clear()
        _RESUME.set()
        _STATUS.clear()
        _STATUS.update({
            "run_id": uuid.uuid4().hex, "course_key": course_key,
            "state": "starting", "message": "正在启动", "config": config,
            "total": 0, "processed": 0, "done": 0, "skipped": 0,
            "ai_calls": 0, "ai_used": 0, "ai_errors": 0, "bank_hits": 0, "trials": 0,
            "current": None, "submitting": None, "blocked": blocked,
            "pending_submissions": pending, "tasks": [], "updated_at": _utc(),
        })
        _save(_STATUS.copy())
        _THREAD = threading.Thread(
            target=_run, args=(course_key, config, api_key.strip()), daemon=True,
            name="zhidao-mastery-auto",
        )
        _THREAD.start()
        return deepcopy(_STATUS)


def status(course_key: str) -> dict[str, Any]:
    with _LOCK:
        snapshot = deepcopy(_STATUS) if _STATUS.get("course_key") == course_key else _loaded(course_key)
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
