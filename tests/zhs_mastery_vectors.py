"""Ground truth copied from ``appcomm-user.zhihuishu.com_2026_11_21_22_51_12.har``.

Two ``c/has?uid=...`` responses (``rt.sl``), the AES material they decode to,
and five request bodies with the exact ``secretStr`` that left the browser.
Nothing here is synthesised: a changed byte means the capture changed.

Shared by ``tests/test_zhs_mastery.py`` (pytest) and
``scripts/verify_zhs_mastery.py`` (stdlib-only runner).
"""

MODULE_EXAM = 3
MODULE_KG_AI = 6

SL_KG_AI = (
    "KomLn7VDcgvS93cRo1Uu9T71ZdZ4aLssymobN2neRpuiWOI/xV2JrgFuY9GvWIGeXdfUhtPMlsvCz3JniCPfb4"
    "lmp/k+/yDva4PVyk/ant6bASs/X1zitVYTZB+QW7Qyx9fgMWBYvfISMfjrHZlnIFrLRqPHh5wlQIgEzM4GVik="
)
SL_EXAM = (
    "MvvI6LxWDXiULHdxgGkpyKNBYNmLKocPqUjTId7M/47jQn5akrEAL5Swv7HX3T/Vuz4UsU552qp7eR55UX6gZ/"
    "lLhdOioo6BgRBPmreHZHO0vfYlJ9dN3LHD/k8FaebO3R9e684JIdjJBRT2VhgHozJDp5qRO3/WpeK25qruy2U="
)

CKEY_KG_AI = "hw2fdlwcj4cs1mx7"
CKEY_EXAM = "onbfhdyvz8x7otrp"

KEY_BLOB_KG_AI = {
    "cKey": CKEY_KG_AI, "ckv": 1, "key": "0cp4w1glgtgq96xn",
    "module": MODULE_KG_AI, "nkv": 2, "osVersion": 3,
}
KEY_BLOB_EXAM = {
    "cKey": CKEY_EXAM, "ckv": 1, "key": "9pb9wgu2z0bwwybf",
    "module": MODULE_EXAM, "nkv": 2, "osVersion": 3,
}

# (module, label, plaintext body, secretStr sent on the wire)
HAR = [
    (
        MODULE_EXAM,
        "POST openExam",
        {"examTestId": 4263949, "examPaperId": 454449917, "courseId": "2095430049486426112"},
        (
        "Cvs0CZRKi2wPZuXv6mNC7SJvwGz/zpWSFiZcKKyuQ2CbE2tsQsfVIAG1je16NlMDOA3EiMcUzg7eLhNQYYz/Ha"
        "W3tpr9t5h84VinnWMzuwo="
    ),
    ),
    (
        MODULE_EXAM,
        "GET getExamTestUserInfo / getExamSheetInfo",
        {"examTestId": "4263949", "examPaperId": "454449917"},
        (
        "ab/eDLp6KqfV0x5FWZGzG9mHoWInDZfQXg9nVnm5VnsxW8dQV5WmPvbgWpn6dkWrzdT4ElopCukVUjVuvxHoDw"
        "=="
    ),
    ),
    (
        MODULE_EXAM,
        "GET getExamQuestionInfo",
        {"examTestId": "4263949", "examPaperId": 454449917, "questionId": 939136618, "version": 1},
        (
        "ab/eDLp6KqfV0x5FWZGzG9mHoWInDZfQXg9nVnm5VnsteyLJ04uUZPM8l3UeSN0R4VQdShWIa1OWdJASVYxMif"
        "MXgZ43vMLv8T/U9n2jSM7rbFMEaHL7Y8N0TMpnA+eF"
    ),
    ),
    (
        MODULE_EXAM,
        "POST saveAnswer",
        {
            "recruitId": "2095430049486426112",
            "examTestId": "4263949",
            "examPaperId": 454449917,
            "questionId": 939136618,
            "dataVos": None,
            "answer": None,
        },
        (
        "4QDIEWTg9sWi/TtA3E/ODGHmAyVlGbd3LKCNG6nqbKquW/rWTls7oBx5lhVqa2pLAwjF42mZwGpNRaTcymgTxf"
        "2GN7mgwrbgrEUGpN+ui437L6YhNk5jcc1FeGVgCAZ9o6JN5+d/gdb0lHcj11W/97akFr9QHsp/nhbWCW+dtY5+"
        "Iigx/mBAc70r0jVnma5u"
    ),
    ),
    (
        MODULE_KG_AI,
        "POST kg-ai-run questions-paper",
        {
            "scMapId": "2095430049486426112",
            "courseId": "2095430049486426112",
            "classId": "339597",
            "knowledgeId": "1853343377786015744",
            "dateFormate": 1795272661000,
        },
        (
        "Gf5r5e5h2VlF+qGtbooEsl9AHT7vXXE6oH7v9r7iomjn0RkaB3cEiFNKwBGg9LdPs0r7rTjfiDhyYDYENiqKt9"
        "ylqZtqvWcir+1CnqC8B69xSzCZ+K5taMqNgkY/sLRoGx0OHOGigoXBsx+ehXbgZHac+LPzDe8T67pEhQfRalvI"
        "ueG1QH/MCWR6u4felyaeQ5+2my8RJ/I6ospeLwfzjQ=="
    ),
    ),
]

XQJZXHIZ = "8Pf5k3SZClxzWLnff1mMEw=="  # yxyz("", key6) on the questions-paper call
