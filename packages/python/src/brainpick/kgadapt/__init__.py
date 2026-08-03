"""KG extraction backends (spec/40): the private extractor side of T3.

`KGBackend` is the seam between the compile stage and whatever extracts the
entity graph. No real extractor ships today — the algorithmic backend
(`kgadapt.algorithmic`) derives the graph instead of extracting it, and the
`mock` test hook exercises this seam without a model — but the protocol
stays in case a future extractor earns its keep. Backends speak a
backend-neutral shape (entity/relation *names*, not ids); the exporter
(`brainpick.compile.t3`) normalizes that into the normative neutral export.
"""
from brainpick.kgadapt.protocol import KGBackend, MockKGBackend

__all__ = ["KGBackend", "MockKGBackend"]
