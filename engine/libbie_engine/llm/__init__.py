"""Model layer -- plan section 7. One interface, swappable backends."""

from .base import LLMBackend
from .factory import build_backend

__all__ = ["LLMBackend", "build_backend"]
