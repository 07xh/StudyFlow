"""Live probe for one Zhihuishu mastery knowledge point (no browser needed).

    python scripts/zhs_mastery_probe.py \
        --knowledge-id 1853343377786015744 \
        --course-id 2095430049486426112 \
        --class-id 339597 \
        --sc-map-id 2095430049486426112

Reads the desktop session from ``~/.zhs/cookies.json`` by default (same file the
installed app uses) and prints a JSON summary through
:meth:`ZhsMasteryClient.practice_round`.

掌握度是知识点练习卷，也就是课后习题——**它仍然要提交**。``saveAnswer`` 只回
``data: true``、不含判分；只有 ``submit`` 之后掌握度才会变，而判分只能靠提交后
重取题目读 ``userAnswerVo[].isCorrect``。所以：不带 ``--answer`` 就是纯看题（不写
任何东西）；带了答案但没带 ``--submit`` 就只保存不交卷（这一轮不计分）。

``--answer`` 的右侧可以写选项 id，也可以写选项文本片段，脚本用
:func:`resolve_option` 换成线上要的 id::

    --answer 939136618=新时代
    --answer 939136619=共同富裕,伟大复兴
    --answer 939136618=671372794
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from studyflow.platforms.zhidao.zhs_mastery import (  # noqa: E402
    ZhsApiError,
    ZhsMasteryClient,
    resolve_option,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="知到 AI 课程掌握度纯 HTTP 探测（知识点练习）")
    parser.add_argument("--knowledge-id", required=True)
    parser.add_argument("--course-id", required=True)
    parser.add_argument("--class-id", required=True)
    parser.add_argument("--sc-map-id", required=True)
    parser.add_argument("--cookies", default=None, help="cookies.json 路径，默认 ~/.zhs/cookies.json")
    parser.add_argument("--answer", action="append", default=[],
                        metavar="QUESTION_ID=OPTION_ID|文本[,文本]",
                        help="可重复；右侧是纯数字按选项 id，否则按选项文本匹配")
    parser.add_argument("--submit", action="store_true",
                        help="保存后提交本轮（不提交就不计分）")
    parser.add_argument("--delay", type=float, default=0.8, help="两题之间间隔秒数，默认 0.8")
    parser.add_argument("--no-verify", action="store_true",
                        help="答完不重读掌握度（重读会新建下一张卷）")
    parser.add_argument("--tolerate-errors", action="store_true", help="单题保存失败不中断")
    return parser


def parse_answers(items: list[str]) -> dict[int, list[str]]:
    spec: dict[int, list[str]] = {}
    for item in items:
        question, sep, raw = item.partition("=")
        if not sep or not question.strip():
            raise SystemExit(f"--answer 格式应为 QUESTION_ID=VALUE，收到 {item!r}")
        parts = [part.strip() for part in raw.split(",") if part.strip()]
        if not parts:
            raise SystemExit(f"--answer 缺少取值：{item!r}")
        spec[int(question)] = parts
    return spec


def build_answerer(client: ZhsMasteryClient, spec: dict[int, list[str]]):
    def answerer(question, progress):
        question_id = question.get("id")
        if question_id not in spec:
            return client.SKIP
        parts = spec[question_id]
        if all(part.lstrip("-").isdigit() for part in parts):
            ids = [int(part) for part in parts]
            return ids[0] if len(ids) == 1 else ids
        return resolve_option(question, *parts)

    return answerer


def summarise(result: dict) -> dict:
    return {
        "examTestId": result["examTestId"],
        "examPaperId": result["examPaperId"],
        "examType": result["examType"],
        "examState": result["examState"],
        "limitTime": result["limitTime"],
        "questionNum": result["questionNum"],
        "submitted": result["submitted"],
        "roundScore": result["roundScore"],
        "masteryBefore": result["masteryBefore"],
        "masteryAfter": result.get("masteryAfter"),
        "graded": [
            {
                "questionId": item["questionId"],
                "questionType": item["questionType"],
                "isCorrect": item["isCorrect"],
                "answers": item["answers"],
                "correctOptionIds": item["correctOptionIds"],
                "correctTexts": item["correctTexts"],
                "analysis": item["analysis"],
            }
            for item in result["graded"]
        ],
        "complete": result["complete"],
        "progress": {
            "before": {
                "answered": result["progressBefore"].answer_count,
                "total": result["progressBefore"].question_count,
            },
            "after": {
                "answered": result["progressAfter"].answer_count,
                "total": result["progressAfter"].question_count,
            },
        },
        "questions": [
            {
                "questionId": question.get("id"),
                "questionType": question.get("questionType"),
                "typeName": question.get("questionTypeName"),
                "content": question.get("content"),
                "options": [
                    {"id": option.get("id"), "content": option.get("content")}
                    for option in question.get("optionVos") or []
                ],
            }
            for question in result["questions"]
        ],
        "answers": result["answers"],
        "nextRound": result.get("nextRound"),
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    spec = parse_answers(args.answer)
    if spec and not args.submit:
        print(json.dumps({"warning": "带了 --answer 但没有 --submit：只保存不交卷，本轮不计分"},
                         ensure_ascii=False))

    try:
        client = ZhsMasteryClient(cookie_file=args.cookies)
    except FileNotFoundError:
        print(json.dumps({"error": "COOKIE_FILE_MISSING",
                          "hint": "先扫码登录或导入 cookies.json"}, ensure_ascii=False))
        return 2

    try:
        result = client.practice_round(
            sc_map_id=args.sc_map_id, course_id=args.course_id,
            class_id=args.class_id, knowledge_id=args.knowledge_id,
            answerer=build_answerer(client, spec) if spec else None,
            delay=args.delay, submit=args.submit,
            verify=not args.no_verify,
            tolerate_errors=args.tolerate_errors,
        )
    except ZhsApiError as error:
        print(json.dumps({
            "error": {"endpoint": error.endpoint, "code": error.code, "message": error.message},
        }, ensure_ascii=False, indent=2))
        return 1
    except KeyError as error:
        print(json.dumps({"error": {"code": "OPTION_MATCH_FAILED", "message": str(error)}},
                         ensure_ascii=False, indent=2))
        return 3

    print(json.dumps(summarise(result), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
