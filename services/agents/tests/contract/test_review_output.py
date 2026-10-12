from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from agents.contract.outputs import Output, ReviewOutput

review_adapter: TypeAdapter[ Any ] = TypeAdapter( Output )

def make_review( question_count: int, notes: str = "Notes" ) -> dict[ str, Any ]:
    return {
        "output_type": "review",
        "notes": notes,
        "questions": [ { "question": f"Question {number}?" } for number in range( question_count ) ]
    }

@pytest.mark.parametrize( "question_count", [ 0, 10 ] )
def test_review_with_zero_or_ten_questions_parses_as_review_output( question_count: int ) -> None:
    output = review_adapter.validate_python( make_review( question_count ) )

    assert isinstance( output, ReviewOutput )
    assert len( output.questions ) == question_count

@pytest.mark.parametrize(
    "payload",
    [
        make_review( 11 ),
        make_review( 1, notes = "" ),
        { **make_review( 0 ), "questions": [ { "question": "" } ] }
    ]
)
def test_review_with_eleven_questions_empty_notes_or_an_empty_question_raises( payload: dict[ str, Any ] ) -> None:
    with pytest.raises( ValidationError ):
        review_adapter.validate_python( payload )
