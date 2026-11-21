"""掌握度（AI 课程作业）HTTP 服务层。

复用 StudyFlow 已授权的知到登录态，只走官方 session 的加密通道，不重新实现
``secretStr``：``zhs`` 0.1.5 的 ``ZhsSession`` 已经封装好 ai_key / exam_key。

接口与官方 AI 课程页面完全一致（从前端 chunk 与 zhs 打包源码双向核对）：

===========================  ==================================================
读知识点 + 资源              ``AiCourseManager.get_knowledge_points``
读掌握度（**不建卷**）        ``POST {kgRunStu}/mastery-statistics/get-knowledge-mastery-stat``
                             参数 ``{courseId, knowledgeId, dateFormate}``，取 ``data.mastery``
建卷 + 读掌握度               ``POST {kgRunStu}/exam/questions-paper``
                             参数 ``{scMapId, courseId, classId, knowledgeId, dateFormate}``
开卷                         ``POST {exam}/exam/user/openExam``  ``{examTestId, examPaperId, courseId}``
答题卡                       ``GET  {exam}/exam/user/getExamSheetInfo``  ``{examTestId, examPaperId}``
取题                         ``GET  {exam}/question/getExamQuestionInfo``
存答案                       ``POST {exam}/answer/saveAnswer``（``answer`` 是字符串）
提交                         ``POST {exam}/exam/user/submit``（exam_key，无返回体）
                             参数 ``{examTestId, courseId, courseType:8, examPaperId, aiKnlowledgeId}``
判分                         提交后重取题，读 ``userAnswerVo[].isCorrect``
错题推荐                     ``POST {kgRunStu}/mastery-statistics/bd/get-test-question``
===========================  ==================================================

所有写操作都落在**用户自己的一条练习**上：建卷、存答案、提交。这里不生成答案，
答什么由调用方（界面里的用户）决定。
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from studyflow.platforms.zhidao.zhs_mastery import (
    HOMEWORK_GIVE_UP_SCORE,
    HOMEWORK_THRESHOLD_DEFAULT,
    decode_answer,
    format_answer,
    parse_question_result,
    parse_sheet_progress,
    submit_payload,
)

# 域名一律取自会话配置（``session.urls``），和 ``AiCourseManager`` 同源：
# 用户改成代理/镜像地址时这里跟着走，不在本模块硬编码第二份。
KG_STU_PATH = "/run/gateway/t/stu"
EXAM_PATH = "/gateway/t/v1"

MASTERY_TTL_SECONDS = 90.0
ACTIVE_ROUND_TTL_SECONDS = 3600.0

_LOCK = threading.RLock()
_MASTERY_CACHE: dict[str, tuple[float, dict]] = {}
_ACTIVE_ROUNDS: dict[str, dict] = {}


class MasteryError(RuntimeError):
    """可由 bridge 直接映射成公开错误码的业务异常。"""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------
# 连接与鉴权
# --------------------------------------------------------------------------


def _open_session(course_key: str):
    """解析课程并复用已授权登录态。返回 ``(session, course)``。"""
    from studyflow.platforms.zhidao.legacy_runtime import resolve_course

    if not isinstance(course_key, str) or len(course_key) != 64:
        raise MasteryError("INVALID_REQUEST")
    try:
        course = resolve_course(course_key)
    except RuntimeError as error:
        code = "COURSE_NOT_FOUND" if str(error) == "COURSE_NOT_FOUND" else "COURSE_ROUTE_UNAVAILABLE"
        raise MasteryError(code) from error
    if course.get("course_type") != "ai":
        raise MasteryError("NOT_AI_COURSE")

    from zhs.cli.bootstrap import load_config_and_session

    try:
        loaded = load_config_and_session(debug=False, console_log=False, proxy=None)
    except Exception as error:  # 登录态损坏/文件不可读
        raise MasteryError("LOGIN_REQUIRED", str(error)[:200]) from error
    if loaded is None:
        raise MasteryError("LOGIN_REQUIRED")
    _, session = loaded
    return session, course


def _kg_stu(session) -> str:
    """``kg-ai-run`` 的 ``/run/gateway/t/stu`` 前缀（建卷、掌握度统计）。"""
    return f"{session.urls.ai}{KG_STU_PATH}"


def _exam_root(session) -> str:
    """``studentexamtest`` 的 ``/gateway/t/v1`` 前缀（开卷、答题、提交）。"""
    return f"{session.urls.exam}{EXAM_PATH}"


def _ai_query(session, url: str, data: dict[str, Any]) -> dict[str, Any]:
    """ai_key + JSON + code=200（与 ``AiCourseManager._ai_query`` 同一条通道）。"""
    return session.zhidao_query(
        url, data, key=session.crypto.key_bytes("ai_key"), ok_code=200, content_type="json",
    )


def _exam_query(session, url: str, data: dict[str, Any], method: str = "POST") -> dict[str, Any]:
    """exam_key + code=0（``studentexamtest`` 全部接口）。"""
    return session.ai_exam_query(url, data, method=method)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _int(value: Any) -> int | None:
    if type(value) is int:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _round_key(course_key: str, knowledge_id: str) -> str:
    return f"{course_key}:{knowledge_id}"


# --------------------------------------------------------------------------
# 知识点与掌握度（只读）
# --------------------------------------------------------------------------


def _course_ids(course: dict) -> tuple[int, int]:
    course_id, class_id = _int(course.get("course_id")), _int(course.get("class_id"))
    if course_id is None or class_id is None:
        raise MasteryError("COURSE_ROUTE_UNAVAILABLE")
    return course_id, class_id


def _knowledge_points(session, course_id: int, class_id: int) -> list[dict[str, Any]]:
    from zhs.ai.course import AiCourseManager

    manager = AiCourseManager(session)
    catalog = manager.get_knowledge_points(course_id, class_id)
    points: list[dict[str, Any]] = []
    for theme in catalog.cake_theme_list:
        for point in theme.knowledge_list:
            points.append({
                "knowledge_id": str(point.knowledge_id),
                "name": point.knowledge_name,
                "theme": theme.theme_name,
                "study_progress": max(0, min(100, int(point.study_progress))),
                "free_exam": bool(getattr(point, "free_exam", 0)),
            })
    return points


def read_mastery_stat(session, course_id: int, knowledge_id: int) -> dict[str, Any]:
    """读单个知识点掌握度——**不建卷、不写任何东西**。

    ``data.mastery`` 是 0-100 的分数；前端按 <60 / 60-80 / 80-100 三档决定
    推荐哪些资源，这里把档位一起返回，省得界面自己再算。
    """
    reply = _ai_query(
        session,
        f"{_kg_stu(session)}/mastery-statistics/get-knowledge-mastery-stat",
        {"courseId": course_id, "knowledgeId": knowledge_id, "dateFormate": _now_ms()},
    )
    data = reply.get("data") if isinstance(reply, dict) else None
    if not isinstance(data, dict):
        raise MasteryError("MASTERY_UNAVAILABLE")
    raw = data.get("mastery")
    score = _int(raw)
    if score is None and isinstance(raw, float):
        score = int(raw)
    if score is None:
        raise MasteryError("MASTERY_UNAVAILABLE")
    score = max(0, min(100, score))
    band = "low" if score < 60 else ("mid" if score < 80 else "high")
    return {
        "mastery": score,
        "band": band,
        "threshold": HOMEWORK_THRESHOLD_DEFAULT,
        "reached_threshold": score > HOMEWORK_THRESHOLD_DEFAULT,
        "raw_keys": sorted(str(key) for key in data.keys())[:20],
        "verified_at": _iso_now(),
        "source": "mastery-statistics/get-knowledge-mastery-stat",
    }


def read_catalog(course_key: str, *, with_mastery: bool = True) -> dict[str, Any]:
    """课程知识点 + 每个点的掌握度（掌握度走只读接口，失败逐点降级）。"""
    session, course = _open_session(course_key)
    course_id, class_id = _course_ids(course)
    try:
        points = _knowledge_points(session, course_id, class_id)
        if with_mastery:
            for point in points:
                key = f"{course_id}:{point['knowledge_id']}"
                cached = _MASTERY_CACHE.get(key)
                if cached is not None and time.time() - cached[0] < MASTERY_TTL_SECONDS:
                    point["mastery"] = cached[1]["mastery"]
                    point["band"] = cached[1]["band"]
                    continue
                try:
                    stat = read_mastery_stat(session, course_id, int(point["knowledge_id"]))
                except Exception as error:
                    point["mastery"] = None
                    point["band"] = None
                    point["mastery_error"] = getattr(error, "code", None) or type(error).__name__
                    continue
                _MASTERY_CACHE[key] = (time.time(), stat)
                point["mastery"] = stat["mastery"]
                point["band"] = stat["band"]
                time.sleep(0.12)
        scored = [item["mastery"] for item in points if item.get("mastery") is not None]
        return {
            "course_key": course_key,
            "course_id": str(course_id),
            "class_id": str(class_id),
            "course_name": course.get("title") or "",
            "threshold": HOMEWORK_THRESHOLD_DEFAULT,
            "knowledge": points,
            "count": len(points),
            "pending_count": sum(
                1 for item in points
                if item.get("mastery") is not None and item["mastery"] <= HOMEWORK_THRESHOLD_DEFAULT
            ),
            "average_mastery": round(sum(scored) / len(scored)) if scored else None,
            "verified_at": _iso_now(),
        }
    finally:
        session.close()


# --------------------------------------------------------------------------
# 一轮练习：开 → 答 → 交
# --------------------------------------------------------------------------


def _paper_payload(course_id: int, class_id: int, knowledge_id: int) -> dict[str, Any]:
    """``questions-paper`` 明文：与抓包一致（``scMapId`` 与 ``courseId`` 同值）。"""
    return {
        "scMapId": str(course_id),
        "courseId": str(course_id),
        "classId": str(class_id),
        "knowledgeId": str(knowledge_id),
        "dateFormate": _now_ms(),
    }


def _create_paper(session, course_id: int, class_id: int, knowledge_id: int) -> dict[str, Any]:
    reply = _ai_query(session, f"{_kg_stu(session)}/exam/questions-paper", _paper_payload(course_id, class_id, knowledge_id))
    data = reply.get("data") if isinstance(reply, dict) else None
    if not isinstance(data, dict):
        raise MasteryError("PAPER_UNAVAILABLE")
    exam_test_id = _int(data.get("examTestId"))
    exam_paper_id = _int(data.get("paperId")) or _int(data.get("examPaperId"))
    if exam_test_id is None:
        raise MasteryError("PAPER_UNAVAILABLE")
    return {
        "exam_test_id": exam_test_id,
        "exam_paper_id": exam_paper_id,
        "high_mastery": _int(data.get("highMasteryScore")),
        "mastery": _int(data.get("masteryScore")),
        "mastery_change": _int(data.get("masteryChange")),
        "question_num": _int(data.get("questionNum")),
        "raw": data,
    }


def _public_question(raw: dict[str, Any]) -> dict[str, Any]:
    """把 ``getExamQuestionInfo`` 的题目裁成界面要用的形状（不含答案）。"""
    options = []
    for option in raw.get("optionVos") or []:
        if isinstance(option, dict):
            options.append({
                "id": option.get("id"),
                "content": str(option.get("content") or ""),
                "sort": option.get("sort"),
            })
    return {
        "question_id": raw.get("id"),
        "content": str(raw.get("content") or ""),
        "question_type": raw.get("questionType"),
        "type_name": raw.get("questionTypeName") or "",
        "options": options,
        "is_correct_before_submit": None,
    }


def start_round(course_key: str, knowledge_id: str) -> dict[str, Any]:
    """开一轮：建卷（顺便拿到官方口径的掌握度）→ 开卷 → 读答题卡与题目。

    建卷本身就会生成新的 ``examTestId``/``examPaperId``，所以**每轮都是新卷**，
    这是官方行为：掌握度只能从建卷响应里读，重做必然重新建卷。
    """
    session, course = _open_session(course_key)
    course_id, class_id = _course_ids(course)
    kid = _int(knowledge_id)
    if kid is None or kid <= 0:
        raise MasteryError("INVALID_REQUEST")
    try:
        paper = _create_paper(session, course_id, class_id, kid)
        exam_test_id, exam_paper_id = paper["exam_test_id"], paper["exam_paper_id"]
        if exam_paper_id is None:
            raise MasteryError("PAPER_UNAVAILABLE")
        _exam_query(
            session, f"{_exam_root(session)}/exam/user/openExam",
            {"examTestId": exam_test_id, "examPaperId": exam_paper_id, "courseId": course_id},
        )
        sheet = _exam_query(
            session, f"{_exam_root(session)}/exam/user/getExamSheetInfo",
            {"examTestId": exam_test_id, "examPaperId": exam_paper_id}, method="GET",
        )
        progress = parse_sheet_progress(sheet.get("data") or {})
        questions: list[dict[str, Any]] = []
        for entry in progress.entries:
            detail = _exam_query(
                session, f"{_exam_root(session)}/question/getExamQuestionInfo",
                {
                    "examTestId": exam_test_id, "examPaperId": exam_paper_id,
                    "questionId": entry["questionId"], "version": entry.get("version", 1),
                },
                method="GET",
            )
            raw = detail.get("data") if isinstance(detail, dict) else None
            if isinstance(raw, dict):
                questions.append(_public_question(raw))
        if not questions:
            raise MasteryError("PAPER_EMPTY")

        state = {
            "course_key": course_key,
            "knowledge_id": str(kid),
            "course_id": course_id,
            "class_id": class_id,
            "exam_test_id": exam_test_id,
            "exam_paper_id": exam_paper_id,
            "high_mastery": paper["high_mastery"],
            "mastery": paper["mastery"],
            "questions": questions,
            "answers": {},
            "opened_at": time.time(),
        }
        with _LOCK:
            for stale in [
                key for key, value in _ACTIVE_ROUNDS.items()
                if time.time() - float(value.get("opened_at", 0)) > ACTIVE_ROUND_TTL_SECONDS
            ]:
                _ACTIVE_ROUNDS.pop(stale, None)
            _ACTIVE_ROUNDS[_round_key(course_key, str(kid))] = state
        return {
            "course_key": course_key,
            "knowledge_id": str(kid),
            "exam_test_id": exam_test_id,
            "exam_paper_id": exam_paper_id,
            "question_num": len(questions),
            "questions": questions,
            "high_mastery": paper["high_mastery"],
            "mastery": paper["mastery"],
            "mastery_change": paper["mastery_change"],
            "threshold": HOMEWORK_THRESHOLD_DEFAULT,
            "opened_at": _iso_now(),
        }
    finally:
        session.close()


def _active_round(course_key: str, knowledge_id: str) -> dict[str, Any]:
    with _LOCK:
        state = _ACTIVE_ROUNDS.get(_round_key(course_key, knowledge_id))
    if state is None:
        raise MasteryError("NO_ACTIVE_ROUND")
    if time.time() - float(state.get("opened_at", 0)) > ACTIVE_ROUND_TTL_SECONDS:
        with _LOCK:
            _ACTIVE_ROUNDS.pop(_round_key(course_key, knowledge_id), None)
        raise MasteryError("ROUND_EXPIRED")
    return state


def save_answer(course_key: str, knowledge_id: str, question_id: str, answer: Any) -> dict[str, Any]:
    """保存单题：界面上的点选/输入原样传进来，这里负责拼成线上字符串格式。

    ``answer`` 可以是选项 id、id 列表，或填空文本；``questionType`` 从本轮缓存的
    题目里取，所以不需要界面自己判断分隔符。
    """
    state = _active_round(course_key, knowledge_id)
    qid = _int(question_id)
    if qid is None:
        raise MasteryError("INVALID_REQUEST")
    question = next((item for item in state["questions"] if item.get("question_id") == qid), None)
    if question is None:
        raise MasteryError("QUESTION_NOT_IN_ROUND")
    if answer is None or (isinstance(answer, (list, tuple)) and not answer) or answer == "":
        raise MasteryError("EMPTY_ANSWER")
    encoded = format_answer(answer, question.get("question_type"))

    session, _ = _open_session(course_key)
    try:
        _exam_query(
            session, f"{_exam_root(session)}/answer/saveAnswer",
            {
                "recruitId": str(state["course_id"]),
                "examTestId": str(state["exam_test_id"]),
                "examPaperId": state["exam_paper_id"],
                "questionId": qid,
                "dataVos": None,
                "answer": encoded,
            },
        )
    except Exception as error:
        raise MasteryError("ANSWER_SAVE_FAILED", str(error)[:200]) from error
    finally:
        session.close()

    with _LOCK:
        state["answers"][str(qid)] = encoded
        answered = len(state["answers"])
        total = len(state["questions"])
    return {
        "knowledge_id": str(knowledge_id),
        "question_id": str(qid),
        "saved": True,
        "answered": answered,
        "total": total,
        "complete": answered >= total,
    }


def submit_round(course_key: str, knowledge_id: str) -> dict[str, Any]:
    """提交本轮 → 重取每题读判分 → 再读一次掌握度。

    三件事实必须分清，返回里也分开：

    * ``round_score`` —— **本轮**正确率（提交后回读 ``userAnswerVo`` 得到）；
    * ``mastery_before.high`` —— 本轮之前的**历史最高**掌握度（官方达标依据）；
    * ``mastery_after`` —— 提交后重新读到的掌握度（来自只读接口，不建新卷）。

    ``next_round_hint`` 只是提示，不替用户决定：``> 90`` 官方视为达标；
    ``< 30`` 时官方页面会把资源推荐拉满，说明该先学再练。
    """
    state = _active_round(course_key, knowledge_id)
    session, _ = _open_session(course_key)
    exam_test_id, exam_paper_id = state["exam_test_id"], state["exam_paper_id"]
    try:
        session.ai_exam_submit(
            f"{_exam_root(session)}/exam/user/submit",
            submit_payload(
                exam_test_id=exam_test_id,
                course_id=state["course_id"],
                exam_paper_id=exam_paper_id,
                knowledge_id=int(state["knowledge_id"]),
            ),
        )
    except Exception as error:
        raise MasteryError("SUBMIT_FAILED", str(error)[:200]) from error

    graded: list[dict[str, Any]] = []
    try:
        for question in state["questions"]:
            detail = _exam_query(
                session, f"{_exam_root(session)}/question/getExamQuestionInfo",
                {
                    "examTestId": exam_test_id, "examPaperId": exam_paper_id,
                    "questionId": question["question_id"], "version": 1,
                },
                method="GET",
            )
            raw = detail.get("data") if isinstance(detail, dict) else None
            if isinstance(raw, dict):
                graded.append(parse_question_result(raw))
            time.sleep(0.15)
    finally:
        session.close()

    total = len(graded) or len(state["questions"])
    correct = sum(1 for item in graded if item["isCorrect"])

    after: dict[str, Any] | None = None
    mastery_error: str | None = None
    session2, _ = _open_session(course_key)
    try:
        try:
            after = read_mastery_stat(session2, state["course_id"], int(state["knowledge_id"]))
        except Exception as error:
            mastery_error = getattr(error, "code", None) or type(error).__name__
    finally:
        session2.close()

    high_before = state.get("high_mastery")
    latest = after["mastery"] if after else None
    best = max(value for value in (high_before, latest) if value is not None) if (
        high_before is not None or latest is not None
    ) else None

    with _LOCK:
        _ACTIVE_ROUNDS.pop(_round_key(course_key, knowledge_id), None)
        _MASTERY_CACHE.pop(f"{state['course_id']}:{state['knowledge_id']}", None)

    return {
        "knowledge_id": str(knowledge_id),
        "exam_test_id": exam_test_id,
        "exam_paper_id": exam_paper_id,
        "submitted": True,
        "round_score": {
            "correct": correct,
            "total": total,
            "percent": round(correct / total * 100) if total else None,
        },
        "graded": graded,
        "mastery_before": {
            "high": high_before,
            "this_round_start": state.get("mastery"),
        },
        "mastery_after": after,
        "mastery_error": mastery_error,
        "high_mastery_now": best,
        "threshold": HOMEWORK_THRESHOLD_DEFAULT,
        "reached_threshold": (best is not None and best > HOMEWORK_THRESHOLD_DEFAULT),
        "next_round_hint": (
            "reached" if best is not None and best > HOMEWORK_THRESHOLD_DEFAULT
            else "study_first" if best is not None and best < HOMEWORK_GIVE_UP_SCORE
            else "practice_more"
        ),
        "verified_at": _iso_now(),
    }


def discard_round(course_key: str, knowledge_id: str) -> dict[str, Any]:
    """放弃本轮：只清本地状态，不发任何请求（卷子留在服务端，不影响掌握度）。"""
    with _LOCK:
        existed = _ACTIVE_ROUNDS.pop(_round_key(course_key, knowledge_id), None) is not None
    return {"knowledge_id": str(knowledge_id), "discarded": existed}


def read_wrong_questions(course_key: str, knowledge_id: str, exam_test_id: str | None = None) -> dict[str, Any]:
    """官方"错题推荐"：``bd/get-test-question``，只读。"""
    session, course = _open_session(course_key)
    course_id, class_id = _course_ids(course)
    kid = _int(knowledge_id)
    if kid is None:
        raise MasteryError("INVALID_REQUEST")
    try:
        try:
            stat = read_mastery_stat(session, course_id, kid)
            mastery = stat["mastery"]
        except MasteryError:
            mastery = None
        payload: dict[str, Any] = {
            "classId": class_id, "courseId": course_id, "knowledgeId": kid,
            "dateFormate": _now_ms(),
        }
        if _int(exam_test_id) is not None:
            payload["examTestId"] = _int(exam_test_id)
        if mastery is not None:
            payload["mastery"] = mastery
        reply = _ai_query(session, f"{_kg_stu(session)}/mastery-statistics/bd/get-test-question", payload)
        data = reply.get("data") if isinstance(reply, dict) else None
        items = data.get("questionList") if isinstance(data, dict) else None
        return {
            "knowledge_id": str(kid),
            "mastery": mastery,
            "questions": items if isinstance(items, list) else [],
            "count": len(items) if isinstance(items, list) else 0,
            "verified_at": _iso_now(),
        }
    finally:
        session.close()


def active_round(course_key: str, knowledge_id: str) -> dict[str, Any] | None:
    """界面刷新时恢复未提交的一轮（不碰网络）。

    ``answers`` 是线上原样字符串，``draft`` 是解码后的界面值（选项 id / 列表），
    界面直接拿 ``draft`` 回填点选状态即可，不用自己拆分隔符。
    """
    with _LOCK:
        state = _ACTIVE_ROUNDS.get(_round_key(course_key, knowledge_id))
        if state is None:
            return None
        by_id = {str(item.get("question_id")): item for item in state["questions"]}
        draft: dict[str, Any] = {}
        for question_id, encoded in state["answers"].items():
            question_type = (by_id.get(question_id) or {}).get("question_type")
            decoded = decode_answer(encoded, question_type)
            if decoded is not None:
                draft[question_id] = decoded
        return {
            "knowledge_id": state["knowledge_id"],
            "exam_test_id": state["exam_test_id"],
            "exam_paper_id": state["exam_paper_id"],
            "questions": state["questions"],
            "answers": dict(state["answers"]),
            "draft": draft,
            "answered": len(state["answers"]),
            "total": len(state["questions"]),
            "high_mastery": state.get("high_mastery"),
            "opened_at": datetime.fromtimestamp(state["opened_at"], tz=timezone.utc).isoformat(),
        }
