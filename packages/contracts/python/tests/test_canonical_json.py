import json
from pathlib import Path

import pytest

from crowdlens_contracts import canonical_json, fingerprint

FIXTURE = (
    Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden-fingerprints.json"
)


def _vectors():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [(v["name"], v) for v in data["vectors"]]


@pytest.mark.parametrize("name,vector", _vectors())
def test_golden_vector_parity(name, vector):
    assert canonical_json(vector["input"]) == vector["canonical"]
    assert fingerprint(vector["input"]) == vector["fingerprint"]


def test_floats_rejected():
    with pytest.raises(ValueError, match="floats"):
        canonical_json({"bad": 1.5})


def test_key_sort_utf16():
    assert canonical_json({"z": 1, "aa": 2, "a": 3, "Z": 4}) == '{"Z":4,"a":3,"aa":2,"z":1}'
