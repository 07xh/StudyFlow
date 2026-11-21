"""Self-contained AES-128-CBC used when ``cryptography`` is not importable.

Only the Zhihuishu seal needs it: a 128-bit key, CBC mode, PKCS#7 padding is
applied by the caller.  Correctness is pinned by the captured ciphertexts in
``tests/zhs_mastery_vectors.py``.
"""
from __future__ import annotations

_SBOX = (
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
)
_INV_SBOX = [0] * 256
for _index, _value in enumerate(_SBOX):
    _INV_SBOX[_value] = _index
_RCON = (0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36)


def _xtime(value: int) -> int:
    value <<= 1
    return (value ^ 0x1B) & 0xFF if value & 0x100 else value


def _mul(left: int, right: int) -> int:
    result = 0
    while right:
        if right & 1:
            result ^= left
        left = _xtime(left)
        right >>= 1
    return result


def _round_keys(key: bytes) -> list[bytes]:
    words = [list(key[index:index + 4]) for index in range(0, 16, 4)]
    for index in range(4, 44):
        temp = list(words[index - 1])
        if index % 4 == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[byte] for byte in temp]
            temp[0] ^= _RCON[index // 4 - 1]
        words.append([words[index - 4][position] ^ temp[position] for position in range(4)])
    return [bytes(sum(words[round_index * 4:round_index * 4 + 4], [])) for round_index in range(11)]


def _add_round_key(state: list[int], round_key: bytes) -> None:
    for index in range(16):
        state[index] ^= round_key[index]


def _shift_rows(state: list[int]) -> None:
    for row in range(1, 4):
        column = [state[4 * c + row] for c in range(4)]
        column = column[row:] + column[:row]
        for c in range(4):
            state[4 * c + row] = column[c]


def _inv_shift_rows(state: list[int]) -> None:
    for row in range(1, 4):
        column = [state[4 * c + row] for c in range(4)]
        column = column[-row:] + column[:-row]
        for c in range(4):
            state[4 * c + row] = column[c]


def _mix_columns(state: list[int]) -> None:
    for c in range(4):
        a = state[4 * c:4 * c + 4]
        state[4 * c + 0] = _mul(a[0], 2) ^ _mul(a[1], 3) ^ a[2] ^ a[3]
        state[4 * c + 1] = a[0] ^ _mul(a[1], 2) ^ _mul(a[2], 3) ^ a[3]
        state[4 * c + 2] = a[0] ^ a[1] ^ _mul(a[2], 2) ^ _mul(a[3], 3)
        state[4 * c + 3] = _mul(a[0], 3) ^ a[1] ^ a[2] ^ _mul(a[3], 2)


def _inv_mix_columns(state: list[int]) -> None:
    for c in range(4):
        a = state[4 * c:4 * c + 4]
        state[4 * c + 0] = _mul(a[0], 14) ^ _mul(a[1], 11) ^ _mul(a[2], 13) ^ _mul(a[3], 9)
        state[4 * c + 1] = _mul(a[0], 9) ^ _mul(a[1], 14) ^ _mul(a[2], 11) ^ _mul(a[3], 13)
        state[4 * c + 2] = _mul(a[0], 13) ^ _mul(a[1], 9) ^ _mul(a[2], 14) ^ _mul(a[3], 11)
        state[4 * c + 3] = _mul(a[0], 11) ^ _mul(a[1], 13) ^ _mul(a[2], 9) ^ _mul(a[3], 14)


def _encrypt_block(block: bytes, round_keys: list[bytes]) -> bytes:
    state = list(block)
    _add_round_key(state, round_keys[0])
    for round_index in range(1, 10):
        state = [_SBOX[byte] for byte in state]
        _shift_rows(state)
        _mix_columns(state)
        _add_round_key(state, round_keys[round_index])
    state = [_SBOX[byte] for byte in state]
    _shift_rows(state)
    _add_round_key(state, round_keys[10])
    return bytes(state)


def _decrypt_block(block: bytes, round_keys: list[bytes]) -> bytes:
    state = list(block)
    _add_round_key(state, round_keys[10])
    for round_index in range(9, 0, -1):
        _inv_shift_rows(state)
        state = [_INV_SBOX[byte] for byte in state]
        _add_round_key(state, round_keys[round_index])
        _inv_mix_columns(state)
    _inv_shift_rows(state)
    state = [_INV_SBOX[byte] for byte in state]
    _add_round_key(state, round_keys[0])
    return bytes(state)


def aes128_cbc_encrypt(data: bytes, key: bytes, iv: bytes) -> bytes:
    """PKCS#7 padded CBC encryption; ``len(data)`` may be any length."""
    round_keys = _round_keys(key)
    pad = 16 - len(data) % 16
    data = data + bytes([pad]) * pad
    previous = iv
    out = bytearray()
    for offset in range(0, len(data), 16):
        block = bytes(a ^ b for a, b in zip(data[offset:offset + 16], previous))
        previous = _encrypt_block(block, round_keys)
        out.extend(previous)
    return bytes(out)


def aes128_cbc_decrypt(data: bytes, key: bytes, iv: bytes) -> bytes:
    if not data or len(data) % 16:
        raise ValueError("AES_CIPHERTEXT_LENGTH_INVALID")
    round_keys = _round_keys(key)
    previous = iv
    out = bytearray()
    for offset in range(0, len(data), 16):
        block = data[offset:offset + 16]
        plain = _decrypt_block(block, round_keys)
        out.extend(a ^ b for a, b in zip(plain, previous))
        previous = block
    pad = out[-1]
    if not 1 <= pad <= 16 or bytes(out[-pad:]) != bytes([pad]) * pad:
        raise ValueError("AES_PADDING_INVALID")
    return bytes(out[:-pad])
