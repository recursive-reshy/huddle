import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agents.contract.outputs import ReviewOutput
from agents.main import create_app
from agents.roles.registry import registry
from agents.runtime.fake import fixtures_directory

def make_request( project_name: str, agent: str = "sa", kind: str = "sa_review_brief" ) -> dict[ str, object ]:
    return {
        "job_id": 31,
        "attempt": 1,
        "kind": kind,
        "agent": agent,
        "model": "claude-sonnet-5-5",
        "context": {
            "project": { "id": "p-1", "name": project_name },
            "artifacts": [],
            "decisions": [],
            "draft": [],
            "questions": [],
            "messages": [],
            "task": { "notes": "", "mode": "normal", "may_ask": False }
        }
    }

@pytest.fixture
def client( monkeypatch: pytest.MonkeyPatch ) -> TestClient:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    return TestClient( create_app() )

def post_lines( client: TestClient, request_body: dict[ str, object ] ) -> list[ dict[ str, object ] ]:
    response = client.post( "/v1/steps", content = json.dumps( request_body ) )

    return [ json.loads( line ) for line in response.content.decode().splitlines() ]

def test_fake_review_is_a_heartbeat_then_zero_usage_then_a_review_result_with_no_delta( client: TestClient ) -> None:
    lines = post_lines( client, make_request( "Demo" ) )

    assert [ line[ "type" ] for line in lines ] == [ "heartbeat", "usage", "result" ]
    assert lines[ 1 ][ "model" ] == "fake"

@pytest.mark.parametrize(
    ( "project_name", "expected_question_count" ),
    [
        ( "Demo", 3 ),
        ( "Demo [no-questions]", 0 ),
        ( "Demo [no-such-variant]", 3 )
    ]
)
def test_fake_review_fixture_follows_the_bracketed_variant_in_the_project_name_and_falls_back_to_the_default(
    client: TestClient,
    project_name: str,
    expected_question_count: int
) -> None:
    lines = post_lines( client, make_request( project_name ) )

    output = ReviewOutput.model_validate( lines[ -1 ][ "output" ] )
    assert len( output.questions ) == expected_question_count

def test_variant_with_path_characters_is_ignored_and_the_default_fixture_is_used( client: TestClient ) -> None:
    lines = post_lines( client, make_request( "Demo [../pm/pm_draft_brief]" ) )

    output = ReviewOutput.model_validate( lines[ -1 ][ "output" ] )
    assert len( output.questions ) == 3

def all_fixture_paths() -> list[ Path ]:
    return sorted( fixtures_directory.glob( "*/*.json" ) )

@pytest.mark.parametrize( "fixture_path", all_fixture_paths(), ids = lambda path: f"{path.parent.name}/{path.name}" )
def test_every_fixture_and_variant_validates_as_its_registered_output_type( fixture_path: Path ) -> None:
    kind = fixture_path.name.split( "." )[ 0 ]

    output = registry[ ( fixture_path.parent.name, kind ) ].output_type.model_validate_json( fixture_path.read_bytes() )

    assert output is not None

def test_fixtures_exist_for_both_review_variants() -> None:
    names = sorted( path.name for path in ( fixtures_directory / "sa" ).glob( "*.json" ) )

    assert names == [ "sa_review_brief.json", "sa_review_brief.no-questions.json" ]
