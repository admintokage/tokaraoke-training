from tokaraoke_analyzer.lyrics import map_words_to_lines, parse_lines


def test_parse_lines_skips_blank_lines():
    assert parse_lines("あいう\n\n  えお  \n") == ["あいう", "えお"]


def test_exact_character_match():
    lines = ["あいう", "えお"]
    words = [("あい", 1.0, 1.5), ("う", 1.5, 2.0), (" え", 3.0, 3.4), ("お", 3.4, 4.0)]
    out = map_words_to_lines(words, lines)
    assert out == [
        {"start": 1.0, "end": 2.0, "text": "あいう"},
        {"start": 3.0, "end": 4.0, "text": "えお"},
    ]


def test_mismatched_length_is_approximated_monotonically():
    lines = ["こんにちは、世界", "さようなら"]
    # 句読点が落ちて 1 文字少ない
    words = [(c, i * 0.5, i * 0.5 + 0.4) for i, c in enumerate("こんにちは世界さようなら")]
    out = map_words_to_lines(words, lines)
    assert out[0]["start"] == 0.0
    assert out[0]["end"] < out[1]["start"] + 0.5
    assert out[1]["end"] == words[-1][2]


def test_edge_characters_stuck_to_neighbor_lines_are_ignored():
    # 実際に起きた例: 2 行目の頭「そ」が 1 行目の直後に、行末「って」が 3 行目の直前に置かれた
    lines = ["きょうは", "そらはひろがって", "みんなで"]
    words = (
        [(c, 2.0 + i * 0.2, 2.2 + i * 0.2) for i, c in enumerate("きょうは")]
        + [("そ", 2.8, 3.1)]
        + [(c, 7.0 + i * 0.2, 7.2 + i * 0.2) for i, c in enumerate("らはひろが")]
        + [("って", 11.6, 11.6)]
        + [(c, 12.0 + i * 0.2, 12.2 + i * 0.2) for i, c in enumerate("みんなで")]
    )
    out = map_words_to_lines(words, lines)
    assert [(o["start"], o["end"]) for o in out] == [(2.0, 2.8), (7.0, 8.0), (12.0, 12.8)]


def test_failed_lines_are_spread_evenly():
    # 1 行目だけ合わせられ、残りは曲の最後に 0 秒で積み上がった
    lines = ["あいう", "えお", "かき", "くけ"]
    words = [(c, 1.0 + i * 0.5, 1.5 + i * 0.5) for i, c in enumerate("あいう")]
    words += [(c, 12.5, 12.5) for c in "えおかきくけ"]
    out = map_words_to_lines(words, lines, duration=12.5)
    assert (out[0]["start"], out[0]["end"]) == (1.0, 2.5)
    assert "aligned" not in out[0]
    assert [o["start"] for o in out[1:]] == [2.5, 5.833, 9.167]
    assert all(o["aligned"] is False for o in out[1:])
    assert out[-1]["end"] == 12.5


def test_english_lines_with_spaces():
    lines = ["hello world", "good bye"]
    words = [(" hello", 0.0, 0.5), (" world", 0.5, 1.0), (" good", 2.0, 2.5), (" bye", 2.5, 3.0)]
    out = map_words_to_lines(words, lines)
    assert [(o["start"], o["end"]) for o in out] == [(0.0, 1.0), (2.0, 3.0)]
