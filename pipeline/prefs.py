"""対応する県（コード → 県名）と表記順。"""
PREFS = {"21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "30": "和歌山県"}
# 対応エリアの表記順（静岡県・愛知県・岐阜県・三重県・和歌山県）
PREF_ORDER = ["22", "23", "21", "24", "30"]


def pref_label(codes) -> str:
    """県コードの集まり → 「静岡県・三重県」の形（表記順）。未知のコードは ValueError。"""
    codes = set(codes)
    unknown = codes - set(PREFS)
    if unknown:
        raise ValueError(f"未対応の県コード: {sorted(unknown)}")
    return "・".join(PREFS[c] for c in PREF_ORDER if c in codes)
