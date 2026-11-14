from studyflow.platforms.yuketang.readonly import YuketangReadOnly


class FakeResponse:
    def raise_for_status(self): pass
    def json(self):
        return {"success":True,"data":{"course_chapter":[
            {"name":"第一章","section_leaf_list":[
                {"name":"视频一","leaf_list":[{"id":12,"leaf_type":0},{"id":13,"leaf_type":6}]}
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
    reader = YuketangReadOnly({"sessionid":"test"},session=session)
    assert reader.video_metadata("123") == [{"id":"12","name":"视频一","chapter":"第一章"}]
    assert len(session.calls) == 1
    assert session.calls[0][0].endswith("/mooc-api/v1/lms/learn/course/chapter")
