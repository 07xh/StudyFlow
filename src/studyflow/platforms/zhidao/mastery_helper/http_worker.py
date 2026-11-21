"""StudyFlow ZHS mastery task: authenticated HTTP only; no browser."""
from __future__ import annotations

import contextlib
import html
import json
import re
import time
from pathlib import Path

from .http_client import MasteryHttpClient, MasteryProtocolError, question_ids
from .local_trial import LocalTrial
from . import mastery as m
from . import settings
from .worker import LogStream, Reporter
from studyflow.platforms.zhidao.legacy_runtime import resolve_course


def _text(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()[:16000]


def _question_model(raw: dict) -> tuple[m.Question, dict[str, str]]:
    kind_name = str(raw.get("questionTypeName") or "")
    kind = "multiple" if "多选" in kind_name or raw.get("questionType") == 2 else "single"
    if "填空" in kind_name or raw.get("questionType") == 3:
        raise m.Halt("当前填空题需要手动学习，未尝试提交未知答案")
    options = raw.get("optionVos")
    if not isinstance(options, list) or len(options) < 2:
        raise m.Halt("当前题目的选项未加载完整")
    options = sorted(options, key=lambda v: (v.get("sort") if isinstance(v, dict) and type(v.get("sort")) is int else 100000))
    pairs = []
    for option in options:
        if not isinstance(option, dict) or type(option.get("id")) is not int:
            raise m.Halt("题目选项 ID 不完整")
        pairs.append((str(option["id"]), _text(option.get("content"))))
    if len({v for _, v in pairs}) != len(pairs):
        raise m.Halt("题目包含重复或无法识别的选项")
    question = m.Question(_text(raw.get("content")), kind,
                          [f"{chr(65+i)}. {value}" for i, (_, value) in enumerate(pairs)])
    return question, dict(zip(question.options, (opt_id for opt_id,_ in pairs)))


def _collect_known_answers(http: MasteryHttpClient, paper, questions: list[tuple[int, int]],
                           bank: m.Bank, scope: str, previous: dict[int, m.Question]) -> int:
    """Collect only platform-published correct options after a finished round."""
    count = 0
    for question_id, version in questions:
        try:
            raw = http.question(paper, question_id, version)
            if raw.get("id") != question_id:
                continue
            q, option_ids = _question_model(raw)
            correct = [opt for opt in raw.get("optionVos") or [] if opt.get("isCorrect") in (True, 1)]
            if not correct:
                continue
            ids = {str(opt.get("id")) for opt in correct}
            answer = [name for name, option_id in option_ids.items() if option_id in ids]
            if not answer or (q.kind == "single" and len(answer) != 1):
                continue
            bank.put(scope, q, answer, True, "智慧树结果页公布的正确选项")
            count += 1
        except (m.Halt, MasteryProtocolError, TypeError, ValueError):
            continue
    return count


def _process_point(client: MasteryHttpClient, course_id: int, class_id: int,
                   knowledge_id: int, scope: str, bank: m.Bank, reporter: Reporter,
                   cfg: dict, deadline: float) -> float:
    last_score: float | None = None
    for round_no in range(1, min(int(cfg["max_rounds"]), 30) + 1):
        reporter.checkpoint()
        if time.monotonic() >= deadline:
            raise m.Halt("掌握度任务达到运行时长上限")
        paper = client.paper(course_id, class_id, knowledge_id)
        if paper.mastery is not None:
            reporter.emit("score", mastery=paper.mastery)
            if paper.mastery >= cfg["target"]:
                return paper.mastery
        if paper.question_count == 0:
            raise m.Halt("当前知识点没有可用练习题")
        if not client.open_exam(paper):
            raise m.Halt("官方考试会话未打开")
        sheet = client.sheet(paper)
        ids = question_ids(sheet)
        if paper.question_count is not None and len(ids) != paper.question_count:
            raise m.Halt("服务器答题卡与试卷题数不一致")
        reporter.emit("round", round=round_no)
        answered = 0
        for qid, version in ids:
            reporter.checkpoint()
            raw = client.question(paper, qid, version)
            question, option_map = _question_model(raw)
            reporter.emit("question", question=question.stem)
            answer = bank.get(scope, question)
            source = "bank" if answer else "trial"
            if answer is None:
                answer, _ = LocalTrial().answer(question, bank.history(scope, question))
            option_ids = [option_map[item] for item in answer]
            if not client.save_answer(paper, qid, ",".join(option_ids)):
                raise m.Halt("答案保存接口未确认成功")
            bank.attempt(str(paper.paper_id), round_no, scope, str(knowledge_id),
                         question, answer, source)
            reporter.emit("answered", source=source)
            answered += 1
        check = client.sheet(paper)
        if check.get("answerCount") != answered:
            raise m.Halt("服务器答题卡未确认全部答案；已停止，避免错误交卷")
        reporter.emit("phase", status="提交中", message="开始正式交卷，服务器结果需要独立回读")
        # One submit per unique paper. An uncertain response is never retried.
        client.submit_once(paper)
        time.sleep(1.5)
        _collect_known_answers(client, paper, ids, bank, scope, {})
        fresh = client.paper(course_id, class_id, knowledge_id)
        score = fresh.mastery
        if score is None:
            raise m.Halt("交卷后无法读取服务器掌握度；未标记为成功")
        reporter.emit("score", mastery=score)
        if score >= cfg["target"]:
            return score
        if last_score is not None and score <= last_score and round_no >= 3:
            raise m.Halt("连续多轮掌握度未提高；保留题库并停止")
        last_score = score
    raise m.Halt("达到单知识点轮次上限，保存题库并停止")


def main(course_key: str) -> int:
    settings.ROOT.mkdir(parents=True, exist_ok=True)
    settings.DATA.mkdir(parents=True, exist_ok=True)
    reporter = Reporter()
    bank = None
    log = LogStream(reporter)
    try:
        from zhs.cli.bootstrap import load_config_and_session
        route = resolve_course(course_key)
        if route.get("course_type") != "ai":
            raise m.Halt("掌握度仅支持知到智慧课程")
        course_id, class_id = int(route["course_id"]), int(route["class_id"])
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            loaded = load_config_and_session(debug=False, console_log=False, proxy=None)
            if not loaded:
                raise m.Halt("ZHS 会话不可用；请在知到模块重新扫码登录")
            _, session = loaded
            client = MasteryHttpClient(session)
            from zhs.ai.course import AiCourseManager
            info = AiCourseManager(session).get_knowledge_points(course_id, class_id)
            targets = [(theme.theme_name, point)
                       for theme in info.cake_theme_list
                       for point in theme.knowledge_list if point.free_exam != 1]
            if not targets:
                raise m.Halt("当前课程未发现需要考核的知识点")
            cfg = settings.load_config()
            deadline = time.monotonic() + float(cfg["max_minutes"]) * 60
            bank = m.Bank(settings.DATA / "question-bank.sqlite3")
            reporter.emit("phase", status="运行中", message="已通过 ZHS 账号会话读取课程知识点")
            for theme_name, point in targets:
                reporter.checkpoint()
                reporter.emit("metadata", course_title=info.course_name,
                              chapter_title=theme_name, knowledge_title=point.knowledge_name)
                scope = json.dumps([course_id, theme_name], ensure_ascii=False)
                score = _process_point(client, course_id, class_id, point.knowledge_id,
                                       scope, bank, reporter, cfg, deadline)
                reporter.emit("point_done", mastery=score)
                if not cfg.get("auto_next", True):
                    break
            reporter.state["state"] = "completed"
            reporter.emit("phase", status="已完成", message="本次范围处理结束；掌握度来自平台真实回读")
            return 0
    except Exception as err:
        reporter.state["state"] = "stopped" if reporter.stop_file.exists() else "error"
        message = str(err) if isinstance(err, (m.Halt, MasteryProtocolError, ValueError)) else "任务异常：" + type(err).__name__
        reporter.emit("phase", status="已停止" if reporter.state["state"] == "stopped" else "需要处理",
                      message=message[:240])
        return 1
    finally:
        if bank:
            try:
                bank.export(settings.DATA / "question-bank.json")
                bank.close()
            except Exception:
                pass
        log.flush()
        reporter.save()
