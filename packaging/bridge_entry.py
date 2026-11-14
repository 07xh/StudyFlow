"""PyInstaller entrypoint. Keep standard streams enabled for JSONL IPC."""
from studyflow.services.bridge import main

if __name__ == "__main__":
    raise SystemExit(main())
