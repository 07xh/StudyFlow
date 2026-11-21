"""Optional AI assistance for the user's own Zhidao *practice* questions.

No ZHS cookie, account metadata, question IDs, or grades are sent to the AI
provider. The user explicitly opts in and supplies an API key per run.
AI suggestions are unverified; the official graded response is the sole source
of correctness and mastery changes.
"""
from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.request
from typing import Any

API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"


class AiAnswerError(RuntimeError):
    pass


def _plain(value: Any) -> str:
    text = html.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()[:7000]


def suggest(question: dict[str, Any], key: str, timeout: float) -> Any:
    """Return answer in the existing bridge shape: option ID(s) or fill text(s)."""
    if not key or timeout < 3:
        raise AiAnswerError("AI_NOT_CONFIGURED")
    kind = question.get("question_type")
    if kind not in (1, 2, 3, 14):
        raise AiAnswerError("UNSUPPORTED_QUESTION_TYPE")
    options = [
        {"id": option.get("id"), "content": _plain(option.get("content"))}
        for option in (question.get("options") or [])
        if isinstance(option, dict)
    ]
    # Only the question content and options leave the device.
    context = json.dumps({
        "kind": kind, "question": _plain(question.get("content")),
        "options": options,
        "rule": (
            "Return JSON {\"answers\":[...]}, without prose. "
            "For single choice and judgement return exactly one option integer ID; "
            "for multiple choice return the selected option integer IDs; "
            "for fill in the blanks return the answer string for each blank, "
            "or one string if there is only one blank. "
            "Return [] when unsure. Do not invent option IDs."
        ),
    }, ensure_ascii=False)
    request = urllib.request.Request(
        API_URL,
        data=json.dumps({
            "model": MODEL,
            "messages": [
                {"role": "system", "content": "You assist with practice exercises. Reply using only valid JSON."},
                {"role": "user", "content": context},
            ],
            "response_format": {"type": "json_object"},
            "stream": False,
            "max_tokens": 850,
        }, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=min(30.0, timeout)) as reply:
            if reply.status != 200:
                raise AiAnswerError("AI_REQUEST_FAILED")
            response = json.loads(reply.read(100_000))
        raw = response["choices"][0]["message"]["content"]
        answers = json.loads(raw)["answers"]
    except (urllib.error.URLError, TimeoutError, OSError, ValueError,
            KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise AiAnswerError("AI_REQUEST_FAILED") from exc

    if not isinstance(answers, list) or not 1 <= len(answers) <= 30:
        raise AiAnswerError("AI_UNCERTAIN")
    if kind == 3:
        if not all(isinstance(x, str) and 0 < len(x.strip()) <= 2000 for x in answers):
            raise AiAnswerError("AI_INVALID_FILL")
        cleaned = [part.strip() for part in answers]
        return cleaned[0] if len(cleaned) == 1 else cleaned

    valid = {x["id"] for x in options if type(x.get("id")) is int}
    if (not valid or any(type(x) is not int or x not in valid for x in answers)
            or len(set(answers)) != len(answers)
            or (kind in (1, 14) and len(answers) != 1)):
        raise AiAnswerError("AI_INVALID_OPTION")
    return answers if kind == 2 else answers[0]
