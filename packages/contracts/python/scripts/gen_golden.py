"""Generate golden fingerprint vectors (run once, output committed to fixtures)."""

import json
from pathlib import Path

from crowdlens_contracts import canonical_json, fingerprint

VECTORS = [
    {"name": "empty-object", "input": {}},
    {"name": "empty-array", "input": []},
    {"name": "scalars", "input": {"b": 1, "a": True, "c": None}},
    {"name": "key-sort-utf16", "input": {"z": 1, "aa": 2, "a": 3, "Z": 4}},
    {"name": "nested", "input": {"outer": {"b": [1, 2, {"y": "x"}], "a": "v"}, "list": []}},
    {"name": "unicode", "input": {"text": "héllo — 世界", "emoji": "🙂"}},
    {"name": "escapes", "input": {"s": "quote\" backslash\\ newline\n tab\t"}},
    {"name": "cache-key-shape", "input": {
        "workspace_id": "11111111-2222-3333-4444-555555555555",
        "acl_epoch": 17,
        "operation_version": "ner-v3",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash",
        "prompt_bundle": "git-sha",
        "schema_hash": "sha256",
        "source_hashes": ["aa" * 32, "bb" * 32],
        "parameters": {"temperature": 0},
        "random_seed": 12345,
    }},
]


def main() -> None:
    out = {
        "description": "Golden canonical-JSON fingerprint vectors shared by the TS and Python implementations. fingerprint = sha256hex(canonical_json(input)).",
        "algorithm": {
            "objects": "keys sorted by UTF-16 code units",
            "whitespace": "none",
            "strings": "JSON-escaped, non-ASCII preserved",
            "numbers": "integers only; floats rejected",
        },
        "vectors": [
            {
                "name": v["name"],
                "input": v["input"],
                "canonical": canonical_json(v["input"]),
                "fingerprint": fingerprint(v["input"]),
            }
            for v in VECTORS
        ],
    }
    dest = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "golden-fingerprints.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
