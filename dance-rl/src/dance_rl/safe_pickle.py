"""Restricted unpickler for the AIST++ annotation .pkl files (dicts of numpy arrays).

Downloaded pickles are untrusted: plain pickle.load can run arbitrary code. This only resolves the
handful of globals needed to rebuild numpy arrays / scalars and refuses everything else.
"""
from __future__ import annotations

import pickle

import numpy as np

_ALLOWED = {
    ("numpy.core.multiarray", "_reconstruct"), ("numpy._core.multiarray", "_reconstruct"),
    ("numpy.core.multiarray", "scalar"), ("numpy._core.multiarray", "scalar"),
    ("numpy", "ndarray"), ("numpy", "dtype"),
    ("numpy.core.numeric", "_frombuffer"), ("numpy._core.numeric", "_frombuffer"),
    ("builtins", "dict"), ("builtins", "list"), ("builtins", "tuple"), ("builtins", "float"),
    ("builtins", "int"), ("builtins", "str"), ("collections", "OrderedDict"),
}


class _Unpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) not in _ALLOWED:
            raise pickle.UnpicklingError(f"refusing global {module}.{name}")
        if module.startswith("numpy.core"):
            module = module.replace("numpy.core", "numpy._core") if np.__version__ >= "2" else module
        return super().find_class(module, name)


def load(path):
    with open(path, "rb") as f:
        return _Unpickler(f, encoding="latin1").load()
