from studyflow.core.models import Platform
from studyflow.platforms.zhidao.adapter import ZhidaoAdapter
from studyflow.platforms.yuketang.adapter import YuketangAdapter


def test_platform_identity():
    assert ZhidaoAdapter().connection_info().platform == Platform.ZHIDAO
    assert YuketangAdapter().connection_info().platform == Platform.YUKETANG
