"""KG extraction backends (spec/40): the private extractor side of T3.

`KGBackend` is the seam between the compile stage and whatever extracts the
entity graph — LightRAG today, a bespoke extractor tomorrow. Backends speak a
backend-neutral shape (entity/relation *names*, not ids); the exporter
(`brainpick.compile.t3`) normalizes that into the normative neutral export.
"""
from brainpick.kgadapt.protocol import KGBackend, MockKGBackend

__all__ = ["KGBackend", "MockKGBackend"]
