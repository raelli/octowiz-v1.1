import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from import_litellm_memories import load_memories, validate_memories, rewrite_namespace


class TestValidateMemories(unittest.TestCase):
    def test_valid_memories_pass(self):
        memories = [{"key": "k1", "value": "v1"}, {"key": "k2", "value": "v2"}]
        validate_memories(memories)  # must not raise or exit

    def test_missing_value_exits_1(self):
        memories = [{"key": "k1"}]
        with self.assertRaises(SystemExit) as ctx:
            validate_memories(memories)
        self.assertEqual(ctx.exception.code, 1)

    def test_missing_key_exits_1(self):
        memories = [{"value": "v1"}]
        with self.assertRaises(SystemExit) as ctx:
            validate_memories(memories)
        self.assertEqual(ctx.exception.code, 1)

    def test_empty_key_exits_1(self):
        memories = [{"key": "", "value": "v1"}]
        with self.assertRaises(SystemExit) as ctx:
            validate_memories(memories)
        self.assertEqual(ctx.exception.code, 1)

    def test_non_string_value_exits_1(self):
        memories = [{"key": "k1", "value": 42}]
        with self.assertRaises(SystemExit) as ctx:
            validate_memories(memories)
        self.assertEqual(ctx.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
