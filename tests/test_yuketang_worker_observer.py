"""No original Rain Classroom heartbeat source edits; annotations are read-only."""
import builtins
import pytest

from studyflow.services.yuketang_worker_observer import (
    attribute_worker_progress, _numeric_annotation,
)


def test_numeric_observation_never_embeds_credentials_or_unbounded_lines():
    assert _numeric_annotation("Authorization: Bearer a-secret") is None
    assert _numeric_annotation("发送心跳成功 - 位置: 999s/10s (99%)") is None
    assert _numeric_annotation("服务器进度: 完成率=120%, 最后位置=10s") is None
    assert _numeric_annotation("视频时长: -22秒") is None
    assert _numeric_annotation("最终进度: 完成率=55.50%, 最后位置=44s") == (
        "SERVER source=final percent=55.500 position=44.000"
    )


def test_attribution_uses_actual_worker_frame_not_log_order(capsys):
    original_print = builtins.print

    def watch_single_video_worker():
        worker_id = 7
        print("发送心跳成功 - 位置: 42.0s/120.0s (35.0%), 事件: playing")
        print("服务器进度: 完成率=31.20%, 最后位置=38.0s")
        print("视频时长: 120秒")
        print("授权凭据=secret-do-not-copy")

    with attribute_worker_progress():
        watch_single_video_worker()
        print("最终进度: 完成率=88.0%, 最后位置=88s")
    assert builtins.print is original_print
    output = capsys.readouterr().out
    assert "[StudyFlow-Worker-7] LOCAL position=42.000 duration=120.000 percent=35.000" in output
    assert "[StudyFlow-Worker-7] SERVER source=periodic percent=31.200 position=38.000" in output
    assert "[StudyFlow-Worker-7] DURATION seconds=120.000" in output
    assert output.count("最终进度: 完成率=88.0%") == 1
    assert output.count("授权凭据=secret-do-not-copy") == 1
    assert "[StudyFlow-Worker-7] 授权凭据" not in output


def test_attribution_restores_builtins_even_on_original_task_exception():
    original_print = builtins.print
    with pytest.raises(KeyboardInterrupt), attribute_worker_progress():
        raise KeyboardInterrupt()
    assert builtins.print is original_print


def test_legacy_main_is_not_modified_for_progress_attribution():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    original = (root / "legacy" / "yuketang" / "main.py").read_text(encoding="utf-8")
    assert "[StudyFlow-Worker-" not in original
    wrapper = (root / "src" / "studyflow" / "services" / "legacy_playback.py").read_text(encoding="utf-8")
    assert "with attribute_worker_progress():" in wrapper
