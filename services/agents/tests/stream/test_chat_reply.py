import hashlib
import json
from pathlib import Path

import httpx2
import pytest
from anthropic import AsyncAnthropic
from fastapi.testclient import TestClient
from pydantic import SecretStr

from agents.config import Settings
from agents.main import create_app

sse_body = ( Path( __file__ ).parents[ 1 ] / "fixtures" / "sse" / "chat_reply.txt" ).read_text()

prompt_body = "  # PM\n\nYou are the **PM**.  \n"
prompt_bytes = f"+++\nmax_tokens = 1024\n+++\n{prompt_body}".encode()

def make_request( messages: list[ dict[ str, str ] ] ) -> dict[ str, object ]:
    return {
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
            "messages": messages,
            "task": { "notes": "", "mode": "normal" }
        }
    }

valid_request = make_request(
    [
        { "author": "pm", "kind": "chat", "content": "Welcome" },
        { "author": "human", "kind": "chat", "content": "Hi" }
    ]
)

def read_lines( content: bytes ) -> list[ dict[ str, object ] ]:
    return [ json.loads( line ) for line in content.decode().splitlines() ]

class StubbedApp:
    def __init__( self, client: TestClient, recorded_requests: list[ httpx2.Request ] ) -> None:
        self.client = client
        self.recorded_requests = recorded_requests

def build_stubbed_app( monkeypatch: pytest.MonkeyPatch, tmp_path: Path, stream_body: str ) -> StubbedApp:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    prompt_path = tmp_path / "pm" / "pm_discovery_reply.md"
    prompt_path.parent.mkdir( parents = True )
    prompt_path.write_bytes( prompt_bytes )

    recorded_requests: list[ httpx2.Request ] = []

    def respond( request: httpx2.Request ) -> httpx2.Response:
        recorded_requests.append( request )
        return httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = stream_body.encode()
        )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), prompts_dir = tmp_path ) )
    app.state.anthropic_client = AsyncAnthropic(
        api_key = "sk-test-secret",
        http_client = httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
    )

    return StubbedApp( TestClient( app ), recorded_requests )

@pytest.fixture
def stubbed_app( monkeypatch: pytest.MonkeyPatch, tmp_path: Path ) -> StubbedApp:
    return build_stubbed_app( monkeypatch, tmp_path, sse_body )

def test_stubbed_stream_produces_three_deltas_then_usage_then_result( stubbed_app: StubbedApp ) -> None:
    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )

    assert [ line[ "type" ] for line in lines ] == [ "delta", "delta", "delta", "usage", "result" ]
    assert [ line[ "text" ] for line in lines[ :3 ] ] == [ "Hello Naresh", ", what problem", " are we solving?" ]

def test_anthropic_request_uses_the_request_model_prompt_front_matter_and_assembled_turns(
    stubbed_app: StubbedApp
) -> None:
    stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    assert len( stubbed_app.recorded_requests ) == 1
    sent = json.loads( stubbed_app.recorded_requests[ 0 ].content )
    assert sent[ "model" ] == "claude-sonnet-5-5"
    assert sent[ "max_tokens" ] == 1024
    assert sent[ "system" ] == [
        { "type": "text", "text": prompt_body },
        { "type": "text", "text": "Project: My Team" }
    ]
    assert sent[ "messages" ] == [
        { "role": "user", "content": [ { "type": "text", "text": "[Earlier messages are not shown.]" } ] },
        { "role": "assistant", "content": [ { "type": "text", "text": "Welcome" } ] },
        {
            "role": "user",
            "content": [ { "type": "text", "text": "Hi", "cache_control": { "type": "ephemeral" } } ]
        }
    ]
    assert json.dumps( sent[ "messages" ] ).count( "cache_control" ) == 1

@pytest.mark.parametrize(
    ( "stream_edit", "expected_cache_write_tokens" ),
    [
        ( ( "", "" ), 20 ),
        ( ( "\"cache_creation_input_tokens\":20,", "" ), 0 ),
        ( ( "\"cache_creation_input_tokens\":20,", "\"cache_creation_input_tokens\":null," ), 0 )
    ]
)
def test_usage_line_reports_the_response_model_and_maps_all_four_counts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    stream_edit: tuple[ str, str ],
    expected_cache_write_tokens: int
) -> None:
    edited_body = sse_body.replace( stream_edit[ 0 ], stream_edit[ 1 ] ) if stream_edit[ 0 ] else sse_body
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, edited_body )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    usage = read_lines( response.content )[ 3 ]
    assert usage == {
        "type": "usage",
        "model": "claude-sonnet-5-5-20260930",
        "input_tokens": 120,
        "output_tokens": 15,
        "cache_read_tokens": 100,
        "cache_write_tokens": expected_cache_write_tokens
    }

def test_result_line_carries_the_joined_deltas_and_the_prompt_hash( stubbed_app: StubbedApp ) -> None:
    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    joined_text = "".join( str( line[ "text" ] ) for line in lines[ :3 ] )
    assert lines[ 4 ] == {
        "type": "result",
        "prompt_hash": hashlib.sha256( prompt_bytes ).hexdigest(),
        "output": { "output_type": "chat_reply", "content": joined_text }
    }

def test_messages_ending_with_an_agent_message_get_one_invalid_request_line_and_no_claude_call(
    stubbed_app: StubbedApp
) -> None:
    request_body = make_request(
        [
            { "author": "human", "kind": "chat", "content": "Hi" },
            { "author": "pm", "kind": "chat", "content": "Hello" }
        ]
    )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( request_body ) )

    lines = read_lines( response.content )
    assert len( lines ) == 1
    assert lines[ 0 ][ "type" ] == "error"
    assert lines[ 0 ][ "code" ] == "invalid_request"
    assert lines[ 0 ][ "retryable" ] is False
    assert stubbed_app.recorded_requests == []
