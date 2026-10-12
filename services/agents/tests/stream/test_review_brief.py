import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2
import pytest
from anthropic import AsyncAnthropic
from fastapi.testclient import TestClient
from pydantic import SecretStr

from agents.config import Settings
from agents.contract.context import StepContext
from agents.contract.outputs import ReviewOutput
from agents.main import create_app
from agents.runtime.context import build_source_turn

prompt_path = Path( __file__ ).parents[ 2 ] / "prompts" / "sa" / "sa_review_brief.md"

def make_section( section_key: str ) -> dict[ str, object ]:
    return {
        "artifact_id": "a-1",
        "version": 1,
        "kind": "brief",
        "section_key": section_key,
        "title": f"Title {section_key}",
        "content": f"Content {section_key}"
    }

review_request: dict[ str, object ] = {
    "job_id": 21,
    "attempt": 1,
    "kind": "sa_review_brief",
    "agent": "sa",
    "model": "claude-sonnet-5-5",
    "context": {
        "project": { "id": "p-1", "name": "Demo" },
        "artifacts": [ make_section( "summary" ), make_section( "goals" ) ],
        "decisions": [],
        "draft": [],
        "questions": [],
        "messages": [],
        "task": { "notes": "", "mode": "normal", "may_ask": False }
    }
}

def make_review_input( question_count: int ) -> dict[ str, object ]:
    return {
        "notes": "The brief is clear on goals but thin on scope.",
        "questions": [ { "question": f"Question {number}?" } for number in range( question_count ) ]
    }

def make_sse_body( tool_input: dict[ str, object ], tool_use_id: str = "toolu_01" ) -> str:
    input_json = json.dumps( tool_input )
    middle = len( input_json ) // 2

    def event( name: str, data: dict[ str, object ] ) -> str:
        return f"event: {name}\ndata: {json.dumps( data )}\n\n"

    events = [
        event(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_test_01",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-sonnet-5-5-20260930",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": { "input_tokens": 300, "output_tokens": 1 }
                }
            }
        ),
        event(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": tool_use_id, "name": "submit_review", "input": {} }
            }
        ),
        event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": input_json[ :middle ] }
            }
        ),
        event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": input_json[ middle: ] }
            }
        ),
        event( "content_block_stop", { "type": "content_block_stop", "index": 0 } ),
        event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": { "stop_reason": "tool_use", "stop_sequence": None },
                "usage": { "output_tokens": 400 }
            }
        ),
        event( "message_stop", { "type": "message_stop" } )
    ]

    return "".join( events )

class StubbedApp:
    def __init__( self, client: TestClient, recorded_requests: list[ httpx2.Request ] ) -> None:
        self.client = client
        self.recorded_requests = recorded_requests

def build_stubbed_app( monkeypatch: pytest.MonkeyPatch, response_bodies: list[ str ] ) -> StubbedApp:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    recorded_requests: list[ httpx2.Request ] = []

    def respond( request: httpx2.Request ) -> httpx2.Response:
        recorded_requests.append( request )

        return httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = response_bodies[ len( recorded_requests ) - 1 ].encode()
        )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ) ) )
    app.state.anthropic_client = AsyncAnthropic(
        api_key = "sk-test-secret",
        max_retries = 0,
        http_client = httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
    )

    return StubbedApp( TestClient( app ), recorded_requests )

def post_request( stubbed_app: StubbedApp ) -> list[ dict[ str, Any ] ]:
    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( review_request ) )

    return [ json.loads( line ) for line in response.content.decode().splitlines() ]

def test_valid_submit_review_call_gets_one_usage_then_one_review_result_and_no_delta(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( make_review_input( 3 ) ) ] )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "result" ]
    assert lines[ 1 ][ "prompt_hash" ] == hashlib.sha256( prompt_path.read_bytes() ).hexdigest()
    assert lines[ 1 ][ "output" ][ "output_type" ] == "review"
    output = ReviewOutput.model_validate( lines[ 1 ][ "output" ] )
    assert len( output.questions ) == 3

def test_recorded_request_offers_only_submit_review_with_auto_choice_and_the_artifacts_only_source_turn(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( make_review_input( 3 ) ) ] )

    post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 1
    sent = json.loads( stubbed_app.recorded_requests[ 0 ].content )
    assert [ tool[ "name" ] for tool in sent[ "tools" ] ] == [ "submit_review" ]
    assert sent[ "tool_choice" ] == { "type": "auto" }
    source_turn = build_source_turn( StepContext.model_validate( review_request[ "context" ] ) )
    assert sent[ "messages" ] == source_turn.turns
    assert len( sent[ "messages" ][ 0 ][ "content" ] ) == 1

def test_eleven_questions_are_retried_with_an_error_tool_result_naming_the_count_and_the_limit(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [
            make_sse_body( make_review_input( 11 ), tool_use_id = "toolu_first" ),
            make_sse_body( make_review_input( 10 ), tool_use_id = "toolu_second" )
        ]
    )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "result" ]
    second_sent = json.loads( stubbed_app.recorded_requests[ 1 ].content )
    tool_result = second_sent[ "messages" ][ -1 ][ "content" ][ 0 ]
    assert tool_result[ "type" ] == "tool_result"
    assert tool_result[ "tool_use_id" ] == "toolu_first"
    assert tool_result[ "is_error" ] is True
    assert "11 > 10" in tool_result[ "content" ]

def test_two_invalid_reviews_get_two_usage_lines_then_a_non_retryable_validation_failed_error(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [ make_sse_body( make_review_input( 11 ) ), make_sse_body( make_review_input( 11 ) ) ]
    )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 2
    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "error" ]
    assert lines[ 2 ][ "code" ] == "validation_failed"
    assert lines[ 2 ][ "retryable" ] is False
    assert "11 > 10" in lines[ 2 ][ "message" ]

def make_clock( seconds_after_two_calls: float ) -> Callable[ [], float ]:
    call_count = 0

    def clock() -> float:
        nonlocal call_count
        call_count += 1

        return 0.0 if call_count <= 2 else seconds_after_two_calls

    return clock

def test_a_16_second_gap_between_stream_events_writes_a_heartbeat_before_usage(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr( "agents.runtime.draft.monotonic", make_clock( 16.0 ) )
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( make_review_input( 3 ) ) ] )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "heartbeat", "usage", "result" ]
