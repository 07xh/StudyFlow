"""Offline Engine.IO3 transport contracts; no real account or network."""
import json
import pytest

from studyflow.platforms.ucampus.socketio_client import (
    SocketSession, UCampusLegacySocket, SocketProtocolError, make_legacy_url,
)


class FakeSocket:
    def __init__(self, responses):
        self.responses = list(responses)
        self.writes = []
        self.closed = False

    def send(self, data):
        self.writes.append(data)

    def recv(self):
        if not self.responses:
            raise ConnectionError("fixture finished")
        return self.responses.pop(0)

    def close(self):
        self.closed = True


SESSION = SocketSession("my-openid", "own-token")


def test_legacy_endpoint_is_fixed_and_credentials_are_encoded():
    url = make_legacy_url(SocketSession("id:1", "token+with/slash"))
    assert url.startswith("wss://ucontent.unipus.cn/unipusio/?")
    assert "token%2Bwith%2Fslash" in url
    assert "transport=websocket" in url
    assert "EIO=3" in url


def test_socketio_connection_pong_and_ack_never_imply_completion():
    fake = FakeSocket([
        '0{"sid":"sid1","pingInterval":25000,"pingTimeout":20000}',
        "2", "40/userActivities",
        "2", '42/userActivities,["receipt",{"received":true}]',
    ])
    captured=[]
    client = UCampusLegacySocket(SESSION, connect=lambda url: (captured.append(url) or fake))
    assert "own-token" not in repr(SESSION)
    client.connect()
    result = client.emit("local_event", {"seq": 1, "elapsed_local": 2})
    assert result == "unsolicited_event"
    assert fake.writes[1] == "3"
    assert fake.writes[-1] == "3"
    assert fake.writes[2].startswith("42/userActivities,")
    assert json.loads(fake.writes[2].split(",", 1)[1]) == [
        "local_event", {"seq": 1, "elapsed_local": 2}]
    client.close()
    assert fake.closed


def test_bad_handshake_fails_closed_and_closes_socket():
    for frames in (["unexpected"], ['0{"bad":"sid"}'],
                   ['0{"sid":"ok"}', "41/userActivities"]):
        fake=FakeSocket(frames)
        client=UCampusLegacySocket(SESSION, connect=lambda _url: fake)
        with pytest.raises(SocketProtocolError):
            client.connect()
        assert fake.closed


def test_no_event_without_connection_or_with_invalid_payload():
    client=UCampusLegacySocket(SESSION, connect=lambda _url: FakeSocket([]))
    with pytest.raises(SocketProtocolError, match="UCAMPUS_SOCKET_NOT_CONNECTED"):
        client.emit("local_event", {"seq": 1})
    with pytest.raises(ValueError):
        SocketSession("id\ninvalid", "token")
    with pytest.raises(ValueError):
        SocketSession("id", "")


def test_response_failure_does_not_claim_acceptance():
    fake=FakeSocket(['0{"sid":"ok"}', "40/userActivities"])
    client=UCampusLegacySocket(SESSION, connect=lambda _url: fake)
    client.connect()
    with pytest.raises(SocketProtocolError, match="UCAMPUS_SOCKET_TRANSPORT_UNKNOWN"):
        client.emit("local_event", {"seq": 1})
    client.close()


def test_unrelated_frames_are_not_treated_as_delivery_acks():
    for reply, expected in (
        ('42/userActivities,["notice",{"ok":true}]', "unsolicited_event"),
        ('43/userActivities,["ok"]', "unmatched_ack"),
        ("40/userActivities", "unknown"),
    ):
        socket = FakeSocket(['0{"sid":"socket-id"}', "40/userActivities", reply])
        client = UCampusLegacySocket(SESSION, connect=lambda _url: socket)
        with client:
            assert client.emit("local_event", {"seq": 1}) == expected
        assert socket.closed


def test_engine_io_noop_and_pong_frames_are_ignored():
    socket = FakeSocket(['0{"sid":"id"}', "6", "3", "40/userActivities",
                         "6", "3", '42/userActivities,["notice",{}]'])
    client = UCampusLegacySocket(SESSION, connect=lambda _: socket)
    with client:
        assert client.emit("local_event", {"seq": 1}) == "unsolicited_event"


def test_engine_io_close_and_namespace_rejection_disconnect():
    for close_frame in ("1", "44/userActivities,{\"message\":\"forbidden\"}",
                        "41/userActivities"):
        socket = FakeSocket(['0{"sid":"id"}', "40/userActivities", close_frame])
        client = UCampusLegacySocket(SESSION, connect=lambda _: socket)
        client.connect()
        with pytest.raises(SocketProtocolError):
            client.emit("local_event", {"seq": 1})
        assert socket.closed


def test_bad_sid_and_unbounded_frames_are_rejected():
    for frame in ('0{"sid":""}', '0{"sid":"x","pingInterval":true}',
                  "0" + "x"*65537):
        socket = FakeSocket([frame])
        client = UCampusLegacySocket(SESSION, connect=lambda _: socket)
        with pytest.raises(SocketProtocolError):
            client.connect()
        assert socket.closed
