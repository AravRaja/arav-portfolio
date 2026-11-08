"""Version shims for the installed stack (jax 0.11.2 + brax 0.14.2).

brax 0.14.2 still calls jax.device_put_replicated / device_put_sharded, which jax 0.11 turned
into deprecation errors at the top level. The implementations still exist in jax._src.api, so
re-expose them. Import this module before brax training code runs.
"""
import jax

try:
    jax.device_put_replicated  # noqa: B018
except AttributeError:
    from jax._src import api as _api

    jax.device_put_replicated = _api.device_put_replicated
    if hasattr(_api, "device_put_sharded"):
        jax.device_put_sharded = _api.device_put_sharded
