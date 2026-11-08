import numpy as np

from tokaraoke_analyzer.notes import segment_notes


def frames(*parts):
    """(midi or None, フレーム数) の並びから f0 曲線を作る"""
    out = []
    for value, count in parts:
        out += [np.nan if value is None else value] * count
    return np.array(out, dtype=float)


def test_stable_notes_become_separate_bars():
    m = frames((60, 50), (62, 50), (None, 20), (64, 40))
    notes = segment_notes(m)
    assert [n.midi for n in notes] == [60, 62, 64]
    assert abs(notes[0].start - 0.0) < 0.02
    assert abs(notes[1].start - 0.5) < 0.03
    assert abs(notes[2].start - 1.2) < 0.03


def test_vibrato_stays_one_note():
    t = np.arange(150)
    m = 67 + 0.4 * np.sin(2 * np.pi * 5.5 * t / 100)
    notes = segment_notes(m)
    assert [n.midi for n in notes] == [67]


def test_short_blips_are_dropped():
    m = frames((None, 10), (70, 4), (None, 10), (60, 30))
    assert [n.midi for n in segment_notes(m)] == [60]


def test_single_frame_outliers_do_not_split():
    m = frames((60, 60))
    m[30] = 72
    m[31] = 48
    assert [n.midi for n in segment_notes(m)] == [60]


def test_same_pitch_with_tiny_gap_is_merged():
    m = frames((65, 30), (None, 3), (65, 30))
    notes = segment_notes(m)
    assert len(notes) == 1 and notes[0].midi == 65


def test_semitone_blip_between_notes_is_absorbed():
    # ビブラートの山で一瞬だけ半音上と判定された区間は、前のノートに含める
    m = frames((65, 40), (66, 9), (67, 40))
    notes = segment_notes(m)
    assert [n.midi for n in notes] == [65, 67]
    assert abs(notes[0].end - notes[1].start) < 0.02


def test_short_real_jump_is_kept():
    # 2 半音以上離れた短い音は装飾音として残す
    m = frames((60, 40), (64, 10), (60, 40))
    assert [n.midi for n in segment_notes(m)] == [60, 64, 60]


def test_slightly_flat_singing_rounds_to_nearest():
    m = frames((59.7, 40))
    assert segment_notes(m)[0].midi == 60
