"""学习通任务卡解析：统一 mArg 提取与附件字段归一化。

背景（代码审计 P1）：adapter 里两处用了不同的解析方法——
  list_chapter_tasks 用花括号平衡扫描；
  list_video_tasks 用 r"\\bmArg\\s*=\\s*(\\{.*?\\})\\s*;" 浅正则。
后者遇到嵌套对象、字符串里的 '}' 或转义引号会提前截断，导致真实视频任务
被静默丢弃。本模块提供单一实现，两处共用。

字段命名兼容上游 Samueli924/chaoxing（GPL-3.0）api/base.py 的 job 字典：
  objectId / objectid / prop.objectid、jobid / prop.jobid、
  otherInfo、playTime(毫秒)、property.rt、videoFaceCaptureEnc、attDurationEnc。

本模块只做解析，不发任何网络请求，也不接触凭据。
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterator

_MARG_ASSIGNMENT = re.compile(r"\bmArg\s*=\s*")
_VIDEO_KINDS = frozenset({"video", "audio"})


def extract_marg_payload(text: str) -> dict[str, Any] | None:
    """从页面里提取 mArg 指向的完整 JSON 对象。

    用花括号深度扫描，正确处理：
      * 嵌套对象 / 数组
      * 字符串字面量内的 '}' 与转义引号
      * mArg = {...}; / var mArg = {...} / window.mArg = {...}
      * 部分页面把 JSON 放在引号里：mArg = "{...}"
    扫描失败返回 None，由调用方跳过该卡片页，不抛异常、不吞掉其他页。
    """
    if not isinstance(text, str):
        return None
    for match in _MARG_ASSIGNMENT.finditer(text):
        payload = _scan_object(text, match.end())
        if payload is None:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _scan_object(text: str, start: int) -> Any:
    """从 start 起扫描一个完整 JSON 值（对象或字符串化的对象）。"""
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text):
        return None
    if text[start] == '"' or text[start] == "'":
        string_value = _scan_string(text, start)
        if string_value is None:
            return None
        try:
            return json.loads(string_value)
        except (ValueError, TypeError):
            return None
    if text[start] != "{":
        return None

    depth = 0
    quote_char = ""
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote_char:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = ""
            continue
        if char in ('"', "'"):
            quote_char = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                raw = text[start:index + 1]
                try:
                    return json.loads(raw)
                except (ValueError, TypeError):
                    # 页面里偶有单引号键；只做一次宽松回退，不引入 eval
                    try:
                        return json.loads(raw.replace("'", '"'))
                    except (ValueError, TypeError):
                        return None
    return None


def _scan_string(text: str, start: int) -> str | None:
    quote = text[start]
    escaped = False
    for index in range(start + 1, len(text)):
        char = text[index]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == quote:
            return text[start + 1:index]
    return None


def iter_attachments(payload: dict[str, Any] | None) -> Iterator[dict[str, Any]]:
    """兼容 attachments 直接挂在根对象，或藏在 defaults / mArg 子对象里。"""
    if not isinstance(payload, dict):
        return
    sources = [payload]
    for key in ("defaults", "mArg", "data"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            sources.append(nested)
    seen: set[int] = set()
    for source in sources:
        cards = source.get("attachments")
        if not isinstance(cards, list):
            continue
        for card in cards:
            if isinstance(card, dict) and id(card) not in seen:
                seen.add(id(card))
                yield card


def normalize_card_fields(card: dict[str, Any]) -> dict[str, Any]:
    """把不同版本任务卡的字段归一到一套名字，避免真实任务被漏掉。"""
    prop = card.get("property")
    if not isinstance(prop, dict):
        prop = {}

    def first(*values: Any) -> str:
        for value in values:
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    kind = first(card.get("type"), prop.get("type")).lower()
    object_id = first(
        card.get("objectId"), card.get("objectid"),
        prop.get("objectId"), prop.get("objectid"),
    )
    job_id = first(card.get("jobid"), card.get("jobId"), prop.get("jobid"), prop.get("jobId"))
    raw_play_time = card.get("playTime", prop.get("playTime", 0))
    try:
        play_time_ms = max(0, int(float(raw_play_time)))
    except (TypeError, ValueError):
        play_time_ms = 0
    # 部分页面直接给秒，按量级自适应，避免 1000 倍误差
    if 0 < play_time_ms < 60 and isinstance(raw_play_time, float):
        play_time_ms *= 1000
    try:
        rt = float(prop.get("rt") or card.get("rt") or 0.9)
    except (TypeError, ValueError):
        rt = 0.9

    return {
        "type": kind,
        "is_media": kind in _VIDEO_KINDS,
        "passed": card.get("isPassed") is True or prop.get("isPassed") is True,
        "object_id": object_id[:160],
        "job_id": job_id[:160],
        "title": first(prop.get("name"), prop.get("title"), card.get("name"), kind)[:180],
        "other_info": first(card.get("otherInfo"), prop.get("otherInfo")).split("&")[0][:250],
        "play_time_ms": play_time_ms,
        "rt": rt,
        "face_enc": first(card.get("videoFaceCaptureEnc"), prop.get("videoFaceCaptureEnc"))[:500],
        "att_duration_enc": first(card.get("attDurationEnc"), prop.get("attDurationEnc"))[:500],
    }


def iter_media_cards(payload: dict[str, Any] | None) -> Iterator[dict[str, Any]]:
    """产出未完成的视频/音频任务卡（已归一化）。"""
    for card in iter_attachments(payload):
        normalized = normalize_card_fields(card)
        if not normalized["is_media"] or normalized["passed"]:
            continue
        if not normalized["object_id"] or not normalized["job_id"]:
            continue
        yield normalized
