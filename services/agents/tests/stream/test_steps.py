import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from agents.contract.lines import DeltaLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import ChatReplyOutput
from agents.main import create_app
from agents.roles.registry import registry
from agents.runtime.fake import fixtures_directory

step_line_adapter: TypeAdapter[ StepLine ] = TypeAdapter( StepLine )

fixture_path = fixtures_directory / "pm" / "pm_discovery_reply.json"

valid_request: dict[ str, object ] = {
    "job_id": 7,
    "attempt": 1,
    "kind": "pm_discovery_reply",
    "agent": "pm",
    "model": "claude-sonnet-5-5",
    "context": {
        "project": { "id": "p-1", "name": "My Team" },
        "artifacts": [],
        "decisions": [],
        "draft": [],
        "questions": [],
        "messages": [],
        "task": { "notes": "hello", "mode": "normal", "may_ask": False }
    }
}

@pytest.fixture
def client( monkeypatch: pytest.MonkeyPatch ) -> TestClient:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    return TestClient( create_app() )

def read_lines( content: bytes ) -> list[ dict[ str, object ] ]:
    return [ json.loads( line ) for line in content.decode().splitlines() ]

def test_body_that_is_not_json_gets_one_invalid_request_line( client: TestClient ) -> None:
    response = client.post( "/v1/steps", content = b"this is not json" )

    lines = read_lines( response.content )

    assert response.status_code == 200
    assert response.headers[ "content-type" ].startswith( "application/x-ndjson" )
    assert len( lines ) == 1
    assert lines[ 0 ][ "type" ] == "error"
    assert lines[ 0 ][ "code" ] == "invalid_request"
    assert lines[ 0 ][ "retryable" ] is False

def test_request_missing_model_gets_one_invalid_request_line_with_error_count( client: TestClient ) -> None:
    body = { key: value for key, value in valid_request.items() if key != "model" }

    response = client.post( "/v1/steps", content = json.dumps( body ) )

    lines = read_lines( response.content )

    assert response.status_code == 200
    assert len( lines ) == 1
    assert lines[ 0 ][ "type" ] == "error"
    assert lines[ 0 ][ "code" ] == "invalid_request"
    assert lines[ 0 ][ "retryable" ] is False
    assert "1 errors" in str( lines[ 0 ][ "message" ] )

@pytest.mark.parametrize(
    ( "agent", "kind" ),
    [ ( "pm", "sa_draft_trd" ), ( "dba", "dba_anything" ) ]
)
def test_unregistered_pair_gets_one_unknown_kind_line( client: TestClient, agent: str, kind: str ) -> None:
    body = { **valid_request, "agent": agent, "kind": kind }

    response = client.post( "/v1/steps", content = json.dumps( body ) )

    lines = read_lines( response.content )

    assert response.status_code == 200
    assert response.headers[ "content-type" ].startswith( "application/x-ndjson" )
    assert len( lines ) == 1
    assert lines[ 0 ][ "type" ] == "error"
    assert lines[ 0 ][ "code" ] == "unknown_kind"
    assert lines[ 0 ][ "retryable" ] is False
    assert agent in str( lines[ 0 ][ "message" ] )
    assert kind in str( lines[ 0 ][ "message" ] )

def test_fake_stream_is_deltas_then_one_usage_then_one_result( client: TestClient ) -> None:
    response = client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = [ step_line_adapter.validate_json( line ) for line in response.content.decode().splitlines() ]
    line_types = [ type( line ) for line in lines ]

    assert response.status_code == 200
    assert len( lines ) >= 3
    assert line_types[ -2: ] == [ UsageLine, ResultLine ]
    assert all( line_type is DeltaLine for line_type in line_types[ :-2 ] )

def read_fake_lines( client: TestClient ) -> list[ DeltaLine | UsageLine | ResultLine ]:
    response = client.post( "/v1/steps", content = json.dumps( valid_request ) )
    lines = [ step_line_adapter.validate_json( line ) for line in response.content.decode().splitlines() ]

    return [ line for line in lines if isinstance( line, ( DeltaLine, UsageLine, ResultLine ) ) ]

def test_fake_deltas_joined_equal_result_content( client: TestClient ) -> None:
    lines = read_fake_lines( client )

    joined_text = "".join( line.text for line in lines if isinstance( line, DeltaLine ) )
    result = lines[ -1 ]

    assert isinstance( result, ResultLine )
    assert isinstance( result.output, ChatReplyOutput )
    assert joined_text == result.output.content

def test_fake_usage_line_is_zero_cost( client: TestClient ) -> None:
    lines = read_fake_lines( client )

    usage = lines[ -2 ]

    assert isinstance( usage, UsageLine )
    assert usage.model == "fake"
    assert usage.input_tokens == 0
    assert usage.output_tokens == 0
    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0

def test_fake_result_hashes_the_fixture_file( client: TestClient ) -> None:
    lines = read_fake_lines( client )

    result = lines[ -1 ]

    assert isinstance( result, ResultLine )
    assert result.prompt_hash == hashlib.sha256( fixture_path.read_bytes() ).hexdigest()
    assert result.output.output_type == "chat_reply"

@pytest.mark.parametrize( ( "agent", "kind" ), list( registry ) )
def test_every_registered_pair_has_a_fixture_that_validates( agent: str, kind: str ) -> None:
    fixture = Path( fixtures_directory / agent / f"{kind}.json" )

    output = registry[ ( agent, kind ) ].output_type.model_validate_json( fixture.read_bytes() )

    assert output is not None
