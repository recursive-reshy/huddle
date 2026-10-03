import asyncio
import hashlib
import json
from collections.abc import AsyncIterator, Callable, MutableMapping
from pathlib import Path
from typing import Any

import httpx2
import pytest
from anthropic import AsyncAnthropic
from fastapi import FastAPI
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
            "task": { "notes": "", "mode": "normal", "may_ask": False }
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
    def __init__( self, app: FastAPI, recorded_requests: list[ httpx2.Request ] ) -> None:
        self.app = app
        self.client = TestClient( app )
        self.recorded_requests = recorded_requests

def build_stubbed_app(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    stream_body: str,
    respond_override: Callable[ [ httpx2.Request ], httpx2.Response ] | None = None
) -> StubbedApp:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    prompt_path = tmp_path / "pm" / "pm_discovery_reply.md"
    prompt_path.parent.mkdir( parents = True )
    prompt_path.write_bytes( prompt_bytes )

    recorded_requests: list[ httpx2.Request ] = []

    def respond( request: httpx2.Request ) -> httpx2.Response:
        recorded_requests.append( request )
        if respond_override is not None:
            return respond_override( request )

        return httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = stream_body.encode()
        )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), prompts_dir = tmp_path ) )
    app.state.anthropic_client = AsyncAnthropic(
        api_key = "sk-test-secret",
        max_retries = 0,
        http_client = httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
    )

    return StubbedApp( app, recorded_requests )

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

def assert_ends_with_one_terminal_line( lines: list[ dict[ str, object ] ] ) -> None:
    terminal_types = [ line[ "type" ] for line in lines if line[ "type" ] in ( "result", "error" ) ]
    assert len( terminal_types ) == 1
    assert lines[ -1 ][ "type" ] == terminal_types[ 0 ]

def make_status_response( status: int ) -> Callable[ [ httpx2.Request ], httpx2.Response ]:
    return lambda request: httpx2.Response(
        status,
        json = { "type": "error", "error": { "type": "api_error", "message": "request content echo" } }
    )

def raise_connection_error( request: httpx2.Request ) -> httpx2.Response:
    raise httpx2.ConnectError( "connection refused", request = request )

@pytest.mark.parametrize(
    ( "respond_override", "expected_code" ),
    [
        ( make_status_response( 429 ), "rate_limited" ),
        ( make_status_response( 529 ), "overloaded" ),
        ( make_status_response( 500 ), "upstream_error" ),
        ( raise_connection_error, "upstream_error" )
    ],
    ids = [ "429", "529", "500", "connection_error" ]
)
def test_retryable_anthropic_failures_become_one_retryable_error_line_and_no_usage(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    respond_override: Callable[ [ httpx2.Request ], httpx2.Response ],
    expected_code: str
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, sse_body, respond_override )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "error" ]
    assert lines[ 0 ][ "code" ] == expected_code
    assert lines[ 0 ][ "retryable" ] is True
    assert "sk-test-secret" not in str( lines[ 0 ][ "message" ] )
    assert_ends_with_one_terminal_line( lines )

@pytest.mark.parametrize(
    ( "status", "expected_code" ),
    [
        ( 400, "upstream_rejected" ),
        ( 404, "upstream_rejected" ),
        ( 413, "upstream_rejected" ),
        ( 401, "auth_failed" ),
        ( 403, "auth_failed" )
    ]
)
def test_non_retryable_anthropic_rejections_become_one_non_retryable_error_line(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    status: int,
    expected_code: str
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, sse_body, make_status_response( status ) )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "error" ]
    assert lines[ 0 ][ "code" ] == expected_code
    assert lines[ 0 ][ "retryable" ] is False
    assert f"HTTP {status}" in str( lines[ 0 ][ "message" ] )
    assert "request content echo" not in str( lines[ 0 ][ "message" ] )
    assert_ends_with_one_terminal_line( lines )

def test_stream_ending_with_max_tokens_gets_deltas_one_usage_and_a_truncated_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    truncated_body = sse_body.replace( "\"stop_reason\":\"end_turn\"", "\"stop_reason\":\"max_tokens\"" )
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, truncated_body )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "delta", "delta", "delta", "usage", "error" ]
    assert lines[ 4 ][ "code" ] == "truncated"
    assert lines[ 4 ][ "retryable" ] is False
    assert "1024" in str( lines[ 4 ][ "message" ] )
    assert_ends_with_one_terminal_line( lines )

def test_stream_with_no_text_blocks_gets_one_usage_and_a_retryable_empty_reply_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    text_block_start = sse_body.index( "event: content_block_start" )
    text_block_stop = sse_body.index( "event: message_delta" )
    empty_body = sse_body[ :text_block_start ] + sse_body[ text_block_stop: ]
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, empty_body )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "usage", "error" ]
    assert lines[ 1 ][ "code" ] == "empty_reply"
    assert lines[ 1 ][ "retryable" ] is True
    assert_ends_with_one_terminal_line( lines )

def test_stream_ending_with_refusal_gets_one_usage_and_a_non_retryable_refused_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    refused_body = sse_body.replace( "\"stop_reason\":\"end_turn\"", "\"stop_reason\":\"refusal\"" )
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, refused_body )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "delta", "delta", "delta", "usage", "error" ]
    assert lines[ 4 ][ "code" ] == "refused"
    assert lines[ 4 ][ "retryable" ] is False
    assert_ends_with_one_terminal_line( lines )

def respond_with_dropped_stream( kept_body: str ) -> Callable[ [ httpx2.Request ], httpx2.Response ]:
    async def dropped_body() -> AsyncIterator[ bytes ]:
        yield kept_body.encode()
        raise httpx2.ReadError( "connection reset" )

    return lambda request: httpx2.Response(
        200,
        headers = { "content-type": "text/event-stream" },
        content = dropped_body()
    )

def test_stream_dropping_after_two_deltas_gets_the_deltas_one_usage_and_a_retryable_upstream_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    third_delta_start = sse_body.index( "event: content_block_delta", sse_body.index( ", what problem" ) )
    stubbed_app = build_stubbed_app(
        monkeypatch,
        tmp_path,
        sse_body,
        respond_with_dropped_stream( sse_body[ :third_delta_start ] )
    )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "delta", "delta", "usage", "error" ]
    assert lines[ 2 ][ "input_tokens" ] == 120
    assert lines[ 2 ][ "output_tokens" ] == 1
    assert lines[ 3 ][ "code" ] == "upstream_error"
    assert lines[ 3 ][ "retryable" ] is True
    assert_ends_with_one_terminal_line( lines )

def test_stream_dropping_before_message_start_gets_no_usage_line(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, sse_body, respond_with_dropped_stream( "" ) )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "error" ]
    assert lines[ 0 ][ "code" ] == "upstream_error"

def test_unexpected_exception_in_the_step_gets_one_internal_error_line_and_is_logged(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, sse_body )

    def raise_unexpected_error( messages: object ) -> None:
        raise RuntimeError( "turn building exploded" )

    monkeypatch.setattr( "agents.main.build_turns", raise_unexpected_error )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert response.status_code == 200
    assert [ line[ "type" ] for line in lines ] == [ "error" ]
    assert lines[ 0 ][ "code" ] == "internal_error"
    assert lines[ 0 ][ "retryable" ] is False
    assert "turn building exploded" not in str( lines[ 0 ][ "message" ] )
    assert stubbed_app.recorded_requests == []
    assert any( record.exc_info is not None and "turn building exploded" in str( record.exc_info[ 1 ] ) for record in caplog.records )
    assert_ends_with_one_terminal_line( lines )

@pytest.mark.anyio
async def test_client_disconnect_after_the_first_delta_closes_the_anthropic_stream_and_writes_nothing_more(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    first_delta_end = sse_body.index( "event: content_block_delta", sse_body.index( "Hello Naresh" ) )
    upstream_closed = asyncio.Event()

    async def stalled_body() -> AsyncIterator[ bytes ]:
        try:
            yield sse_body[ :first_delta_end ].encode()
            await asyncio.Event().wait()
        finally:
            upstream_closed.set()

    stubbed_app = build_stubbed_app(
        monkeypatch,
        tmp_path,
        sse_body,
        lambda request: httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = stalled_body()
        )
    )
    body_bytes = json.dumps( valid_request ).encode()
    sent_messages: list[ MutableMapping[ str, Any ] ] = []
    has_sent_first_delta = asyncio.Event()
    request_body_sent = False

    async def receive() -> MutableMapping[ str, Any ]:
        nonlocal request_body_sent
        if not request_body_sent:
            request_body_sent = True
            return { "type": "http.request", "body": body_bytes, "more_body": False }

        await has_sent_first_delta.wait()
        return { "type": "http.disconnect" }

    async def send( message: MutableMapping[ str, Any ] ) -> None:
        sent_messages.append( message )
        if message[ "type" ] == "http.response.body" and message.get( "body" ):
            has_sent_first_delta.set()

    scope: dict[ str, Any ] = {
        "type": "http",
        "asgi": { "version": "3.0" },
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/steps",
        "raw_path": b"/v1/steps",
        "query_string": b"",
        "headers": [],
        "client": ( "testclient", 50000 ),
        "server": ( "testserver", 80 )
    }

    await asyncio.wait_for( stubbed_app.app( scope, receive, send ), timeout = 5 )

    assert upstream_closed.is_set()
    bodies = [ message[ "body" ] for message in sent_messages if message[ "type" ] == "http.response.body" and message.get( "body" ) ]
    assert [ json.loads( body )[ "type" ] for body in bodies ] == [ "delta" ]

def test_unmapped_anthropic_status_becomes_a_logged_non_retryable_internal_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, sse_body, make_status_response( 409 ) )

    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( valid_request ) )

    lines = read_lines( response.content )
    assert [ line[ "type" ] for line in lines ] == [ "error" ]
    assert lines[ 0 ][ "code" ] == "internal_error"
    assert lines[ 0 ][ "retryable" ] is False
    assert "HTTP 409" in str( lines[ 0 ][ "message" ] )
    assert any( record.exc_info is not None for record in caplog.records )
