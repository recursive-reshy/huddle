from typing import Any, cast

from agents.contract.context import MessageKind, StepContext
from agents.runtime.context import TurnsOutcome, build_source_turn

def test_context_with_a_review_message_parses_and_renders_the_review_kind() -> None:
    context = StepContext.model_validate(
        {
            "project": { "id": "p-1", "name": "Demo" },
            "artifacts": [],
            "decisions": [],
            "draft": [],
            "questions": [],
            "messages": [ { "author": "sa", "kind": "review", "content": "Looks thin on scope." } ],
            "task": { "notes": "", "mode": "normal", "may_ask": False }
        }
    )

    result = build_source_turn( context )

    blocks = cast( list[ dict[ str, Any ] ], result.turns[ 0 ][ "content" ] )
    assert context.messages[ 0 ].kind == MessageKind.REVIEW
    assert result.outcome == TurnsOutcome.BUILT
    assert "<message author=\"sa\" kind=\"review\">\nLooks thin on scope.\n</message>" in blocks[ 0 ][ "text" ]
