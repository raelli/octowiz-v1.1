"""Tests for the Python execution-policy defence boundary."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from execution_policy import normalize_execution_policy


class TestExecutionPolicy(unittest.TestCase):
    def test_defaults_to_advisor(self):
        self.assertEqual(normalize_execution_policy(None)["pattern"], "advisor")

    def test_accepts_bounded_workflow(self):
        policy = {
            "pattern": "workflow",
            "partitionable": True,
            "scope": "one worker per route",
            "verification": "cross-check findings",
            "maxAgents": 4,
            "plannerModel": "fable",
            "workerModel": "sonnet",
            "synthesizerModel": "fable",
            "effort": "ultracode",
            "writes": False,
            "isolation": "none",
        }
        self.assertEqual(normalize_execution_policy(policy), policy)

    def test_rejects_writes_without_worktree(self):
        with self.assertRaisesRegex(ValueError, "worktree"):
            normalize_execution_policy({
                "pattern": "workflow",
                "partitionable": True,
                "scope": "one worker per file",
                "verification": "run tests",
                "maxAgents": 4,
                "plannerModel": "fable",
                "workerModel": "sonnet",
                "synthesizerModel": "fable",
                "effort": "ultracode",
                "writes": True,
                "isolation": "none",
            })
