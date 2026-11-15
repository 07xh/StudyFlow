from studyflow.platforms.yuketang.readonly import YuketangReadOnly


class FakeResponse:
    def raise_for_status(self): pass
    def json(self):
        return {"success": True, "data": {"course_chapter": [
            {"name": "第一章", "section_leaf_list": [
                {"name": "视频一", "leaf_list": [{"id": 12, "leaf_type": 0}, {"id": 13, "leaf_type": 6}]}
            ]}
        ]}}

class FakeSession:
    def __init__(self):
        self.cookies = {}
        self.calls = []
    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse()


def test_read_only_video_metadata():
    session = FakeSession()
    reader = YuketangReadOnly({"sessionid": "test"}, session=session)
    assert reader.video_metadata("123") == [{"id": "12", "name": "视频一", "chapter": "第一章"}]
    assert len(session.calls) == 1
    assert session.calls[0][0].endswith("/mooc-api/v1/lms/learn/course/chapter")


class FlatVideoResponse:
    def raise_for_status(self): pass
    def json(self):
        return {"success": True, "data": {"course_chapter": [
            {"name": "第一章", "section_leaf_list": [
                {"id": 100, "leaf_type": 0, "name": "直接视频"},
                {"id": 101, "leaf_type": 3, "name": "图文"},
                {"id": 102, "leaf_type": 6, "name": "测试"},
                {"name": "嵌套小节", "leaf_list": [
                    {"id": 103, "leaf_type": "0", "name": "嵌套视频"},
                    {"id": 104, "leaf_type": 3, "name": "图文"},
                ]},
            ]},
            {"name": "第二章", "section_leaf_list": [
                {"id": 100, "leaf_type": 0, "name": "重复视频"},
                {"id": 105, "leaf_type": None, "name": "未知类型"},
            ]},
        ]}}


def test_video_metadata_supports_flat_and_nested_without_guessing_types():
    session = FakeSession()
    session.get = lambda *args, **kwargs: FlatVideoResponse()
    videos = YuketangReadOnly({"sessionid": "test"}, session=session).video_metadata("123")
    assert videos == [
        {"id": "100", "name": "直接视频", "chapter": "第一章"},
        {"id": "103", "name": "嵌套视频", "chapter": "第一章"},
    ]


def test_selected_course_must_match_saved_classroom(monkeypatch):
    from studyflow.platforms.yuketang import adapter, credentials
    cfg = credentials.YuketangConfig("session", "csrf", "123", "22")
    monkeypatch.setattr(adapter, "load", lambda: cfg)
    monkeypatch.setattr(adapter, "make_reader",
                        lambda _: (_ for _ in ()).throw(AssertionError("wrong class queried")))
    import pytest
    with pytest.raises(LookupError):
        adapter.YuketangAdapter().list_videos(course_id="456")


class ServerProgressResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status
    def raise_for_status(self):
        if self.status_code >= 400:
            raise ValueError("HTTP error")
    def json(self):
        return self.payload


class ServerProgressSession:
    def __init__(self, rate=0.5, progress_status=200, leaf_classroom="123", confirmed=True):
        self.cookies = {}
        self.calls = []
        self.rate = rate
        self.progress_status = progress_status
        self.leaf_classroom = leaf_classroom
        self.confirmed = confirmed

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if "/leaf_info/" in url:
            return ServerProgressResponse({"success": True, "data": {
                "user_id": 9, "course_id": 32,
                "classroom_id": self.leaf_classroom, "duration": 120,
            }})
        assert url.endswith("/video-log/get_video_watch_progress/")
        return ServerProgressResponse({
            "code": 0 if self.confirmed else 403,
            "data": {"12": {"rate": self.rate, "last_point": 60}},
        }, status=self.progress_status)


def test_yuketang_progress_is_verified_readonly_and_scoped():
    session = ServerProgressSession()
    reader = YuketangReadOnly({"sessionid":"own"},session=session,csrf_token="csrf",university_id="42")
    result = reader.read_video_progress("123", "12")
    assert result == {"progress_percent":50.0,"last_point_seconds":60.0,"duration_seconds":120.0}
    assert len(session.calls) == 2
    assert all(call[1].get("data") is None for call in session.calls)
    assert session.calls[1][1]["params"] == {
        "cid":"32","user_id":"9","classroom_id":"123",
        "video_type":"video","vtype":"rate","video_id":"12","snapshot":1,
    }
    assert session.calls[1][1]["allow_redirects"] is False


def test_yuketang_progress_unknown_must_not_be_fabricated():
    import pytest
    for session in (
        ServerProgressSession(rate=2),
        ServerProgressSession(rate="0.5"),
        ServerProgressSession(progress_status=302),
        ServerProgressSession(leaf_classroom="999"),
        ServerProgressSession(confirmed=False),
    ):
        reader = YuketangReadOnly({"sessionid":"own"},session=session)
        with pytest.raises((ValueError,TypeError)):
            reader.read_video_progress("123", "12")
    session = ServerProgressSession(leaf_classroom="999")
    reader = YuketangReadOnly({"sessionid":"own"},session=session)
    with pytest.raises(ValueError):
        reader.read_video_progress("123", "12")
    assert len(session.calls) == 1  # No cross-classroom server-progress query.


def test_yuketang_per_video_adapter_paginates_and_never_reuses_other_classroom(monkeypatch):
    import pytest
    from studyflow.platforms.yuketang import adapter, credentials
    cfg = credentials.YuketangConfig("session","csrf","123","42")
    monkeypatch.setattr(adapter, "load", lambda: cfg)
    calls = []
    class FakeReader:
        def video_metadata(self, classroom_id, **kwargs):
            assert classroom_id == "123"
            return [{"id":str(i),"name":"视频"+str(i),"chapter":"第一章"} for i in range(1,20)]
        def read_video_progress(self, classroom_id, video_id):
            calls.append(video_id)
            if video_id == "4":
                raise ValueError("server rate absent")
            return {"progress_percent":100.0 if video_id=="3" else 25.0,
                    "last_point_seconds":5.0,"duration_seconds":20.0}
    monkeypatch.setattr(adapter, "make_reader",lambda config:FakeReader())
    result = adapter.YuketangAdapter().course_progress("123",offset=0,limit=5)
    assert (result["total"], result["next_offset"],len(result["items"])) == (19,5,5)
    assert result["items"][2]["server_completed"] is True
    assert result["items"][3]["progress_percent"] is None
    assert result["items"][3]["verified_at"] is None
    assert set(calls) == {"1","2","3","4","5"}
    with pytest.raises(LookupError):
        adapter.YuketangAdapter().course_progress("999",offset=0,limit=5)
    with pytest.raises(ValueError):
        adapter.YuketangAdapter().course_progress("123",offset=0,limit=100)
