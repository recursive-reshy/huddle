import pytest

from agents.roles.sections import BRIEF_SECTION_KEYS
from agents.runtime.draft import DraftOutcome, validate_draft

def make_draft( section_keys: list[ str ] ) -> dict[ str, object ]:
    return {
        "draft": [
            { "section_key": section_key, "title": section_key.title(), "content": f"Content for {section_key}" }
            for section_key in section_keys
        ]
    }

def test_draft_with_all_keys_in_order_passes() -> None:
    validation = validate_draft( make_draft( list( BRIEF_SECTION_KEYS ) ), BRIEF_SECTION_KEYS )

    assert validation.outcome == DraftOutcome.VALID
    assert [ section.section_key for section in validation.draft ] == list( BRIEF_SECTION_KEYS )
    assert validation.errors == []

def without( section_key: str ) -> list[ str ]:
    return [ key for key in BRIEF_SECTION_KEYS if key != section_key ]

def swapped( first: str, second: str ) -> list[ str ]:
    keys = list( BRIEF_SECTION_KEYS )
    first_index, second_index = keys.index( first ), keys.index( second )
    keys[ first_index ], keys[ second_index ] = keys[ second_index ], keys[ first_index ]

    return keys

@pytest.mark.parametrize(
    ( "section_keys", "expected_error" ),
    [
        ( without( "scope_later" ), "missing section: scope_later" ),
        ( [ *BRIEF_SECTION_KEYS, "risks" ], "unknown section: risks" ),
        ( [ *BRIEF_SECTION_KEYS, "goals" ], "duplicate section: goals" ),
        ( swapped( "problem", "goals" ), "section out of order: goals before problem" )
    ],
    ids = [ "missing", "unknown", "duplicate", "out_of_order" ]
)
def test_draft_with_a_missing_unknown_duplicate_or_out_of_order_key_fails_naming_the_key(
    section_keys: list[ str ],
    expected_error: str
) -> None:
    validation = validate_draft( make_draft( section_keys ), BRIEF_SECTION_KEYS )

    assert validation.outcome == DraftOutcome.INVALID
    assert validation.errors == [ expected_error ]

def test_tool_input_that_does_not_parse_fails_with_the_failing_field() -> None:
    validation = validate_draft( { "draft": [ { "section_key": "summary", "title": "Summary" } ] }, BRIEF_SECTION_KEYS )

    assert validation.outcome == DraftOutcome.INVALID
    assert len( validation.errors ) == 1
    assert "draft.0.content" in validation.errors[ 0 ]
