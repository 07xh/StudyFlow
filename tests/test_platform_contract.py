import pytest

from studyflow.core.models import Platform
from studyflow.platforms.zhidao.adapter import ZhidaoAdapter
from studyflow.platforms.yuketang.adapter import YuketangAdapter


@pytest.mark.parametrize("adapter,platform", [
    (ZhidaoAdapter(), Platform.ZHIDAO),
    (YuketangAdapter(), Platform.YUKETANG),
])
def test_platforms_fail_closed(adapter, platform):
    status = adapter.connection_info()
    assert status.platform is platform
    assert not status.connected
    with pytest.raises(RuntimeError):
        adapter.list_courses()
