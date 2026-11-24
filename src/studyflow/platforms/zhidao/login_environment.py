"""Shared first-use login initialization for the packaged ZHS runtime."""
from pathlib import Path


def initialize_login(home: Path):
    """Initialize the user's data directory without requiring the old desktop app.

    The SDK resolves several resources relative to cwd; the bridge and QR worker
    already anchor cwd at the current user's home before calling this helper.
    """
    from zhs.config import ConfigManager
    from zhs.session import ZhsSession

    directory = home / ".zhs"
    if directory.is_symlink():
        raise OSError("unsafe login directory")
    directory.mkdir(parents=True, exist_ok=True)
    config = ConfigManager(config_path=directory / "config.toml").load()
    if not config.save_cookies:
        raise ValueError("login persistence disabled")
    return config, ZhsSession(config), directory


def offline_login_probe() -> int:
    """Exercise actual SDK first-use construction in an empty Unicode directory.

    No account, network request, or existing user data is required.
    """
    import os
    import tempfile
    from .cookie_import import parse_cookie

    previous = Path.cwd()
    session = None
    try:
        with tempfile.TemporaryDirectory(prefix="studyflow-login-") as root:
            home = Path(root) / "首次登录 用户"
            home.mkdir()
            os.chdir(home)
            try:
                _, session, directory = initialize_login(home)
                from zhs.utils.cookie import list_to_cookies, cookies_to_list
                rows = parse_cookie('[{"name":"studyflow_test","value":"synthetic","domain":".zhihuishu.com","path":"/"}]', "file")
                session.cookies = list_to_cookies(rows)
                if not any(row["name"] == "studyflow_test" for row in cookies_to_list(session.cookies)):
                    return 5
                if not directory.is_dir() or (directory / "cookies.json").exists():
                    return 5
                return 0
            finally:
                try:
                    if session is not None:
                        session.close()
                finally:
                    os.chdir(previous)
    except Exception:
        return 5
