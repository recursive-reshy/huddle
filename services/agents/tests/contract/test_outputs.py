from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput, Output

output_adapter: TypeAdapter[ ChatReplyOutput | DraftArtifactOutput ] = TypeAdapter( Output )

def make_section( section_key: str, content: str = "Body" ) -> dict[ str, str ]:
    return { "section_key": section_key, "title": f"Title {section_key}", "content": content }

def test_draft_artifact_output_with_two_sections_parses_as_draft_artifact_output() -> None:
    output = output_adapter.validate_python(
        { "output_type": "draft_artifact", "draft": [ make_section( "goals" ), make_section( "scope" ) ] }
    )

    assert isinstance( output, DraftArtifactOutput )
    assert [ section.section_key for section in output.draft ] == [ "goals", "scope" ]

@pytest.mark.parametrize(
    "payload",
    [
        { "output_type": "draft_artifact", "draft": [] },
        { "output_type": "draft_artifact", "draft": [ make_section( "goals" ), make_section( "goals" ) ] },
        { "output_type": "draft_artifact", "draft": [ make_section( "goals", content = "" ) ] }
    ]
)
def test_invalid_draft_artifact_output_raises( payload: dict[ str, Any ] ) -> None:
    with pytest.raises( ValidationError ):
        output_adapter.validate_python( payload )
