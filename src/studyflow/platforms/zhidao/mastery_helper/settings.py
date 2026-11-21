"""StudyFlow integration settings. Upstream selectors stay intact; secrets use DPAPI."""
from __future__ import annotations
import copy
import json
from pathlib import Path
from urllib.parse import urlparse
from . import mastery as m
from .private_state import PrivateStore

DEFAULTS = json.loads("{\n  \"configured\": true,\n  \"url\": \"https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/ai-course-center\",\n  \"frame_url_contains\": \"\",\n  \"model\": \"deepseek-flash\",\n  \"target\": 90,\n  \"max_rounds\": 10,\n  \"max_api_calls\": 100,\n  \"max_minutes\": 60,\n  \"timeout_seconds\": 45,\n  \"result_settle_seconds\": 1.0,\n  \"zero_score_grace_seconds\": 8.0,\n  \"refresh_zero_result\": true,\n  \"action_delay_seconds\": 0.7,\n  \"min_confidence\": 0.6,\n  \"low_confidence_action\": \"continue\",\n  \"keep_browser_on_error\": true,\n  \"auto_next\": true,\n  \"next_scope\": \"course\",\n  \"browser\": \"msedge\",\n  \"selectors\": {\n    \"question\": \".questionContent\",\n    \"stem\": \".questionName .centent-pre\",\n    \"type\": \".questionTitle .letterSortNum\",\n    \"option\": \".radio-view > li, .checkbox-view > li, .checkbox-view > label.el-checkbox\",\n    \"option_text\": \".stem, .el-checkbox__label .preStyle\",\n    \"selected\": \".checkedIcon, input:checked, .is-checked, [aria-checked='true']\",\n    \"answer_input\": \"textarea, input[type='text']\",\n    \"next\": \".pre-next .next-topic:not(.noNext)\",\n    \"submit\": \".right-H .reviewDone\",\n    \"confirm\": \"\",\n    \"result\": \".line1-left\",\n    \"mastery\": \".charts-label-rate\",\n    \"result_total\": \".line1-count-total:first-child .line1-count-total-num\",\n    \"review\": \".line1-count-link\",\n    \"review_root\": \".exam-preview\",\n    \"review_question\": \".question-item\",\n    \"review_stem\": \".quest-title .option-name\",\n    \"review_type\": \".quest-type\",\n    \"review_option\": \".el-radio, .el-checkbox\",\n    \"review_option_text\": \".preStyle\",\n    \"correct_answer\": \".analysis .answer-title\",\n    \"correct_marker\": \".question-result:has-text(\\\"回答正确\\\")\",\n    \"wrong_marker\": \".question-result:has-text(\\\"回答错误\\\")\",\n    \"review_next\": \"\",\n    \"review_close\": \"\",\n    \"retry\": \".exam-preview .submit\"\n  }\n}\n")
DEFAULTS["target"] = 100
DEFAULTS["max_rounds"] = 20
ROOT = m.ROOT
PROFILE = ROOT / "profile.json"
DATA = ROOT / "data"
EDITABLE = ("target", "max_rounds", "max_api_calls", "max_minutes", "auto_next", "next_scope", "browser")
OFFICIAL_HOSTS = ("zhihuishu.com", "polymas.com")


def valid_official_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme == "https" and (any(parsed.hostname == h or (parsed.hostname or "").endswith("." + h) for h in OFFICIAL_HOSTS))
    except (TypeError, ValueError):
        return False


def load_config() -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    if PROFILE.exists():
        try:
            stored = json.loads(PROFILE.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            raise ValueError("掌握度本地设置损坏") from exc
        if not isinstance(stored, dict):
            raise ValueError("掌握度设置格式不正确")
        for key in EDITABLE:
            if key in stored:
                cfg[key] = stored[key]
        if isinstance(stored.get("last_work_url"), str) and valid_official_url(stored["last_work_url"]):
            cfg["last_work_url"] = stored["last_work_url"]
    cfg["configured"] = True
    m.validate_config(cfg)
    return cfg


def public_settings() -> dict:
    cfg = load_config()
    return {**{k: cfg[k] for k in EDITABLE}, "has_api_key": bool(PrivateStore(DATA).load_key()),
            "has_saved_entry": bool(cfg.get("last_work_url"))}


def save_settings(values: dict) -> dict:
    if not isinstance(values, dict) or any(k not in (*EDITABLE, "api_key", "entry_url") for k in values):
        raise ValueError("掌握度设置字段无效")
    cfg = load_config()
    for key in EDITABLE:
        if key in values:
            cfg[key] = values[key]
    if isinstance(cfg["target"], bool) or type(cfg["target"]) not in (int, float) or not 1 <= cfg["target"] <= 100:
        raise ValueError("目标掌握度必须在 1–100 范围内")
    for key, upper in (("max_rounds", 30), ("max_api_calls", 1000), ("max_minutes", 240)):
        if type(cfg[key]) is not int or not 1 <= cfg[key] <= upper:
            raise ValueError("轮数、请求数或时长超出限制")
    if type(cfg["auto_next"]) is not bool or cfg["next_scope"] not in ("course", "chapter"):
        raise ValueError("范围设置无效")
    if cfg["browser"] not in ("msedge", "chrome"):
        raise ValueError("浏览器设置无效")
    if "entry_url" in values:
        url = values["entry_url"]
        if not isinstance(url, str) or len(url) > 2048 or (url and not valid_official_url(url)):
            raise ValueError("必须使用知到或智慧树的 HTTPS 练习链接")
        cfg["last_work_url"] = url
    m.validate_config(cfg)
    ROOT.mkdir(parents=True, exist_ok=True)
    temporary = PROFILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({k: cfg[k] for k in (*EDITABLE, "last_work_url") if k in cfg},
                                    ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(PROFILE)
    if "api_key" in values:
        key = values["api_key"]
        if not isinstance(key, str) or len(key) > 256:
            raise ValueError("AI API Key 格式无效")
        if key.strip():
            PrivateStore(DATA).save_key(key.strip())
    return public_settings()


def save_work_url(url: str):
    if not isinstance(url, str) or not valid_official_url(url):
        return
    cfg = load_config()
    cfg["last_work_url"] = url
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = PROFILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({k: cfg[k] for k in (*EDITABLE, "last_work_url") if k in cfg}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(PROFILE)
