"""Pure-HTTP Zhihuishu AI-course mastery (掌握度) exam client.

The official page does not call a documented API: every request body is wrapped
in ``secretStr`` and every exam request carries an ``XQJZXHIZ`` header.  The
scheme was recovered from ``base2.zhihuishu.com/js/2.js`` (global ``yxyz`` /
``labc`` helpers), ``studentexamcomh5`` ``app.01a6c4f0.js`` and the AI shell
``index-BjYCgkx4.js``, then verified byte-for-byte against a real HAR.

Wire format::

    GET  https://appcomm-user.zhihuishu.com/app-commserv-user/c/has?uid=<b64>
         uid = RSA-PKCS1v1.5({"uid": <module>}, EMBEDDED_PUBLIC_KEY)
         -> {"rt": {"sl": "<b64>"}}
    sl   = RSA ciphertext produced by the server's private key
         client applies the public exponent: payload = RSA_pub_decrypt(sl)
         -> {"cKey": "<16 chars>", "key": "...", "module": 3|6, ...}
    seal(obj) = b64(AES-128-CBC(PKCS7(compact_json(obj)), key=cKey, iv="1g3qqdh4jvbskb9x"))

Module ids: 3 = exam gateway (``studentexamtest``), 6 = AI course gateway
(``kg-ai-run``), 11 = study service, 14 = hike-teaching-api.

掌握度是什么
------------
掌握度卷就是知识点练习卷（官方自己叫"AI 课程作业"），不是正式考试。三重证据：

* ``getExamSheetInfo`` 返回的分部名是 ``"知识点练习默认部分"``；
* ``getExamTestUserInfo`` 返回 ``examType: 5``、``limitTime: 0``、``duration: 0``；
* 打包运行时里 ``zhs/ai/homework.py`` 的类注释直接写着
  "AI 课程的考试实际上是作业，统一命名为 homework"。

**它仍然有交卷动作。** ``POST /exam/user/submit`` 存在，参数是
``{examTestId, courseId, courseType: 8, examPaperId, aiKnlowledgeId}``，
走 exam_key、无返回体。HAR 里之所以没有 submit 帧，是因为那次操作只保存了一题
就离开页面；只保存不提交，``highMasteryScore`` 不会变。

由此得到四条实现约束：

1. *提交才算分*。``saveAnswer`` 只回 ``data: true``；``submit`` 才是算分触发点。
2. *判分靠回读*。``submit`` 没有返回体，正确性只能从"再取一次题"里读
   ``userAnswerVo[].isCorrect``；官方允许看答案时 ``optionVos[].isCorrect``
   也会填上（见 :func:`parse_question_result`）。
3. *无时限*。``limitTime == 0`` 时不做倒计时；``updateUserUsedTime`` 心跳只影响
   展示，不影响掌握度，练习可以跳过。
4. *每次新卷*。掌握度分数只能从 ``questions-paper`` 的响应里读，而这个接口每调
   一次就新建一个 ``examTestId``；重做必然是新一轮，不存在复用旧卷。
   官方通过规则：``highMasteryScore > 90`` 达标；``< 30`` 且已试 5 轮则放弃。

答案在线上是**字符串**：选择题 ``#@#`` 连接选项 id，填空题 ``/`` 连接各空，
由 :func:`format_answer` 生成。

Nothing here stores credentials: pass a live ``requests.Session`` or a cookie
mapping taken from the desktop session (``~/.zhs/cookies.json``).
"""
from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

try:  # desktop/test builds may run without the HTTP dependency
    import requests
except ModuleNotFoundError:  # pragma: no cover - crypto helpers stay usable
    requests = None  # type: ignore[assignment]

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
except ModuleNotFoundError:  # pragma: no cover - fall back to the bundled AES
    Cipher = algorithms = modes = None  # type: ignore[assignment]

from . import _aes_pure

__all__ = [
    "AES_IV",
    "ANSWER_SEPARATOR_BLANK",
    "ANSWER_SEPARATOR_CHOICE",
    "COURSE_TYPE_AI_HOMEWORK",
    "EMBEDDED_PUBLIC_KEY_B64",
    "EXAM_STATE_ANSWERING",
    "EXAM_TYPE_PRACTICE",
    "HOMEWORK_GIVE_UP_ATTEMPTS",
    "HOMEWORK_GIVE_UP_SCORE",
    "HOMEWORK_THRESHOLD_DEFAULT",
    "MODULE_EXAM",
    "MODULE_KG_AI",
    "QUESTION_TYPE_FILL",
    "QUESTION_TYPE_JUDGE",
    "KeyRing",
    "SheetProgress",
    "ZhsApiError",
    "ZhsMasteryClient",
    "answer_payload",
    "decode_answer",
    "answer_shape",
    "answer_text",
    "exam_ref_payload",
    "format_answer",
    "load_session_cookies",
    "open_exam_payload",
    "paper_payload",
    "parse_question_result",
    "parse_sheet_progress",
    "question_payload",
    "resolve_option",
    "rsa_encrypt_pkcs1v15",
    "rsa_public_decrypt",
    "seal_payload",
    "submit_payload",
]

# --------------------------------------------------------------------------
# Fixed protocol material (identical on every deployment of the student app).
# --------------------------------------------------------------------------

EMBEDDED_PUBLIC_KEY_B64 = (
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCgfZmpLpPEpEFRKBe+ZjWJUjPe+7qg7pGqcfN3j2egJ8H2"
    "mrKwaEqZEnPnpi2O3hN8HRyaFozDOp8gwZiYfiIZjWy0Jr/FNAiiKYh5bq0GsEn+ieMmRyJg/+i1rqizhvCXv"
    "FdrdGhFTw5EBwTpsGdwe1utdlrvIJUAFWj9Yh4qbQIDAQAB"
)
AES_IV = b"1g3qqdh4jvbskb9x"

MODULE_EXAM = 3
MODULE_KG_AI = 6
MODULE_STUDY = 11
MODULE_HIKE = 14

# ``getExamTestUserInfo.examType`` for a mastery paper: 知识点练习(课后习题)。
EXAM_TYPE_PRACTICE = 5
# ``examState`` values seen on the wire: 3 = 已开考未交卷(练习卷的常态)。
EXAM_STATE_ANSWERING = 3

# ``submit`` 的 courseType：8 = AI 课程作业（掌握度习题）。
COURSE_TYPE_AI_HOMEWORK = 8

# 答案在线上是**字符串**，不是数组：
#   选择题（单选/多选/判断）用 ``#@#`` 连接选项 id，填空题用 ``/`` 连接各空。
ANSWER_SEPARATOR_CHOICE = "#@#"
ANSWER_SEPARATOR_BLANK = "/"

# 掌握度作业的官方通过规则（zhs 0.1.5 ``AIConfig.ai_homework_threshold`` 默认 90）：
#   - ``highMasteryScore > threshold`` 视为达标，不再练；
#   - ``highMasteryScore < 30`` 且已试 ``give_up_attempts`` 轮以上则放弃；
#   - 其余情况每轮重新建卷、重新作答。
HOMEWORK_THRESHOLD_DEFAULT = 90
HOMEWORK_GIVE_UP_SCORE = 30
HOMEWORK_GIVE_UP_ATTEMPTS = 4

KEY_URL = "https://appcomm-user.zhihuishu.com/app-commserv-user/c/has"
EXAM_ROOT = "https://studentexamtest.zhihuishu.com/gateway/t/v1"
KG_STU_ROOT = "https://kg-ai-run.zhihuishu.com/run/gateway/t/stu"
AI_RUN_ROOT = "https://zhihuishu-ai-run-api.zhihuishu.com/run/gateway/t/v1"

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0"
)
DEFAULT_REFERER = "https://ai-smart-course-student-pro.zhihuishu.com/"
DEFAULT_ORIGIN = "https://ai-smart-course-student-pro.zhihuishu.com"

COOKIE_FILE = Path.home() / ".zhs" / "cookies.json"


class ZhsApiError(RuntimeError):
    """Server answered, but not with the success envelope."""

    def __init__(self, endpoint: str, code: Any, message: str, payload: Any = None) -> None:
        super().__init__(f"{endpoint} -> code={code} message={message}")
        self.endpoint = endpoint
        self.code = code
        self.message = message
        self.payload = payload


# --------------------------------------------------------------------------
# RSA (1024-bit, PKCS#1 v1.5) on plain integers -- no extra dependency.
# --------------------------------------------------------------------------


def _tlv(data: bytes, offset: int) -> tuple[int, int, int]:
    """Return ``(tag, value_offset, value_length)`` for one DER element."""
    tag = data[offset]
    length = data[offset + 1]
    offset += 2
    if length & 0x80:
        width = length & 0x7F
        length = int.from_bytes(data[offset:offset + width], "big")
        offset += width
    return tag, offset, length


def _public_numbers() -> tuple[int, int]:
    """Extract ``(n, e)`` from the embedded SubjectPublicKeyInfo blob."""
    der = base64.b64decode(EMBEDDED_PUBLIC_KEY_B64)
    _, offset, _ = _tlv(der, 0)                       # outer SEQUENCE
    _, alg_offset, alg_length = _tlv(der, offset)     # AlgorithmIdentifier
    bit_tag, bit_offset, bit_length = _tlv(der, alg_offset + alg_length)
    if bit_tag != 0x03:
        raise ValueError("EMBEDDED_PUBLIC_KEY_INVALID")
    inner = der[bit_offset + 1:bit_offset + bit_length]  # drop unused-bits byte
    _, seq_offset, _ = _tlv(inner, 0)
    _, n_offset, n_length = _tlv(inner, seq_offset)
    modulus = int.from_bytes(inner[n_offset:n_offset + n_length], "big")
    exponent_tag, e_offset, e_length = _tlv(inner, n_offset + n_length)
    if exponent_tag != 0x02:
        raise ValueError("EMBEDDED_PUBLIC_KEY_INVALID")
    exponent = int.from_bytes(inner[e_offset:e_offset + e_length], "big")
    return modulus, exponent


def _modulus_size(modulus: int) -> int:
    return (modulus.bit_length() + 7) // 8


def _nonzero_random(length: int) -> bytes:
    out = bytearray()
    while len(out) < length:
        out.extend(byte for byte in os.urandom(length) if byte)
    return bytes(out[:length])


def rsa_encrypt_pkcs1v15(message: bytes) -> bytes:
    """RSA public operation with PKCS#1 v1.5 type-2 padding (what JSEncrypt does)."""
    modulus, exponent = _public_numbers()
    size = _modulus_size(modulus)
    if len(message) > size - 11:
        raise ValueError("RSA_MESSAGE_TOO_LONG")
    block = b"\x00\x02" + _nonzero_random(size - 3 - len(message)) + b"\x00" + message
    return pow(int.from_bytes(block, "big"), exponent, modulus).to_bytes(size, "big")


def rsa_public_decrypt(ciphertext: bytes) -> bytes:
    """Apply the public exponent and strip PKCS#1 v1.5 padding.

    The key service signs its payload with the matching private key, so the
    client recovers it with the public half only.  The block is either type 1
    (``00 01 FF..``) or type 2 (``00 02 ..``) -- accept both, as browsers do.
    """
    modulus, exponent = _public_numbers()
    size = _modulus_size(modulus)
    if len(ciphertext) != size:
        raise ValueError("RSA_CIPHERTEXT_LENGTH_INVALID")
    block = pow(int.from_bytes(ciphertext, "big"), exponent, modulus).to_bytes(size, "big")
    if block[0] != 0x00 or block[1] not in (0x01, 0x02):
        raise ValueError("RSA_PADDING_INVALID")
    separator = block.find(b"\x00", 2)
    if separator < 10:
        raise ValueError("RSA_PADDING_INVALID")
    return block[separator + 1:]


# --------------------------------------------------------------------------
# AES-128-CBC (CryptoJS compatible: CBC + PKCS7 + base64)
# --------------------------------------------------------------------------


def _pad_pkcs7(data: bytes) -> bytes:
    pad = 16 - len(data) % 16
    return data + bytes([pad]) * pad


def aes_cbc_encrypt(plaintext: bytes, key: bytes, iv: bytes = AES_IV) -> bytes:
    if Cipher is not None:
        encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
        return encryptor.update(_pad_pkcs7(plaintext)) + encryptor.finalize()
    return _aes_pure.aes128_cbc_encrypt(plaintext, key, iv)


def aes_cbc_decrypt(ciphertext: bytes, key: bytes, iv: bytes = AES_IV) -> bytes:
    if Cipher is not None:
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()
    else:
        padded = _aes_pure.aes128_cbc_decrypt(ciphertext, key, iv)
        return padded  # the fallback already stripped PKCS#7
    if not padded:
        raise ValueError("AES_EMPTY_CIPHERTEXT")
    pad = padded[-1]
    if not 1 <= pad <= 16 or padded[-pad:] != bytes([pad]) * pad:
        raise ValueError("AES_PADDING_INVALID")
    return padded[:-pad]


def _compact_json(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def seal_payload(payload: Any, ckey: str) -> str:
    """``yxyz(payload, serverKey)`` -> base64 ``secretStr``."""
    if not isinstance(ckey, str) or len(ckey) != 16:
        raise ValueError("AES_KEY_INVALID")
    return base64.b64encode(aes_cbc_encrypt(_compact_json(payload).encode("utf-8"), ckey.encode("ascii"))).decode()


def unseal_payload(secret: str, ckey: str) -> str:
    """Inverse of :func:`seal_payload`; used by diagnostics and tests."""
    return aes_cbc_decrypt(base64.b64decode(secret), ckey.encode("ascii")).decode("utf-8")


# --------------------------------------------------------------------------
# Request bodies actually observed on the wire (field order matters).
# --------------------------------------------------------------------------


def paper_payload(
    *, sc_map_id: str, course_id: str, class_id: str, knowledge_id: str,
    date_formate: int | None = None,
) -> dict[str, Any]:
    """Body of ``POST /run/gateway/t/stu/exam/questions-paper`` (module 6)."""
    return {
        "scMapId": str(sc_map_id),
        "courseId": str(course_id),
        "classId": str(class_id),
        "knowledgeId": str(knowledge_id),
        "dateFormate": int(date_formate if date_formate is not None else _now_ms()),
    }


def open_exam_payload(*, exam_test_id: Any, exam_paper_id: Any, course_id: Any) -> dict[str, Any]:
    """Body of ``POST /exam/user/openExam`` (module 3). IDs stay integers here."""
    return {
        "examTestId": int(exam_test_id),
        "examPaperId": int(exam_paper_id),
        "courseId": str(course_id),
    }


def exam_ref_payload(*, exam_test_id: Any, exam_paper_id: Any) -> dict[str, Any]:
    """Body of ``getExamTestUserInfo`` / ``getExamSheetInfo`` (module 3). Strings here."""
    return {"examTestId": str(exam_test_id), "examPaperId": str(exam_paper_id)}


def question_payload(
    *, exam_test_id: Any, exam_paper_id: Any, question_id: Any, version: Any = 1,
) -> dict[str, Any]:
    """Body of ``GET /question/getExamQuestionInfo`` (module 3)."""
    return {
        "examTestId": str(exam_test_id),
        "examPaperId": int(exam_paper_id),
        "questionId": int(question_id),
        "version": int(version),
    }


def answer_payload(
    *, recruit_id: Any, exam_test_id: Any, exam_paper_id: Any,
    question_id: Any, answer: Any = None, data_vos: Any = None,
) -> dict[str, Any]:
    """Body of ``POST /answer/saveAnswer`` (module 3).

    ``answer`` is what the page puts in ``answer``: an option id for single
    choice, an id list for multiple choice, text for blanks.  ``null`` is a
    real observed value and makes the server answer ``2046``.
    """
    return {
        "recruitId": str(recruit_id),
        "examTestId": str(exam_test_id),
        "examPaperId": int(exam_paper_id),
        "questionId": int(question_id),
        "dataVos": data_vos,
        "answer": answer,
    }


def submit_payload(
    *, exam_test_id: Any, course_id: Any, exam_paper_id: Any, knowledge_id: Any,
    course_type: int = COURSE_TYPE_AI_HOMEWORK,
) -> dict[str, Any]:
    """Body of ``POST /exam/user/submit`` for a 掌握度作业 -- **实测存在**。

    字段与顺序取自打包运行时的 ``zhs/ai/homework.py::HomeworkCtx._submit``
    （zhs 0.1.5，本机 PyInstaller 解包目录可读）；``courseType: 8`` 是 AI 作业，
    ``aiKnlowledgeId`` 是官方原始拼写（源码如此，少一个 ``e``，照抄不要"修正"）。

    ``examTestId`` / ``courseId`` / ``examPaperId`` / ``aiKnlowledgeId`` 全为整数。

    这份 HAR 里没有 submit 帧，是因为那次操作只保存了一题就离开了页面；接口本身
    存在，且是掌握度算分的触发点——不提交则 ``highMasteryScore`` 不会动。
    """
    return {
        "examTestId": int(exam_test_id),
        "courseId": int(course_id),
        "courseType": int(course_type),
        "examPaperId": int(exam_paper_id),
        "aiKnlowledgeId": int(knowledge_id),
    }


def _now_ms() -> int:
    return int(time.time() * 1000)


# --------------------------------------------------------------------------
# Turning a question payload into the value ``saveAnswer`` expects.
# --------------------------------------------------------------------------

# 题型枚举取自 zhs 0.1.5 ``zhs/ai/models.py::QuestionType``（线上真实值）：
#   1 单选 / 2 多选 / 3 填空 / 14 判断。判断题在线上按"单选项 id"提交。
QUESTION_TYPE_SINGLE = 1
QUESTION_TYPE_MULTI = 2
QUESTION_TYPE_FILL = 3
QUESTION_TYPE_JUDGE = 14


def answer_shape(question: Mapping[str, Any]) -> str:
    """``"single"`` / ``"multi"`` / ``"text"`` -- what ``answer`` should look like."""
    question_type = question.get("questionType")
    options = [item for item in (question.get("optionVos") or []) if isinstance(item, dict)]
    if question_type == QUESTION_TYPE_SINGLE:
        return "single"
    if question_type == QUESTION_TYPE_JUDGE:
        return "single"
    if question_type == QUESTION_TYPE_MULTI:
        return "multi"
    if question_type == QUESTION_TYPE_FILL:
        return "text"
    if not options:
        return "text"
    has_blank = any(not (item.get("content") or "").strip() for item in options)
    return "text" if has_blank else "single"


def format_answer(answers: Any, question_type: Any) -> str:
    """把答案拼成线上要的**字符串**（``saveAnswer``/``saveBatchAnswer`` 都收字符串）。

    选择题/判断题：选项 id 用 ``#@#`` 连接，例如 ``671372795#@#671372796``；
    填空题（``questionType == 3``）：各空用 ``/`` 连接，例如 ``生产力/生产关系``。
    单个答案就是它自己，不加分隔符。
    """
    if answers is None:
        return ""
    if isinstance(answers, (str, int)):
        items = [str(answers)]
    elif isinstance(answers, Iterable):
        items = [str(item) for item in answers]
    else:
        items = [str(answers)]
    separator = ANSWER_SEPARATOR_BLANK if question_type == QUESTION_TYPE_FILL else ANSWER_SEPARATOR_CHOICE
    return separator.join(items)


def decode_answer(answer: Any, question_type: Any) -> Any:
    """``format_answer`` 的逆运算：把线上字符串还原成界面能用的形状。

    用于"刷新后恢复未提交的一轮"：服务端只回 ``#@#`` / ``/`` 拼起来的字符串，
    界面需要知道选了哪几个选项、填了几个空。选项 id 能转成 int 就转，转不了
    （真实填空题）保留文本；单选/判断回单个值，多选回列表，填空回列表。
    """
    if answer is None:
        return None
    if isinstance(answer, (int, float)):
        return answer
    if isinstance(answer, (list, tuple)):
        parts = [item for item in answer]
    else:
        text = str(answer)
        separator = ANSWER_SEPARATOR_BLANK if question_type == QUESTION_TYPE_FILL else ANSWER_SEPARATOR_CHOICE
        parts = text.split(separator) if text else []
    cleaned: list[Any] = []
    for part in parts:
        if isinstance(part, (int, float)):
            cleaned.append(part)
            continue
        text = str(part).strip()
        if text.isdigit():
            cleaned.append(int(text))
        elif text:
            cleaned.append(text)
    if question_type in (QUESTION_TYPE_FILL, QUESTION_TYPE_MULTI):
        return cleaned
    return cleaned[0] if cleaned else None


def parse_question_result(question: Mapping[str, Any]) -> dict[str, Any]:
    """提交后重取的同一条题目里读判分：``userAnswerVo[].isCorrect``。

    这是**唯一**的正确性来源——``submit`` 没有返回体，``saveAnswer`` 只回
    ``data: true``。提交前 ``userAnswerVo`` 为 ``null``、``optionVos[].isCorrect``
    全 ``null``；提交后服务端把两者都填上。

    返回的 ``correctOptionIds`` 是官方允许查看的正确答案（``isLookAnswer: 1``
    时才有值），``analysis`` 取 ``analysisVo`` 里的解析文本。
    """
    raw_answers = question.get("userAnswerVo")
    user_answers = raw_answers if isinstance(raw_answers, list) else []
    answers_payload = [
        {
            "answer": str(item.get("answer") or ""),
            "isCorrect": item.get("isCorrect") == 1,
        }
        for item in user_answers if isinstance(item, dict)
    ]
    correct_ids: list[Any] = []
    correct_texts: list[str] = []
    for option in question.get("optionVos") or []:
        if isinstance(option, dict) and option.get("isCorrect") == 1:
            correct_ids.append(option.get("id"))
            correct_texts.append(str(option.get("content") or ""))
    for item in user_answers:
        if isinstance(item, dict) and item.get("isCorrect") == 1 and item.get("answer"):
            correct_texts.append(str(item.get("answer")))
    analysis = question.get("analysisVo")
    analysis_text = ""
    if isinstance(analysis, dict):
        analysis_text = str(analysis.get("analysis") or analysis.get("content") or "")
    elif isinstance(analysis, str):
        analysis_text = analysis
    # userAnswerVo 存在不代表判分已经完成：服务端可能先返回答案，
    # 而 isCorrect 仍为 null。不能把 null 当作“错误”计入 0 分。
    graded = bool(answers_payload) and all(
        isinstance(item, dict)
        and type(item.get("isCorrect")) is int
        and item["isCorrect"] in (0, 1)
        for item in user_answers
    )
    return {
        "questionId": question.get("id"),
        "questionType": question.get("questionType"),
        "graded": graded,
        "isCorrect": graded and all(item["isCorrect"] for item in answers_payload),
        "answers": answers_payload,
        "correctOptionIds": correct_ids,
        "correctTexts": correct_texts,
        "analysis": analysis_text,
    }


def resolve_option(question: Mapping[str, Any], *keywords: str) -> Any:
    """Map option text to the id ``saveAnswer`` needs.

    ``resolve_option(question, "新时代")`` -> ``671372794`` for a single-choice
    question; for a multi-choice question it returns every option whose text
    contains one of the keywords, in option order.  Raises ``KeyError`` when a
    keyword matches nothing so a typo never turns into a wrong answer.
    """
    options = [item for item in (question.get("optionVos") or []) if isinstance(item, dict)]
    if not options:
        raise KeyError("QUESTION_HAS_NO_OPTIONS")
    matched: list[Any] = []
    missing: list[str] = []
    for keyword in keywords:
        hit = [
            item for item in options
            if keyword and keyword in (item.get("content") or "")
        ]
        if not hit:
            missing.append(keyword)
            continue
        for item in hit:
            if item.get("id") not in matched:
                matched.append(item.get("id"))
    if missing:
        raise KeyError(f"OPTION_TEXT_NOT_FOUND: {missing!r}")
    if answer_shape(question) == "single":
        if len(matched) != 1:
            raise KeyError(f"AMBIGUOUS_SINGLE_CHOICE: {matched!r}")
        return matched[0]
    return matched


def answer_text(question: Mapping[str, Any], value: str | Iterable[str]) -> Any:
    """Blanks/简答: single string stays a string, several stay a list."""
    if isinstance(value, str):
        return value
    items = [str(item) for item in value]
    return items[0] if len(items) == 1 else items


# --------------------------------------------------------------------------
# Sheet progress -- the only completion signal a practice paper has.
# --------------------------------------------------------------------------


@dataclass
class SheetProgress:
    """Per-question answer state parsed out of ``getExamSheetInfo``.

    ``answerState``: 1 = 未作答, 其他值 = 已保存过答案。练习卷没有"已交卷"态,
    所以 ``answerCount == questionCount`` 就是这一轮做完的全部含义。
    """

    answer_count: int
    question_count: int
    entries: list[dict[str, Any]]

    @property
    def complete(self) -> bool:
        return self.question_count > 0 and self.answer_count >= self.question_count

    @property
    def pending(self) -> list[dict[str, Any]]:
        return [row for row in self.entries if row.get("answerState") in (None, 1)]

    @property
    def ratio(self) -> float:
        if self.question_count <= 0:
            return 0.0
        return min(1.0, self.answer_count / self.question_count)


def parse_sheet_progress(sheet: Mapping[str, Any]) -> SheetProgress:
    """Flatten ``partSheetVos[].questionSheetVos[]`` and read the counters.

    ``answerCount`` is taken from the envelope when present; if the server omits
    it, the per-question ``answerState`` is used instead so the result is still
    correct on a partial payload.
    """
    entries: list[dict[str, Any]] = []
    for part in sheet.get("partSheetVos") or []:
        if not isinstance(part, dict):
            continue
        for row in part.get("questionSheetVos") or []:
            if isinstance(row, dict) and row.get("questionId") is not None:
                entries.append(row)
    raw_answer_count = sheet.get("answerCount")
    if isinstance(raw_answer_count, int):
        answer_count = raw_answer_count
    else:
        answer_count = sum(1 for row in entries if row.get("answerState") not in (None, 1))
    raw_question_count = sheet.get("questionCount")
    if isinstance(raw_question_count, int) and raw_question_count >= 0:
        question_count = raw_question_count
    else:
        question_count = len(entries)
    return SheetProgress(
        answer_count=answer_count, question_count=question_count, entries=entries,
    )


# --------------------------------------------------------------------------
# Session helpers
# --------------------------------------------------------------------------


def load_session_cookies(path: str | Path | None = None) -> dict[str, str]:
    """Read the desktop session cookie file (Playwright ``[{name, value}]`` list)."""
    target = Path(path) if path is not None else COOKIE_FILE
    rows = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("COOKIE_FILE_INVALID")
    cookies: dict[str, str] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("name"), str) and isinstance(row.get("value"), str):
            cookies[row["name"]] = row["value"]
    if not cookies:
        raise ValueError("COOKIE_FILE_INVALID")
    return cookies


def build_session(
    cookies: Mapping[str, str] | None = None,
    *, user_agent: str = DEFAULT_USER_AGENT,
    cookie_file: str | Path | None = None,
) -> requests.Session:
    if requests is None:
        raise RuntimeError("REQUESTS_UNAVAILABLE")
    session = requests.Session()
    session.headers.update({
        "User-Agent": user_agent,
        "Origin": DEFAULT_ORIGIN,
        "Referer": DEFAULT_REFERER,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    jar = cookies if cookies is not None else load_session_cookies(cookie_file)
    for name, value in jar.items():
        session.cookies.set(name, value, domain=".zhihuishu.com")
    return session


# --------------------------------------------------------------------------
# Key ring: one ``cKey`` per module, cached until the server rotates it.
# --------------------------------------------------------------------------


@dataclass
class _KeyEntry:
    ckey: str
    raw: dict[str, Any]
    fetched_at: float


class KeyRing:
    """Fetches and caches the AES material behind ``yxyz``."""

    def __init__(self, session: requests.Session, *, ttl: float = 900.0, timeout: float = 25.0) -> None:
        self._session = session
        self._ttl = ttl
        self._timeout = timeout
        self._cache: dict[int, _KeyEntry] = {}

    def _fetch(self, module: int) -> _KeyEntry:
        uid = base64.b64encode(rsa_encrypt_pkcs1v15(_compact_json({"uid": module}).encode("utf-8"))).decode()
        response = self._session.get(KEY_URL, params={"uid": uid}, timeout=self._timeout)
        response.raise_for_status()
        body = response.json()
        try:
            secret = body["rt"]["sl"]
        except (KeyError, TypeError) as error:
            raise ZhsApiError("c/has", body.get("status"), str(body.get("msg", ""))[:200], body) from error
        try:
            raw = json.loads(rsa_public_decrypt(base64.b64decode(secret)).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as error:
            raise ZhsApiError("c/has", "KEY_DECODE_FAILED", str(error), None) from error
        ckey = raw.get("cKey")
        if not isinstance(ckey, str) or len(ckey) != 16:
            raise ZhsApiError("c/has", "KEY_SHAPE_UNEXPECTED", "cKey missing", raw)
        return _KeyEntry(ckey=ckey, raw=raw, fetched_at=time.monotonic())

    def entry(self, module: int, *, force: bool = False) -> _KeyEntry:
        cached = self._cache.get(module)
        if cached is not None and not force and time.monotonic() - cached.fetched_at < self._ttl:
            return cached
        fresh = self._fetch(module)
        self._cache[module] = fresh
        return fresh

    def ckey(self, module: int, *, force: bool = False) -> str:
        return self.entry(module, force=force).ckey

    def seal(self, payload: Any, module: int, *, force: bool = False) -> str:
        return seal_payload(payload, self.ckey(module, force=force))

    def header_token(self, module: int = MODULE_KG_AI, *, force: bool = False) -> str:
        """``XQJZXHIZ``: ``yxyz("", key)`` -- AES of the empty string."""
        return self.seal("", module, force=force)

    def invalidate(self, module: int) -> None:
        self._cache.pop(module, None)


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


class ZhsMasteryClient:
    """Create, answer and submit one mastery paper over plain HTTP."""

    def __init__(
        self,
        session: requests.Session | None = None,
        *,
        cookies: Mapping[str, str] | None = None,
        cookie_file: str | Path | None = None,
        timeout: float = 25.0,
        referer: str = DEFAULT_REFERER,
        origin: str = DEFAULT_ORIGIN,
    ) -> None:
        self.session = session if session is not None else build_session(
            cookies, cookie_file=cookie_file
        )
        self.timeout = timeout
        self.referer = referer
        self.origin = origin
        self.keys = KeyRing(self.session, timeout=timeout)

    # -- plumbing ---------------------------------------------------------

    def _headers(self, extra: Mapping[str, str] | None = None) -> dict[str, str]:
        headers = {"Origin": self.origin, "Referer": self.referer}
        if extra:
            headers.update(extra)
        return headers

    @staticmethod
    def _parse(endpoint: str, body: Any) -> Any:
        if not isinstance(body, dict):
            raise ZhsApiError(endpoint, "NON_JSON", "response is not a JSON object", body)
        code = body.get("code")
        if code not in (0, 200):
            raise ZhsApiError(endpoint, code, str(body.get("message") or body.get("msg") or "")[:300], body)
        return body.get("data")

    def _request(
        self, method: str, url: str, *, params: Mapping[str, Any] | None = None,
        data: Mapping[str, Any] | None = None, json_body: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        response = self.session.request(
            method, url, params=params, data=data, json=json_body,
            headers=self._headers(headers), timeout=self.timeout,
        )
        if response.status_code != 200:
            raise ZhsApiError(url, response.status_code, "http error", response.text[:300])
        try:
            body = response.json()
        except ValueError as error:
            raise ZhsApiError(url, "NON_JSON", "response is not JSON", response.text[:300]) from error
        return self._parse(url, body)

    def _request_raw(
        self, method: str, url: str, *, data: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> str:
        """发送一个可能**没有 JSON 返回体**的请求（``submit`` 就是这种）。

        只看 HTTP 200；正文有 JSON 时额外校验 ``code``，空正文直接算成功。
        """
        response = self.session.request(
            method, url, data=data, headers=self._headers(headers), timeout=self.timeout,
        )
        if response.status_code != 200:
            raise ZhsApiError(url, response.status_code, "http error", response.text[:300])
        text = response.text or ""
        if text.strip():
            try:
                body = json.loads(text)
            except ValueError:
                return text
            if isinstance(body, dict) and body.get("code") not in (None, 0, 200):
                raise ZhsApiError(
                    url, body.get("code"),
                    str(body.get("message") or body.get("msg") or "")[:300], body,
                )
        return text

    # -- mastery entry ----------------------------------------------------

    def create_paper(
        self, *, sc_map_id: str, course_id: str, class_id: str, knowledge_id: str,
        date_formate: int | None = None,
    ) -> dict[str, Any]:
        """Start a mastery paper; returns ``examTestId``/``paperId``/scores.

        This is also the mastery read: ``masteryScore`` / ``highMasteryScore``
        describe the knowledge point before this paper is answered.
        """
        payload = paper_payload(
            sc_map_id=sc_map_id, course_id=course_id, class_id=class_id,
            knowledge_id=knowledge_id, date_formate=date_formate,
        )
        body = {
            "secretStr": self.keys.seal(payload, MODULE_KG_AI),
            "date": _now_ms(),
        }
        data = self._request(
            "POST", f"{KG_STU_ROOT}/exam/questions-paper", json_body=body,
            headers={
                "Content-Type": "application/json;charset=UTF-8",
                "XQJZXHIZ": self.keys.header_token(MODULE_KG_AI),
            },
        )
        if not isinstance(data, dict):
            raise ZhsApiError("questions-paper", "DATA_SHAPE_UNEXPECTED", "missing data", data)
        return data

    # -- exam session -----------------------------------------------------

    def open_exam(self, *, exam_test_id: Any, exam_paper_id: Any, course_id: Any) -> Any:
        payload = open_exam_payload(
            exam_test_id=exam_test_id, exam_paper_id=exam_paper_id, course_id=course_id,
        )
        return self._request(
            "POST", f"{EXAM_ROOT}/exam/user/openExam",
            data={"secretStr": self.keys.seal(payload, MODULE_EXAM)},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def exam_status(self, *, exam_test_id: Any, exam_paper_id: Any) -> dict[str, Any]:
        payload = exam_ref_payload(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        data = self._request(
            "GET", f"{EXAM_ROOT}/exam/user/getExamTestUserInfo",
            params={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
        )
        if not isinstance(data, dict):
            raise ZhsApiError("getExamTestUserInfo", "DATA_SHAPE_UNEXPECTED", "missing data", data)
        return data

    def sheet(self, *, exam_test_id: Any, exam_paper_id: Any) -> dict[str, Any]:
        payload = exam_ref_payload(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        data = self._request(
            "GET", f"{EXAM_ROOT}/exam/user/getExamSheetInfo",
            params={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
        )
        if not isinstance(data, dict):
            raise ZhsApiError("getExamSheetInfo", "DATA_SHAPE_UNEXPECTED", "missing data", data)
        return data

    def question(
        self, *, exam_test_id: Any, exam_paper_id: Any, question_id: Any, version: Any = 1,
    ) -> dict[str, Any]:
        payload = question_payload(
            exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
            question_id=question_id, version=version,
        )
        data = self._request(
            "GET", f"{EXAM_ROOT}/question/getExamQuestionInfo",
            params={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
        )
        if not isinstance(data, dict):
            raise ZhsApiError("getExamQuestionInfo", "DATA_SHAPE_UNEXPECTED", "missing data", data)
        return data

    def save_answer(
        self, *, recruit_id: Any, exam_test_id: Any, exam_paper_id: Any,
        question_id: Any, answer: Any = None, data_vos: Any = None,
    ) -> Any:
        payload = answer_payload(
            recruit_id=recruit_id, exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
            question_id=question_id, answer=answer, data_vos=data_vos,
        )
        return self._request(
            "POST", f"{EXAM_ROOT}/answer/saveAnswer",
            data={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def submit(
        self, *, exam_test_id: Any, course_id: Any, exam_paper_id: Any,
        knowledge_id: Any, course_type: int = COURSE_TYPE_AI_HOMEWORK,
    ) -> bool:
        """提交本轮掌握度作业：``POST /exam/user/submit``（exam_key，**无返回体**）。

        参数与顺序照抄 ``zhs/ai/homework.py::HomeworkCtx._submit``：
        ``examTestId / courseId / courseType=8 / examPaperId / aiKnlowledgeId``。

        这一步是掌握度算分的触发点：只保存不提交，``highMasteryScore`` 不会动。
        成功判据是 HTTP 200 且（若返回 JSON）``code`` 为 0/200。
        """
        payload = submit_payload(
            exam_test_id=exam_test_id, course_id=course_id, exam_paper_id=exam_paper_id,
            knowledge_id=knowledge_id, course_type=course_type,
        )
        self._request_raw(
            "POST", f"{EXAM_ROOT}/exam/user/submit",
            data={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        return True

    def heartbeat(self, *, exam_test_id: Any, exam_paper_id: Any, seconds: int = 5) -> Any:
        """``updateUserUsedTime``：官方页面每 5 秒一次，练习卷可以直接跳过。

        只影响 ``usedTime`` 展示，不影响掌握度；保留用于对齐官方节奏。
        """
        payload = {
            "examTestId": str(exam_test_id),
            "examPaperId": int(exam_paper_id),
            "heartbeatTime": int(seconds),
        }
        return self._request(
            "POST", f"{EXAM_ROOT}/exam/user/updateUserUsedTime",
            data={"secretStr": self.keys.seal(payload, MODULE_EXAM), "date": _now_ms()},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def result_page(self, params: Mapping[str, Any]) -> Any:
        """``getUserAnswer`` -- answer sheet after submit (plain JSON, no seal)."""
        body = {"uuid": self._uuid(), "date": _now_ms(), **dict(params)}
        return self._request(
            "POST", f"{KG_STU_ROOT}/exam/questions-paper-result-page", json_body=body,
            headers={"Content-Type": "application/json;charset=UTF-8"},
        )

    def exam_list(self, params: Mapping[str, Any]) -> Any:
        """``getExamList`` -- plain JSON, ``fixeParam$1()`` adds uuid/date."""
        body = {"uuid": self._uuid(), "date": _now_ms(), **dict(params)}
        return self._request(
            "POST", f"{AI_RUN_ROOT}/stuApi/knowledgePoint/getExamList", json_body=body,
            headers={"Content-Type": "application/json;charset=UTF-8"},
        )

    # -- composite flows --------------------------------------------------

    #: Sentinel an ``answerer`` callback returns to skip one question.
    SKIP = object()

    def progress(
        self, *, exam_test_id: Any, exam_paper_id: Any,
        sheet: Mapping[str, Any] | None = None,
    ) -> SheetProgress:
        """Answer completion for one practice paper."""
        current = sheet if sheet is not None else self.sheet(
            exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
        )
        return parse_sheet_progress(current)

    def answer_round(
        self, *, exam_test_id: Any, exam_paper_id: Any, recruit_id: Any,
        answers: Mapping[Any, Any], delay: float = 0.6, tolerate_errors: bool = False,
    ) -> list[dict[str, Any]]:
        """Save one answer per question id; returns per-question outcomes.

        ``answers`` maps ``questionId`` -> the value ``saveAnswer`` takes (option
        id, id list, or text).  ``delay`` spaces the requests out -- the page
        does the same, roughly one save per second.  With ``tolerate_errors`` a
        rejected save is recorded and the round continues instead of raising.
        """
        results: list[dict[str, Any]] = []
        for question_id, value in answers.items():
            try:
                data = self.save_answer(
                    recruit_id=recruit_id, exam_test_id=exam_test_id,
                    exam_paper_id=exam_paper_id, question_id=question_id, answer=value,
                )
            except ZhsApiError as error:
                if not tolerate_errors:
                    raise
                results.append({
                    "questionId": question_id, "answer": value,
                    "ok": False, "code": error.code, "message": error.message,
                })
                continue
            results.append({"questionId": question_id, "answer": value, "ok": bool(data)})
            if delay > 0:
                time.sleep(delay)
        return results

    def practice_round(
        self, *,
        sc_map_id: str, course_id: str, class_id: str, knowledge_id: str,
        answers: Mapping[Any, Any] | None = None,
        answerer: Callable[[dict[str, Any], SheetProgress], Any] | None = None,
        delay: float = 0.6, submit: bool = True, verify: bool = True,
        tolerate_errors: bool = False,
    ) -> dict[str, Any]:
        """跑完一轮掌握度作业：建卷 → 开卷 → 取题 → 存答 → 提交 → 读判分 → 读新掌握度。

        请求顺序与 zhs 0.1.5 ``HomeworkCtx`` 完全一致：

        ``questions-paper`` → ``openExam`` → ``getExamSheetInfo`` →
        ``getExamQuestionInfo`` × N → ``saveAnswer`` × N → ``exam/user/submit`` →
        重取每题读 ``userAnswerVo[].isCorrect`` → （可选）再 ``questions-paper``。

        两种给答案的方式，都可选：

        * ``answers`` —— ``{questionId: 答案}``；值可以是选项 id、id 列表或文本，
          内部用 :func:`format_answer` 拼成线上要的 ``#@#`` / ``/`` 字符串；
        * ``answerer`` —— ``fn(question, progress) -> 答案``，对未被 ``answers``
          覆盖的题目调用；返回 :attr:`SKIP` 跳过该题。

        两个都不给就只是"建卷读题"，不会写任何东西。

        ``submit=True``（默认）且至少写了一题时才提交。**不提交就不算分**：
        ``highMasteryScore`` 只有提交后才会变。``verify=True`` 会再建一张卷读新
        掌握度，于是 ``nextRound`` 里就有下一轮的 ``examTestId`` —— 重做必然是
        新卷，这是官方行为，不是客户端选择。
        """
        paper = self.create_paper(
            sc_map_id=sc_map_id, course_id=course_id, class_id=class_id,
            knowledge_id=knowledge_id,
        )
        exam_test_id = paper.get("examTestId")
        exam_paper_id = paper.get("paperId") or paper.get("examPaperId")
        if exam_test_id is None or exam_paper_id is None:
            raise ZhsApiError("questions-paper", "DATA_SHAPE_UNEXPECTED", "no exam ids", paper)

        self.open_exam(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id, course_id=course_id)
        status = self.exam_status(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        sheet_before = self.sheet(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        progress_before = parse_sheet_progress(sheet_before)
        questions = [
            self.question(
                exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
                question_id=entry["questionId"], version=entry.get("version", 1),
            )
            for entry in self.iter_sheet_questions(sheet_before)
        ]

        plan: dict[Any, str] = {}
        if answers is not None:
            lookup = {str(key): value for key, value in answers.items()}
            for question in questions:
                key = str(question.get("id"))
                if key in lookup:
                    plan[question.get("id")] = format_answer(
                        lookup[key], question.get("questionType"),
                    )
        if answerer is not None:
            for question in questions:
                if question.get("id") in plan:
                    continue
                picked = answerer(question, progress_before)
                if picked is None or picked is self.SKIP:
                    continue
                plan[question.get("id")] = format_answer(picked, question.get("questionType"))

        saved: list[dict[str, Any]] = []
        if plan:
            saved = self.answer_round(
                exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
                recruit_id=course_id, answers=plan, delay=delay,
                tolerate_errors=tolerate_errors,
            )
        wrote_anything = any(item.get("ok") for item in saved)
        submitted = False
        if submit and wrote_anything:
            submitted = self.submit(
                exam_test_id=exam_test_id, course_id=course_id,
                exam_paper_id=exam_paper_id, knowledge_id=knowledge_id,
            )

        if plan:
            sheet_after = self.sheet(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        else:
            sheet_after = sheet_before
        progress_after = parse_sheet_progress(sheet_after)

        graded: list[dict[str, Any]] = []
        if submitted:
            # submit 没有返回体，判分只能从"再取一次题"里读。
            for entry in self.iter_sheet_questions(sheet_after):
                graded.append(parse_question_result(self.question(
                    exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
                    question_id=entry["questionId"], version=entry.get("version", 1),
                )))
                if delay > 0:
                    time.sleep(delay)

        graded_total = len(graded)
        graded_correct = sum(1 for item in graded if item["isCorrect"])
        result: dict[str, Any] = {
            "masteryBefore": {
                "score": paper.get("masteryScore"),
                "highScore": paper.get("highMasteryScore"),
                "change": paper.get("masteryChange"),
            },
            "examTestId": exam_test_id,
            "examPaperId": exam_paper_id,
            "examType": status.get("examType"),
            "examState": status.get("examState"),
            "limitTime": status.get("limitTime"),
            "questionNum": paper.get("questionNum"),
            "questions": questions,
            "answers": saved,
            "submitted": submitted,
            "roundScore": {
                "correct": graded_correct,
                "total": graded_total,
                "percent": round(graded_correct / graded_total * 100) if graded_total else None,
            },
            "graded": graded,
            "progressBefore": progress_before,
            "progressAfter": progress_after,
            "complete": progress_after.complete,
        }

        if verify and wrote_anything:
            fresh = self.create_paper(
                sc_map_id=sc_map_id, course_id=course_id, class_id=class_id,
                knowledge_id=knowledge_id,
            )
            result["masteryAfter"] = {
                "score": fresh.get("masteryScore"),
                "highScore": fresh.get("highMasteryScore"),
                "change": fresh.get("masteryChange"),
            }
            result["nextRound"] = {
                "examTestId": fresh.get("examTestId"),
                "examPaperId": fresh.get("paperId") or fresh.get("examPaperId"),
                "questionNum": fresh.get("questionNum"),
            }
        return result

    def start_round(
        self, *, sc_map_id: str, course_id: str, class_id: str, knowledge_id: str,
    ) -> dict[str, Any]:
        """Create + open a paper and read its state, progress and questions."""
        paper = self.create_paper(
            sc_map_id=sc_map_id, course_id=course_id, class_id=class_id, knowledge_id=knowledge_id,
        )
        exam_test_id = paper.get("examTestId")
        exam_paper_id = paper.get("paperId") or paper.get("examPaperId")
        if exam_test_id is None or exam_paper_id is None:
            raise ZhsApiError("questions-paper", "DATA_SHAPE_UNEXPECTED", "no exam ids", paper)
        self.open_exam(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id, course_id=course_id)
        status = self.exam_status(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        sheet = self.sheet(exam_test_id=exam_test_id, exam_paper_id=exam_paper_id)
        questions: list[dict[str, Any]] = []
        for entry in self.iter_sheet_questions(sheet):
            questions.append(self.question(
                exam_test_id=exam_test_id, exam_paper_id=exam_paper_id,
                question_id=entry["questionId"], version=entry.get("version", 1),
            ))
        return {
            "mastery": {
                "score": paper.get("masteryScore"),
                "highScore": paper.get("highMasteryScore"),
                "change": paper.get("masteryChange"),
            },
            "examTestId": exam_test_id,
            "examPaperId": exam_paper_id,
            "examType": status.get("examType"),
            "limitTime": status.get("limitTime"),
            "questionNum": paper.get("questionNum"),
            "status": status,
            "sheet": sheet,
            "progress": parse_sheet_progress(sheet),
            "questions": questions,
        }

    @staticmethod
    def iter_sheet_questions(sheet: Mapping[str, Any]) -> Iterable[dict[str, Any]]:
        for part in sheet.get("partSheetVos") or []:
            if not isinstance(part, dict):
                continue
            for entry in part.get("questionSheetVos") or []:
                if isinstance(entry, dict) and entry.get("questionId") is not None:
                    yield entry

    def _uuid(self) -> str:
        """``uuid`` from the CASLOGC cookie; the page keeps it in the token store."""
        raw = self.session.cookies.get("CASLOGC")
        if raw:
            try:
                import urllib.parse

                data = json.loads(urllib.parse.unquote(raw))
                if isinstance(data, dict) and isinstance(data.get("uuid"), str):
                    return data["uuid"]
            except (ValueError, TypeError):
                pass
        return ""
