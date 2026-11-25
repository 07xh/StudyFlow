"""Versioned JSON-lines local IPC for the packaged Tauri sidecar.

Errors have fixed public codes. Private credentials, raw server payloads and
identifiers never appear in logs or error output.
"""
from __future__ import annotations

import atexit
import json
import sys
from datetime import datetime, timezone
from contextlib import redirect_stdout
from typing import Any

from studyflow.platforms.zhidao.adapter import ZhidaoAdapter
from studyflow.platforms.zhidao.zhs_knowledge_detail import read_knowledge_detail as read_zhs_knowledge_detail
from studyflow.platforms.zhidao.zhs_settings import read_settings as read_zhs_settings, save_settings as save_zhs_settings
from studyflow.platforms.zhidao import qr_runtime
from studyflow.platforms.zhidao.cookie_import import import_cookie
from studyflow.platforms.zhidao.legacy_runtime import (
    refresh_progress as refresh_zhidao_progress, verify_course as verify_zhidao_course,
    diagnose_server as diagnose_zhidao_server,
    clear_session as clear_zhidao_session, clear_course_cache as clear_zhidao_course_cache,
    read_document as read_zhidao_document,
    read_course_detail as read_zhidao_course_detail,
    consent_status as get_consent_status, accept_consent as accept_studyflow_consent,
)

# Best-effort cleanup when the persistent JSONL process reaches normal EOF.
atexit.register(qr_runtime.cancel)
from studyflow.platforms.xuexitong.adapter import XuexitongAdapter
from studyflow.platforms.xuexitong import credentials as xuexitong_credentials
from studyflow.platforms.xuexitong import settings as xuexitong_settings
from studyflow.services.xuexitong_heartbeat_bridge import dispatch as xuexitong_heartbeat_dispatch
from studyflow.services.ucampus_socket_diagnostics import diagnose_legacy_socket
from studyflow.services import ucampus_fabricated_bridge
from studyflow.services.ucampus_fabricated_bridge import dispatch as ucampus_fabricated_dispatch
from studyflow.services import xuexitong_heartbeat_bridge
from studyflow.platforms.yuketang.adapter import YuketangAdapter
from studyflow.platforms.ucampus.adapter import UCampusAdapter, UCampusCatalogError
from studyflow.platforms.ucampus.course_progress import UCampusProgressReader, UCampusProgressError
from studyflow.platforms.ucampus import credentials as ucampus_credentials
from studyflow.platforms.ucampus import readonly_monitor as ucampus_monitor
from studyflow.platforms.ucampus.sso_login import (authenticate as ucampus_authenticate,
    enrich_school_from_account as ucampus_enrich_school, UCampusLoginError)
from studyflow.platforms.yuketang import credentials
from studyflow.services.yuketang_progress import RUN_ID, read_session_progress
from studyflow.services import update_manager
from studyflow.platforms.yuketang.legacy_config import read_settings as get_original_ykt_settings, save_settings as save_original_ykt_settings

MAX_LINE = 600000
ADAPTERS = {"zhidao": ZhidaoAdapter(), "yuketang": YuketangAdapter(),
            "xuexitong": XuexitongAdapter(), "ucampus": UCampusAdapter()}


def _clear_ucampus_monitor_safely() -> bool:
    """After changing login, protect the account even if its old checkpoint is locked.

    The stored checkpoint has an account fingerprint, so a failed delete is
    fail-closed. Surface a warning separately; never call successful login
    "credential save failed" merely because checkpoint cleanup failed.
    """
    try:
        ucampus_monitor.configure(None, None, False)
        return True
    except Exception:
        return False


def _course_payload(course):
    payload = {
        "platform": course.platform.value, "course_id": course.course_id, "title": course.title,
        "progress_percent": course.progress_percent, "course_type": course.course_type,
        "stale": course.stale, "progress_evidence": course.progress_evidence,
        "verified_at": course.verified_at,
    }
    # Optional marker is exposed only when provided by a verified account adapter.
    if course.session_marker is not None:
        payload["session_marker"] = course.session_marker
    if course.progress_metric is not None:
        payload["progress_metric"] = course.progress_metric
    return payload


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    if not isinstance(request_id, str) or not 0 < len(request_id) <= 128:
        return {"id": None, "ok": False, "error": "INVALID_REQUEST"}
    if request.get("version") != 1:
        return {"id": request_id, "ok": False, "error": "UNSUPPORTED_VERSION"}
    operation = request.get("operation")
    if operation in ("updates.settings.get", "updates.settings.save", "updates.check", "updates.download", "updates.changelog", "updates.latest", "updates.sources"):
        try:
            if operation == "updates.latest":
                data = update_manager.latest()
            elif operation == "updates.sources":
                data = update_manager.sources()
            elif operation == "updates.settings.get":
                data = update_manager.preferences()
            elif operation == "updates.settings.save":
                data = update_manager.save_preferences(request.get("settings"))
            elif operation == "updates.check":
                data = update_manager.check(request.get("current_version"))
            elif operation == "updates.changelog":
                data = update_manager.changelog(request.get("current_version"),
                                                request.get("previous_version"),
                                                request.get("history"))
            else:
                data = update_manager.download(request.get("current_version"), request.get("release_version"))
            return {"id": request_id, "ok": True, "data": data}
        except update_manager.updater.UpdateError as exc:
            return {"id": request_id, "ok": False, "error": exc.code}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_UPDATE_SETTINGS"}
        except OSError:
            return {"id": request_id, "ok": False, "error": "UPDATE_STORAGE_FAILED"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UPDATE_FAILED"}
    heartbeat = xuexitong_heartbeat_dispatch(operation, request)
    if heartbeat is not None:
        if heartbeat.get("ok") is True:
            return {"id": request_id, "ok": True, "data": heartbeat}
        return {"id": request_id, "ok": False,
                "error": str(heartbeat.get("error") or "XUEXITONG_INTERNAL_ERROR")}
    uc_fabricated = ucampus_fabricated_dispatch(operation, request)
    if uc_fabricated is not None:
        if uc_fabricated.get("ok") is True:
            return {"id": request_id, "ok": True, "data": uc_fabricated}
        return {"id": request_id, "ok": False,
                "error": str(uc_fabricated.get("error") or "UCAMPUS_RUNTIME_UNAVAILABLE")}
    if operation == "ucampus.socket.diagnose":
        socket_status = diagnose_legacy_socket()
        if socket_status.get("ok") is True:
            return {"id": request_id, "ok": True, "data": socket_status}
        return {"id": request_id, "ok": False,
                "error": str(socket_status.get("error") or "UCAMPUS_SOCKET_TRANSPORT_UNKNOWN")}
    if operation in ("questionbank.providers", "questionbank.tokens.list",
                     "questionbank.tokens.add", "questionbank.tokens.select",
                     "questionbank.tokens.remove", "questionbank.tokens.import",
                     "questionbank.tokens.rotation", "questionbank.tokens.check", "questionbank.query"):
        from studyflow.services import question_bank as bank
        try:
            if operation in ("questionbank.providers", "questionbank.tokens.list"):
                data = bank.list_tokens()
            elif operation == "questionbank.tokens.add":
                data = bank.add_token(request.get("provider_id"),
                                      request.get("label"), request.get("token"))
            elif operation == "questionbank.tokens.import":
                data = bank.import_tokens(request.get("provider_id"), request.get("lines"))
            elif operation == "questionbank.tokens.rotation":
                data = bank.set_rotation(request.get("provider_id"), request.get("mode"))
            elif operation == "questionbank.tokens.check":
                data = bank.check_token(request.get("token_id"), request.get("include_quota", False))
            elif operation == "questionbank.tokens.select":
                data = bank.select_token(request.get("token_id"))
            elif operation == "questionbank.tokens.remove":
                data = bank.remove_token(request.get("token_id"))
            else:
                data = bank.query_question(request.get("provider_id"),
                                           request.get("question"),
                                           request.get("token_id"))
            return {"id": request_id, "ok": True, "data": data}
        except bank.QuestionBankError as exc:
            return {"id": request_id, "ok": False, "error": exc.code}
        except Exception:
            # No question content, upstream request URL or token in errors.
            return {"id": request_id, "ok": False, "error": "QUESTIONBANK_UNAVAILABLE"}
    if operation == "ping":
        return {"id": request_id, "ok": True, "data": {"version": 1, "service": "studyflow"}}
    if operation in ("zhidao.qr.start", "zhidao.qr.status", "zhidao.qr.cancel"):
        try:
            if operation == "zhidao.qr.start":
                data = qr_runtime.start()
            elif operation == "zhidao.qr.cancel":
                data = qr_runtime.cancel()
            else:
                data = qr_runtime.status()
            return {"id": request_id, "ok": True, "data": data}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_QR_UNAVAILABLE"}
    if operation == "zhidao.cookie.import":
        try:
            data = import_cookie(request.get("content"), request.get("mode"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_COOKIE_IMPORT"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "COOKIE_IMPORT_FAILED"}
    if operation == "platform.status":
        result = []
        for name, adapter in ADAPTERS.items():
            try:
                info = adapter.connection_info()
                result.append({"platform": name, "connected": info.connected, "message": info.message})
            except Exception:
                result.append({"platform": name, "connected": False, "message": "平台状态检测失败"})
        return {"id": request_id, "ok": True, "data": result}
    if operation == "courses.list":
        platform = request.get("platform")
        if not isinstance(platform, str) or platform not in ADAPTERS:
            return {"id": request_id, "ok": False, "error": "UNKNOWN_PLATFORM"}
        try:
            courses = ADAPTERS[platform].list_courses()
        except UCampusCatalogError as exc:
            # Keep only stable diagnostics; never return arbitrary exception text.
            allowed = {"UCAMPUS_SESSION_MISSING", "UCAMPUS_SESSION_EXPIRED",
                       "UCAMPUS_CATALOG_UNAVAILABLE", "UCAMPUS_CATALOG_FORMAT_UNVERIFIED"}
            code = str(exc) if platform == "ucampus" and str(exc) in allowed else "PLATFORM_NOT_READY"
            return {"id": request_id, "ok": False, "error": code}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
        return {"id": request_id, "ok": True, "data": [_course_payload(c) for c in courses]}
    if operation == "ucampus.progress.verify":
        course_id = request.get("course_id")
        unit_id = request.get("unit_id")
        if (not isinstance(course_id, str) or not 1 <= len(course_id) <= 128
                or not isinstance(unit_id, str) or not 1 <= len(unit_id) <= 128):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            rows = UCampusProgressReader().list_tasks(course_id, unit_id)
            data = {
                "course_id": course_id, "unit_id": unit_id,
                "verified_at": datetime.now(timezone.utc).isoformat(),
                "total": len(rows),
                "passed": sum(row.get("completed") is True for row in rows),
                "not_passed": sum(row.get("completed") is False for row in rows),
                "unknown": sum(row.get("completed") is None for row in rows),
                "required_total": sum(row.get("required") is True for row in rows),
                "required_passed": sum(row.get("required") is True
                                       and row.get("completed") is True for row in rows),
                "tasks": [{"id": row["id"], "type": row.get("type", "unknown"),
                           "required": row.get("required"),
                           "completed": row.get("completed")} for row in rows],
            }
            return {"id": request_id, "ok": True, "data": data}
        except UCampusProgressError as exc:
            return {"id": request_id, "ok": False, "error": str(exc)}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_PROGRESS_UNAVAILABLE"}
    if operation in ("ucampus.units.list", "ucampus.unit.tasks"):
        course_id = request.get("course_id")
        unit_id = request.get("unit_id")
        if (not isinstance(course_id, str) or not 1 <= len(course_id) <= 128
                or (operation == "ucampus.unit.tasks"
                    and (not isinstance(unit_id, str) or not 1 <= len(unit_id) <= 128))):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            reader = UCampusProgressReader()
            if operation == "ucampus.units.list":
                data = reader.list_units(course_id)
            else:
                data = reader.list_tasks(course_id, unit_id)
            return {"id": request_id, "ok": True, "data": data}
        except UCampusProgressError as exc:
            return {"id": request_id, "ok": False, "error": str(exc)}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_PROGRESS_UNAVAILABLE"}
    if operation in ("ucampus.monitor.status", "ucampus.monitor.tick", "ucampus.monitor.configure"):
        try:
            if operation == "ucampus.monitor.status":
                data = ucampus_monitor.status()
            elif operation == "ucampus.monitor.tick":
                data = ucampus_monitor.tick()
            else:
                data = ucampus_monitor.configure(
                    request.get("course_id"), request.get("unit_id"),
                    request.get("enabled"))
            return {"id": request_id, "ok": True, "data": data}
        except ucampus_monitor.UCampusMonitorError as exc:
            allowed = {"INVALID_REQUEST", "UCAMPUS_SESSION_MISSING",
                       "UCAMPUS_MONITOR_STORAGE_FAILED"}
            code = str(exc)
            return {"id": request_id, "ok": False,
                    "error": code if code in allowed else "UCAMPUS_MONITOR_UNAVAILABLE"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_MONITOR_UNAVAILABLE"}
    if operation == "ucampus.session.info":
        try:
            return {"id": request_id, "ok": True, "data": ucampus_credentials.status()}
        except ucampus_credentials.SessionStorageError:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_CREDENTIAL_STORAGE_FAILED"}
    if operation == "ucampus.session.login":
        try:
            # The username/password only live inside this one request. Persist
            # exclusively the returned provider JWT, never either plaintext field.
            config = ucampus_authenticate(request.get("username"), request.get("password"))
            config = ucampus_enrich_school(config)
        except UCampusLoginError as exc:
            allowed = {"INVALID_UCAMPUS_LOGIN", "UCAMPUS_LOGIN_UNAVAILABLE",
                       "UCAMPUS_LOGIN_REJECTED", "UCAMPUS_LOGIN_FORMAT_UNVERIFIED",
                       "UCAMPUS_LOGIN_VERIFICATION_REQUIRED", "UCAMPUS_LOGIN_RATE_LIMITED"}
            code = str(exc)
            return {"id": request_id, "ok": False,
                    "error": code if code in allowed else "UCAMPUS_LOGIN_UNAVAILABLE"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_LOGIN_UNAVAILABLE"}
        try:
            ucampus_fabricated_bridge.reset_runner()
            ucampus_credentials.save(config.__dict__)
            monitor_reset = _clear_ucampus_monitor_safely()
            return {"id": request_id, "ok": True, "data": {
                "saved": True, "variant": "ai", "monitor_reset": monitor_reset}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_CREDENTIAL_STORAGE_FAILED"}
    if operation == "ucampus.session.configure":
        try:
            # Official WebView and manual Cookie imports must receive the same
            # account-school enrichment already used by direct SSO login.
            # Never replace a valid user session if that optional GET fails.
            config = ucampus_credentials.UCampusConfig.from_dict(request.get("configuration"))
            try:
                config = ucampus_enrich_school(config)
            except Exception:
                pass
            ucampus_fabricated_bridge.reset_runner()
            ucampus_credentials.save(config.__dict__)
            monitor_reset = _clear_ucampus_monitor_safely()
            return {"id": request_id, "ok": True, "data": {
                "saved": True, "monitor_reset": monitor_reset}}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_UCAMPUS_CONFIG"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_CREDENTIAL_STORAGE_FAILED"}
    if operation == "ucampus.session.clear":
        try:
            ucampus_fabricated_bridge.reset_runner()
            ucampus_credentials.clear()
            monitor_reset = _clear_ucampus_monitor_safely()
            return {"id": request_id, "ok": True, "data": {
                "cleared": True, "monitor_reset": monitor_reset}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "UCAMPUS_CREDENTIAL_STORAGE_FAILED"}
    if operation == "xuexitong.settings.get":
        try:
            return {"id": request_id, "ok": True, "data": xuexitong_settings.read()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "XUEXITONG_SETTINGS_UNAVAILABLE"}
    if operation == "xuexitong.settings.save":
        try:
            data = xuexitong_settings.save(request.get("settings"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_XUEXITONG_SETTINGS"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "XUEXITONG_SETTINGS_UNAVAILABLE"}
    if operation == "xuexitong.chapter.tasks":
        course_key = request.get("course_id")
        chapter_id = request.get("chapter_id")
        if (not isinstance(course_key, str) or len(course_key) > 96
                or not isinstance(chapter_id, str) or not 1 <= len(chapter_id) <= 24):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            data = ADAPTERS["xuexitong"].list_chapter_tasks(course_key, chapter_id)
            return {"id": request_id, "ok": True, "data": data}
        except (ValueError, TypeError):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except LookupError:
            return {"id": request_id, "ok": False, "error": "COURSE_NOT_FOUND"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation == "xuexitong.session.configure":
        if not xuexitong_heartbeat_bridge.reset_for_credentials_change():
            return {"id": request_id, "ok": False, "error": "XUEXITONG_TASK_STOP_TIMEOUT"}
        try:
            xuexitong_credentials.save(request.get("cookie"))
            return {"id": request_id, "ok": True, "data": {"saved": True}}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_XUEXITONG_COOKIE"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "XUEXITONG_CREDENTIAL_STORAGE_FAILED"}
    if operation == "xuexitong.session.clear":
        if not xuexitong_heartbeat_bridge.reset_for_credentials_change():
            return {"id": request_id, "ok": False, "error": "XUEXITONG_TASK_STOP_TIMEOUT"}
        try:
            xuexitong_credentials.clear()
            return {"id": request_id, "ok": True, "data": {"cleared": True}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "XUEXITONG_CREDENTIAL_STORAGE_FAILED"}
    if operation == "xuexitong.chapters.list":
        course_key = request.get("course_id")
        if not isinstance(course_key, str) or len(course_key) > 96:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            return {"id": request_id, "ok": True,
                    "data": ADAPTERS["xuexitong"].list_chapters(course_key)}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation in ("zhidao.progress.sync", "zhidao.progress.verify"):
        try:
            if operation == "zhidao.progress.sync":
                snapshot = refresh_zhidao_progress()
            else:
                course_key = request.get("course_key")
                if not isinstance(course_key, str) or len(course_key) != 64:
                    return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
                snapshot = verify_zhidao_course(course_key)
            return {"id": request_id, "ok": True, "data": {
                "courses": [_course_payload(c) for c in snapshot["courses"]],
                "incomplete": snapshot["incomplete"],
                "fetched_at": snapshot["fetched_at"],
            }}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except RuntimeError as exc:
            error = "COURSE_NOT_FOUND" if str(exc) == "COURSE_NOT_FOUND" else "ZHIDAO_PROGRESS_FAILED"
            return {"id": request_id, "ok": False, "error": error}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_PROGRESS_FAILED"}
    if operation == "zhidao.course.detail":
        try:
            data = read_zhidao_course_detail(request.get("course_key"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except RuntimeError as exc:
            error = "COURSE_NOT_FOUND" if str(exc) == "COURSE_NOT_FOUND" else "PLATFORM_NOT_READY"
            return {"id": request_id, "ok": False, "error": error}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation == "studyflow.consent.status":
        try:
            return {"id": request_id, "ok": True, "data": get_consent_status()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CONSENT_STORAGE_FAILED"}
    if operation == "studyflow.consent.accept":
        try:
            return {"id": request_id, "ok": True, "data": accept_studyflow_consent()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CONSENT_STORAGE_FAILED"}
    if operation == "zhidao.zhs.knowledge.detail":
        knowledge_id = request.get("knowledge_id")
        course_key = request.get("course_key")
        # Frontend knowledge IDs are decimal strings: 19-digit platform
        # values must never round-trip through a JavaScript number.
        if (not isinstance(knowledge_id, str) or not knowledge_id.isascii()
                or not knowledge_id.isdecimal() or not 1 <= len(knowledge_id) <= 19
                or knowledge_id[0] == "0"
                or int(knowledge_id) > 2**63 - 1
                or not isinstance(course_key, str) or len(course_key) != 64):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            return {"id": request_id, "ok": True,
                    "data": read_zhs_knowledge_detail(course_key, int(knowledge_id))}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except RuntimeError as exc:
            error = ("KNOWLEDGE_NOT_FOUND" if str(exc) == "KNOWLEDGE_NOT_FOUND"
                     else "ZHS_DETAIL_UNAVAILABLE")
            return {"id": request_id, "ok": False, "error": error}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHS_DETAIL_UNAVAILABLE"}
    if operation.startswith("zhidao.mastery."):
        from studyflow.platforms.zhidao import zhs_mastery_service as mastery

        course_key = request.get("course_key")
        knowledge_id = request.get("knowledge_id")
        kid = knowledge_id if isinstance(knowledge_id, str) else str(knowledge_id or "")
        try:
            # The background worker uses the service directly. Prevent a
            # concurrent manual write from overwriting its in-flight paper.
            if operation in {
                "zhidao.mastery.round.start", "zhidao.mastery.round.answer",
                "zhidao.mastery.round.submit", "zhidao.mastery.round.discard",
            }:
                from studyflow.platforms.zhidao import zhs_mastery_auto as mastery_auto
                active = mastery_auto.status(course_key)
                if active.get("state") in {"starting", "running", "paused", "stopping"}:
                    raise mastery.MasteryError("MASTERY_AUTO_RUNNING")
            if operation == "zhidao.mastery.auto.start":
                from studyflow.platforms.zhidao import zhs_mastery_auto as mastery_auto
                data = mastery_auto.start(course_key, request.get("settings"))
            elif operation == "zhidao.mastery.auto.status":
                from studyflow.platforms.zhidao import zhs_mastery_auto as mastery_auto
                data = mastery_auto.status(course_key)
            elif operation == "zhidao.mastery.auto.control":
                from studyflow.platforms.zhidao import zhs_mastery_auto as mastery_auto
                data = mastery_auto.control(course_key, request.get("action"))
            elif operation == "zhidao.mastery.catalog":
                data = mastery.read_catalog(
                    course_key,
                    with_mastery=request.get("with_mastery") is not False,
                    force_refresh=request.get("force_refresh") is True,
                )
            elif operation == "zhidao.mastery.round.active":
                data = mastery.active_round(course_key, kid)
            elif operation == "zhidao.mastery.round.start":
                data = mastery.start_round(course_key, kid)
            elif operation == "zhidao.mastery.round.answer":
                data = mastery.save_answer(course_key, kid, request.get("question_id"), request.get("answer"))
            elif operation == "zhidao.mastery.round.submit":
                data = mastery.submit_round(course_key, kid)
            elif operation == "zhidao.mastery.round.discard":
                data = mastery.discard_round(course_key, kid)
            elif operation == "zhidao.mastery.wrong":
                data = mastery.read_wrong_questions(course_key, kid, request.get("exam_test_id"))
            else:
                return {"id": request_id, "ok": False, "error": "UNKNOWN_OPERATION"}
            return {"id": request_id, "ok": True, "data": data}
        except mastery.MasteryError as error:
            return {"id": request_id, "ok": False, "error": error.code}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHS_MASTERY_UNAVAILABLE"}
    if operation == "zhidao.zhs.settings.get":
        try:
            return {"id": request_id, "ok": True, "data": read_zhs_settings(request.get("course_key"))}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHS_SETTINGS_UNAVAILABLE"}
    if operation == "zhidao.zhs.settings.save":
        try:
            return {"id": request_id, "ok": True, "data": save_zhs_settings(request.get("settings"), request.get("course_key"))}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_ZHS_SETTINGS"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHS_SETTINGS_UNAVAILABLE"}
    if operation == "zhidao.diagnose":
        try:
            return {"id": request_id, "ok": True, "data": diagnose_zhidao_server()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_DIAGNOSE_FAILED"}
    if operation == "zhidao.session.clear":
        try:
            qr_runtime.cancel()
            return {"id": request_id, "ok": True, "data": clear_zhidao_session()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_DATA_CLEAR_FAILED"}
    if operation == "zhidao.cache.clear":
        try:
            return {"id": request_id, "ok": True, "data": clear_zhidao_course_cache()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_DATA_CLEAR_FAILED"}
    if operation == "zhidao.document.read":
        try:
            return {"id": request_id, "ok": True, "data": read_zhidao_document(request.get("document_id"))}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_DOCUMENT"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "DOCUMENT_UNAVAILABLE"}
    if operation == "yuketang.course.detail":
        course_id = request.get("course_id")
        offset, limit = request.get("offset", 0), request.get("limit", 8)
        if (not isinstance(course_id, str) or not course_id.isascii()
                or not course_id.isdecimal() or not 1 <= len(course_id) <= 24
                or type(offset) is not int or not 0 <= offset <= 5000
                or type(limit) is not int or not 1 <= limit <= 12):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            data = ADAPTERS["yuketang"].course_progress(course_id, offset=offset, limit=limit)
            return {"id": request_id, "ok": True, "data": data}
        except LookupError:
            return {"id": request_id, "ok": False, "error": "COURSE_NOT_FOUND"}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation == "videos.list":
        if request.get("platform") != "yuketang":
            return {"id": request_id, "ok": False, "error": "UNKNOWN_PLATFORM"}
        course_id = request.get("course_id")
        if course_id is not None and (
            not isinstance(course_id, str) or not course_id.isdecimal()
            or not 1 <= len(course_id) <= 24
        ):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        try:
            adapter = ADAPTERS["yuketang"]
            videos = adapter.list_videos(course_id=course_id) if course_id is not None else adapter.list_videos()
            return {"id": request_id, "ok": True, "data": videos}
        except LookupError:
            return {"id": request_id, "ok": False, "error": "COURSE_NOT_FOUND"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation == "yuketang.settings.get":
        try:
            return {"id": request_id, "ok": True, "data": get_original_ykt_settings()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "YUKETANG_SETTINGS_UNAVAILABLE"}
    if operation == "yuketang.settings.save":
        try:
            data = save_original_ykt_settings(request.get("settings"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_YUKETANG_SETTINGS"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "YUKETANG_SETTINGS_UNAVAILABLE"}
    if operation == "yuketang.progress":
        run_id = request.get("run_id")
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        # Local, read-only snapshot of this run\u2019s existing original log.
        # Never return log lines, credentials, video IDs or raw server data.
        try:
            progress = read_session_progress(run_id)
        except (OSError, ValueError):
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
        return {"id": request_id, "ok": True, "data": progress}
    if operation == "yuketang.session.marker":
        try:
            marker = credentials.recovery_marker(credentials.load())
            if marker is None:
                return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
            return {"id": request_id, "ok": True, "data": {"marker": marker}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    if operation == "yuketang.scope.get":
        try:
            return {"id": request_id, "ok": True, "data": credentials.scope_metadata(credentials.load())}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    if operation == "yuketang.scope.save":
        try:
            return {"id": request_id, "ok": True, "data": credentials.save_scope(request.get("scope"))}
        except LookupError:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_REQUEST"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    if operation == "yuketang.configure":
        try:
            credentials.save(request.get("configuration"))
            return {"id": request_id, "ok": True, "data": {"saved": True}}
        except ValueError:
            # Malformed classroom/session inputs are not credential-store failures.
            return {"id": request_id, "ok": False, "error": "INVALID_YUKETANG_CONFIGURATION"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    if operation == "yuketang.clear":
        try:
            credentials.clear()
            return {"id": request_id, "ok": True, "data": {"cleared": True}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    return {"id": request_id, "ok": False, "error": "UNKNOWN_OPERATION"}


def main(protocol_output=None) -> int:
    # stdout is a machine-readable JSONL channel. Business modules may still
    # print diagnostics, but those must never be mixed into the protocol.
    output = protocol_output if protocol_output is not None else sys.stdout
    for raw in sys.stdin.buffer:
        try:
            if len(raw) > MAX_LINE:
                raise ValueError("oversized")
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError("invalid")
            with redirect_stdout(sys.stderr):
                result = dispatch(req)
        except (ValueError, UnicodeDecodeError, TypeError):
            result = {"id": None, "ok": False, "error": "INVALID_REQUEST"}
        output.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
        output.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
