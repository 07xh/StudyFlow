; StudyFlow bundles a standalone Python bridge that can outlive the UI.
; The default Tauri NSIS "app is running" check only covers studyflow.exe.
; Refuse to overwrite an in-use sidecar, rather than offering Ignore and
; creating a mixed-version installation. Never kill unrelated user processes.
!macro STUDYFLOW_ENSURE_BRIDGE_UNLOCKED
  sf_bridge_retry:
    IfFileExists "$INSTDIR\bin\studyflow-bridge.exe" 0 sf_bridge_ready
    ClearErrors
    FileOpen $R9 "$INSTDIR\bin\studyflow-bridge.exe" a
    IfErrors sf_bridge_busy
    FileClose $R9
    Goto sf_bridge_ready

  sf_bridge_busy:
    IfSilent sf_bridge_abort
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "学序后台程序 studyflow-bridge.exe 仍在运行或文件不可写。请先停止学习任务、退出学序，再点击“重试”。若学序已退出，请在任务管理器中结束残留的 studyflow-bridge.exe。安装器不会跳过该文件。" IDRETRY sf_bridge_retry

  sf_bridge_abort:
    SetErrorLevel 2
    Abort

  sf_bridge_ready:
    Nop
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro STUDYFLOW_ENSURE_BRIDGE_UNLOCKED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro STUDYFLOW_ENSURE_BRIDGE_UNLOCKED
!macroend
