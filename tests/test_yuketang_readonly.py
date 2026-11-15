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
