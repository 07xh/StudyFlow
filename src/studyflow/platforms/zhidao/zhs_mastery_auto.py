"""知到 AI 知识点掌握度习题：纯 HTTP 后台任务。

使用既有 zhs_mastery_service：不另开浏览器/窗口、不再实现加密、
不改视频心跳。仅在题库答案经过官方结果验证，或用户明确启用 AI
并提供临时 API Key 时，自动填写和提交自己的习题。
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from studyflow.platforms.zhidao import zhs_mastery_service as mastery

_LOCK = threading.RLock()
_STOP = threading.Event()
_PAUSE = threading.Event()
_THREAD: threading.Thread | None = None
_STATE: dict[str, Any] = {
    "state": "idle", "phase": "未启动", "message": "", "knowledge": "",
    "course_key": "", "round": 0, "points_done": 0, "points_total": 0,
    "bank_hit": 0, "ai_count": 0, "ai_calls": 0, "mastery": None, "logs": [],
}
_ROOT = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share")) / "StudyFlow"
_BANK = _ROOT / "zhidao-mastery-verified.json"
_BANK_LOCK = threading.RLock()
_API_URL = "https://api.deepseek.com/chat/completions"


class AutoStop(Exception):
    """用户取消当前任务。"""


class AutoNeedsInput(Exception):
    """缺少可靠答案或服务器结果，留给用户处理。"""


def _emit(*, log: str = "", **changes: Any) -> None:
    with _LOCK:
        _STATE.update(changes)
        if log:
            _STATE["logs"] = (_STATE.get("logs", []) + [str(log)[:180]])[-16:]


def status() -> dict[str, Any]:
    with _LOCK:
        return {**_STATE, "logs": list(_STATE.get("logs", [])),
                "running": _STATE.get("state") in ("running", "paused", "stopping")}


def _checkpoint(deadline: float) -> None:
    if _STOP.is_set():
        raise AutoStop()
    if time.monotonic() >= deadline:
        raise AutoNeedsInput("已达到后台运行时长上限")
    while _PAUSE.is_set():
        _emit(state="paused", phase="已暂停")
        if _STOP.wait(0.15):
            raise AutoStop()
        if time.monotonic() >= deadline:
            raise AutoNeedsInput("已达到后台运行时长上限")
    with _LOCK:
        if _STATE.get("state") == "paused":
            _STATE["state"], _STATE["phase"] = "running", "自动练习中"


def _clean(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def _signature(question: dict[str, Any], course_key: str) -> str:
    options = sorted(_clean(option.get("content")) for option in question.get("options", []))
    payload = json.dumps(
        [course_key, int(question.get("question_type") or 0),
         _clean(question.get("content")), options],
        ensure_ascii=False, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_bank() -> dict[str, list[str]]:
    try:
        if not _BANK.exists() or _BANK.stat().st_size > 2_000_000:
            return {}
        doc = json.loads(_BANK.read_text(encoding="utf-8"))
        if isinstance(doc, dict):
            return {k: v for k, v in doc.items()
                    if isinstance(k, str) and re.fullmatch(r"[0-9a-f]{64}", k)
                    and isinstance(v, list) and v
                    and all(isinstance(item, str) and len(item) <= 2000 for item in v)}
    except (OSError, ValueError):
        pass
    return {}


def _store_verified(signature: str, values: list[str]) -> None:
    if not values or not all(isinstance(x, str) and x for x in values):
        return
    with _BANK_LOCK:
        bank = _load_bank()
        bank[signature] = values
        _ROOT.mkdir(parents=True, exist_ok=True)
        path = _BANK.with_suffix(".json.tmp")
        path.write_text(json.dumps(bank, ensure_ascii=False), encoding="utf-8")
        path.replace(_BANK)


def _map_verified(question: dict[str, Any], values: list[str]) -> Any | None:
    if question.get("question_type") == 3:
        return values if len(values) > 1 else values[0]
    options = question.get("options") or []
    available = {_clean(opt.get("content")): opt.get("id") for opt in options}
    if len(available) != len(options) or any(value not in available for value in values):
        return None
    mapped = [available[value] for value in values]
    if question.get("question_type") in (1, 14) and len(mapped) != 1:
        return None
    return mapped if question.get("question_type") == 2 else mapped[0]


def _ai_answer(question: dict[str, Any], key: str, remaining: float) -> Any:
    """一次标准 DeepSeek Chat Completions；密钥不写磁盘、日志或任务状态。"""
    if remaining < 2:
        raise AutoNeedsInput("运行时限不足，未调用 AI")
    qtype = int(question.get("question_type") or 0)
    opts = [{"id": x.get("id"), "text": _clean(x.get("content"))}
            for x in question.get("options", [])]
    prompt = json.dumps({
        "question": _clean(question.get("content")),
        "type": qtype, "options": opts,
        "instructions": "只返回 JSON 对象，格式为 {\"answers\":[...]}. "
                        "单选/判断返回一个选项数字 ID，多选返回全部认为正确的数字 ID，"
                        "填空返回各空的答案字符串。无法判断则返回空数组。",
    }, ensure_ascii=False)
    body = json.dumps({
        "model": "deepseek-chat",
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": "你是知识点习题解题助手。仅输出合法 JSON，不要编造选项 ID。"},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _API_URL, data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=min(30, remaining)) as reply:
            if reply.status != 200:
                raise AutoNeedsInput("AI 服务暂不可用")
            data = json.loads(reply.read(100_000))
        response = data["choices"][0]["message"]["content"]
        answers = json.loads(response).get("answers")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError) as error:
        raise AutoNeedsInput("AI 解题失败或未返回有效答案") from error
    if not isinstance(answers, list) or not 1 <= len(answers) <= 30:
        raise AutoNeedsInput("AI 无法确定该题答案")
    if qtype == 3:
        if not all(isinstance(x, str) and x.strip() and len(x) <= 2000 for x in answers):
            raise AutoNeedsInput("填空答案格式不完整")
        return [x.strip() for x in answers] if len(answers) > 1 else answers[0]
    available = {int(x["id"]) for x in opts if type(x.get("id")) is int}
    if not available or not all(type(x) is int and x in available for x in answers):
        raise AutoNeedsInput("AI 返回的答案不属于当前题目选项")
    if len(set(answers)) != len(answers) or (qtype in (1, 14) and len(answers) != 1):
        raise AutoNeedsInput("AI 答案与题型不匹配")
    if qtype not in (1, 2, 14):
        raise AutoNeedsInput("当前题型暂不支持自动提交")
    return answers if qtype == 2 else answers[0]


def _learn_result(round_data: dict[str, Any], result: dict[str, Any], course_key: str,
                  used: dict[str, Any]) -> None:
    if result.get("grading_pending"):
        return
    qs = {str(q["question_id"]): q for q in round_data["questions"]}
    for row in result.get("graded", []):
        question = qs.get(str(row.get("questionId")))
        if not question or row.get("graded") is not True:
            continue
        values: list[str] = []
        if question.get("question_type") == 3:
            if row.get("isCorrect") is True:
                answer = used.get(str(row.get("questionId")))
                if isinstance(answer, str):
                    values = [answer]
                elif isinstance(answer, list) and all(isinstance(v, str) for v in answer):
                    values = answer
        else:
            ids = row.get("correctOptionIds") or []
            matched = {str(x.get("id")): _clean(x.get("content"))
                       for x in question.get("options") or []}
            if ids and len(ids) <= len(matched):
                values = [matched[str(x)] for x in ids if str(x) in matched]
                if len(values) != len(ids):
                    values = []
            elif row.get("isCorrect") is True:
                answer = used.get(str(row.get("questionId")))
                candidates = answer if isinstance(answer, list) else [answer]
                values = [matched[str(x)] for x in candidates if str(x) in matched]
                if len(values) != len(candidates):
                    values = []
        if values:
            _store_verified(_signature(question, course_key), values)


def _run(course_key: str, opts: dict[str, Any], api_key: str) -> None:
    deadline = time.monotonic() + opts["max_minutes"] * 60
    try:
        _checkpoint(deadline)
        _emit(state="running", phase="读取知识点")
        catalog = mastery.read_catalog(course_key, with_mastery=True)
        points = [p for p in catalog.get("knowledge", [])
                  if not p.get("free_exam") and p.get("mastery") is not None
                  and (not opts.get("knowledge_id") or str(p.get("knowledge_id")) == opts["knowledge_id"])
                  and p["mastery"] < opts["target"]]
        if opts.get("knowledge_id") and not any(
                str(p.get("knowledge_id")) == opts["knowledge_id"] for p in catalog.get("knowledge", [])):
            raise AutoNeedsInput("所选知识点不存在")
        if not opts["auto_next"]:
            points = points[:1]
        _emit(points_total=len(points), phase="自动练习中", log="已读取知识点，仅处理未达到目标的习题")
        if not points:
            _emit(state="completed", phase="全部达标", message="当前范围没有需要处理的掌握度习题")
            return

        bank = _load_bank()
        for point in points:
            kid = str(point["knowledge_id"])
            _checkpoint(deadline)
            _emit(knowledge=str(point.get("name", ""))[:120], round=0, mastery=point["mastery"],
                  log="开始知识点：" + str(point.get("name", ""))[:80])
            previous_score = None
            achieved = False
            for index in range(1, opts["max_rounds"] + 1):
                _checkpoint(deadline)
                _emit(round=index)
                active = mastery.active_round(course_key, kid)
                if active:
                    round_data = {
                        "questions": active["questions"],
                        "exam_test_id": active["exam_test_id"],
                    }
                    if active.get("submission_state") not in (None, "draft"):
                        result = mastery.submit_round(course_key, kid)
                        if result.get("verification_pending"):
                            raise AutoNeedsInput("上轮已提交，等待服务器判分与掌握度核验")
                        score = (result.get("mastery_after") or {}).get("mastery")
                        if score is not None and score >= opts["target"]:
                            achieved = True
                            _emit(mastery=score)
                            break
                        continue
                else:
                    round_data = mastery.start_round(course_key, kid)

                used: dict[str, Any] = {}
                for question in round_data["questions"]:
                    _checkpoint(deadline)
                    qid = str(question["question_id"])
                    key = _signature(question, course_key)
                    known = bank.get(key)
                    answer = _map_verified(question, known) if known else None
                    source = "bank" if answer is not None else "ai"
                    if answer is None:
                        if not opts["use_ai"]:
                            raise AutoNeedsInput("题库未命中且未启用 AI，请启用 AI 或手动补充已验证答案")
                        with _LOCK:
                            if _STATE["ai_calls"] >= opts["max_ai_calls"]:
                                raise AutoNeedsInput("已达到 AI 请求次数上限")
                            _STATE["ai_calls"] += 1
                        answer = _ai_answer(question, api_key, deadline - time.monotonic())
                    _checkpoint(deadline)
                    mastery.save_answer(course_key, kid, qid, answer)
                    used[qid] = answer
                    _emit(**({"bank_hit": status()["bank_hit"] + 1} if source == "bank"
                             else {"ai_count": status()["ai_count"] + 1}))
                _checkpoint(deadline)
                _emit(phase="提交与核验", message="全部题目已保存；按当前习题轮次提交并读取结果")
                result = mastery.submit_round(course_key, kid)
                for _ in range(2):
                    if not result.get("verification_pending"):
                        break
                    _checkpoint(deadline)
                    if _STOP.wait(1.0):
                        raise AutoStop()
                    result = mastery.submit_round(course_key, kid)  # 只读重查，不重复提交
                if result.get("verification_pending"):
                    raise AutoNeedsInput("本轮提交已发出，但判分或掌握度尚未完成回读")
                _learn_result(round_data, result, course_key, used)
                bank = _load_bank()
                score = (result.get("mastery_after") or {}).get("mastery")
                _emit(mastery=score, log="本轮掌握度：" + str(score))
                if score is None:
                    raise AutoNeedsInput("服务器未确认本轮掌握度")
                if score >= opts["target"]:
                    achieved = True
                    break
                if previous_score is not None and score <= previous_score:
                    raise AutoNeedsInput("连续练习掌握度没有提升，已停止避免无效重复")
                previous_score = score

            if not achieved:
                raise AutoNeedsInput("达到本知识点轮次上限，但尚未达到目标掌握度")
            _emit(points_done=status()["points_done"] + 1, phase="自动练习中",
                  log="该知识点达到服务器目标，继续下一项")

        _emit(state="completed", phase="已完成", message="所选知识点均达到服务器确认的目标")
    except AutoStop:
        _emit(state="stopped", phase="已停止", message="后台任务已停止，未重复提交")
    except AutoNeedsInput as error:
        _emit(state="needs_attention", phase="需要处理", message=str(error)[:180],
              log="已停止自动提交：" + str(error)[:120])
    except Exception as error:
        # 只记录异常类型，不将 HTTP 内容、Cookie 或 API Key 输出到 UI/日志。
        _emit(state="error", phase="执行失败",
              message="后台任务异常：" + type(error).__name__)
    finally:
        # 不保留临时 API Key。对象仅存在于本次 daemon 线程的参数作用域。
        api_key = ""


def start(course_key: str, options: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(course_key, str) or not re.fullmatch(r"[0-9a-f]{64}", course_key):
        raise ValueError("INVALID_REQUEST")
    if not isinstance(options, dict) or not set(options).issubset(
        {"target", "max_rounds", "max_minutes", "auto_next", "knowledge_id",
         "use_ai", "api_key", "max_ai_calls"}
    ):
        raise ValueError("INVALID_REQUEST")
    opts = {
        "target": options.get("target", 90),
        "max_rounds": options.get("max_rounds", 3),
        "max_minutes": options.get("max_minutes", 30),
        "auto_next": options.get("auto_next", False),
        "knowledge_id": options.get("knowledge_id") or "",
        "use_ai": options.get("use_ai", False),
        "max_ai_calls": options.get("max_ai_calls", 30),
    }
    key = options.get("api_key", "")
    if type(opts["target"]) is not int or not 1 <= opts["target"] <= 100:
        raise ValueError("INVALID_REQUEST")
    if type(opts["max_rounds"]) is not int or not 1 <= opts["max_rounds"] <= 10:
        raise ValueError("INVALID_REQUEST")
    if type(opts["max_minutes"]) is not int or not 1 <= opts["max_minutes"] <= 120:
        raise ValueError("INVALID_REQUEST")
    if type(opts["max_ai_calls"]) is not int or not 1 <= opts["max_ai_calls"] <= 100:
        raise ValueError("INVALID_REQUEST")
    if type(opts["auto_next"]) is not bool or type(opts["use_ai"]) is not bool:
        raise ValueError("INVALID_REQUEST")
    if not isinstance(opts["knowledge_id"], str) or (
        opts["knowledge_id"] and not re.fullmatch(r"[0-9]{1,24}", opts["knowledge_id"])
    ):
        raise ValueError("INVALID_REQUEST")
    if not isinstance(key, str) or len(key) > 256 or (
        opts["use_ai"] and not key.strip()
    ):
        raise ValueError("INVALID_REQUEST")

    global _THREAD
    with _LOCK:
        if _THREAD is not None and _THREAD.is_alive():
            raise ValueError("MASTERY_AUTO_ALREADY_RUNNING")
        _STOP.clear()
        _PAUSE.clear()
        _STATE.update({
            "state": "running", "phase": "启动中", "message": "",
            "course_key": course_key, "knowledge": "", "round": 0,
            "points_done": 0, "points_total": 0, "bank_hit": 0,
            "ai_count": 0, "ai_calls": 0, "mastery": None, "logs": [],
        })
        _THREAD = threading.Thread(
            target=_run, args=(course_key, opts, key.strip()), daemon=True,
            name="studyflow-zhs-mastery",
        )
        _THREAD.start()
    return status()


def pause() -> dict[str, Any]:
    with _LOCK:
        if _STATE.get("state") == "running":
            _PAUSE.set()
            _STATE["state"], _STATE["phase"] = "paused", "已暂停"
    return status()


def resume() -> dict[str, Any]:
    _PAUSE.clear()
    with _LOCK:
        if _STATE.get("state") == "paused":
            _STATE["state"], _STATE["phase"] = "running", "自动练习中"
    return status()


def stop() -> dict[str, Any]:
    with _LOCK:
        if _THREAD is not None and _THREAD.is_alive():
            _STATE["state"], _STATE["phase"] = "stopping", "正在停止"
            _STOP.set()
            _PAUSE.clear()
    return status()
