"""Canonical JSON serialisation + semantic fingerprinting.

Mirror of packages/contracts/src/canonical-json.ts. Golden vectors in
packages/contracts/test/fixtures/golden-fingerprints.json pin both
implementations to identical bytes.

Algorithm:
  - Objects: keys sorted by UTF-16 code units, no whitespace.
  - Strings: JSON-escaped, non-ASCII preserved (ensure_ascii=False).
  - Numbers: integers plain; floats rejected (fingerprint inputs must avoid
    floats — architecture.md §12.2).
  - fingerprint = lowercase hex SHA-256 of the canonical UTF-8 bytes.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Union

CanonicalValue = Union[str, int, bool, None, list["CanonicalValue"], dict[str, "CanonicalValue"]]


def _sort_key_utf16(key: str) -> bytes:
    """Sort keys by UTF-16 code units (matches JS String charCode ordering)."""
    return key.encode("utf-16-be", "surrogatepass")


def _escape_string(value: str) -> str:
    # json.dumps with ensure_ascii=False matches JS JSON.stringify escaping for
    # control characters, quotes and backslashes while preserving non-ASCII.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def canonical_json(value: CanonicalValue) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return _escape_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise ValueError("canonical_json: floats are not allowed in fingerprint inputs")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys(), key=_sort_key_utf16):
            parts.append(f"{_escape_string(key)}:{canonical_json(value[key])}")
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"canonical_json: unsupported type {type(value).__name__}")


def fingerprint(value: CanonicalValue) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def canonical_json_any(value: Any) -> str:
    """Convenience for arbitrary parsed JSON values."""
    return canonical_json(value)  # type: ignore[arg-type]
