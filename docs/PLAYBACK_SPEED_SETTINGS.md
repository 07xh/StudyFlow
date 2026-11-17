# 学序自定义倍速

- 知到官方 HTML5 WebView2 播放器：0.5–4×，最多两位小数；提供常用预设。保存后下次启动生效，以播放器报告的实际倍速为准。
- 知到 ZHS 原版运行器：继续遵守 1–2× 目标与上限，只将输入步进提升到 0.01×，不更改上游心跳发送逻辑。
- 雨课堂：现有 0.1–4× 输入精度从 0.1× 改成 0.01×，不扩张后端范围。
- 保留 Git 快照中的 `legacy/zhidao/Official-Player.ps1` 原文件。Rust 只在隔离运行目录的本地副本中将固定倍速白名单改成范围校验，且采用严格版本匹配，避免覆盖未知上游版本。
- 设置值只代表目标速度，不代表平台确认已学习或已完成。

验证建议：`pytest -q tests/test_zhidao_player_speed.py tests/test_zhidao_standalone.py tests/test_original_source_snapshot.py`；`cd frontend && npm test`；`cargo test`。Windows 真机另验证实际播放及状态上报。
