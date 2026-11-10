"""Document parsing: PDF/MD/TXT → chunked text with stable source locators (DOC-04)."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

from pypdf import PdfReader

CHUNK_SIZE = 900
CHUNK_OVERLAP = 120


@dataclass
class Chunk:
    chunk_id: str
    locator: str  # page/chunk stable reference
    text: str


@dataclass
class ParsedDocument:
    chunks: list[Chunk] = field(default_factory=list)
    error: str | None = None


def _chunk_text(text: str, locator_prefix: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return chunks
    start = 0
    index = 0
    while start < len(cleaned):
        end = min(start + CHUNK_SIZE, len(cleaned))
        segment = cleaned[start:end]
        chunks.append(Chunk(chunk_id=f"{locator_prefix}/c{index}", locator=locator_prefix, text=segment))
        if end >= len(cleaned):
            break
        start = end - CHUNK_OVERLAP
        index += 1
    return chunks


def parse_document(mime_type: str, body: bytes) -> ParsedDocument:
    try:
        if mime_type == "application/pdf":
            return _parse_pdf(body)
        if mime_type in ("text/markdown", "text/plain", "text/x-markdown"):
            return _parse_text(body)
        return ParsedDocument(error=f"unsupported mime type: {mime_type}")
    except Exception as error:  # noqa: BLE001 - actionable parse failure
        return ParsedDocument(error=f"parse failed: {error}")


def _parse_pdf(body: bytes) -> ParsedDocument:
    reader = PdfReader(io.BytesIO(body))
    if reader.is_encrypted:
        return ParsedDocument(error="encrypted PDFs are not supported")
    doc = ParsedDocument()
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        doc.chunks.extend(_chunk_text(text, f"page/{page_number}"))
    if not doc.chunks:
        doc.error = "no extractable text (scanned PDF?)"
    return doc


def _parse_text(body: bytes) -> ParsedDocument:
    text = body.decode("utf-8", errors="replace")
    return ParsedDocument(chunks=_chunk_text(text, "text/1"))
