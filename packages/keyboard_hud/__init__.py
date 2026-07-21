"""Octowiz keyboard HUD — drive an AULA S75 Pro's screen + RGB from Claude Code hook events.

Opt-in via OCTOWIZ_KEYBOARD=1. Import-safe without hidapi/Pillow (they load only in the
detached updater process). Public entry point: `notify(data)`.
"""
from .notifier import map_event, notify

__all__ = ["notify", "map_event"]
