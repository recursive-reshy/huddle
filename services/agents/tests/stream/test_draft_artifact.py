import hashlib
import json
from collections.abc import Callable
from pathlib import Path

import httpx2
import pytest
from anthropic import AsyncAnthropic
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from agents.config import Settings
from agents.contract.context import StepContext
from agents.contract.outputs import DraftArtifactOutput
from agents.main import create_app
from agents.roles.sections import BRIEF_SECTION_KEYS
from agents.runtime.context import build_source_turn
from agents.runtime.draft import MISSING_TOOL_CALL_NOTICE, DraftOutcome, validate_draft

prompt_path = Path( __file__ ).parents[ 2 ] / "prompts" / "pm" / "pm_draft_brief.md"

def make_request( messages: list[ dict[ str, str ] ] ) -> dict[ str, object ]:
    return {
        "job_id": 9,
        "attempt": 1,
        "kind": "pm_draft_brief",
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
        { "author": "pm", "kind": "chat", "content": "What problem are we solving?" },
        { "author": "human", "kind": "chat", "content": "Briefs take me a week to write." }
    ]
)

def read_lines( content: bytes ) -> list[ dict[ str, object ] ]:
    return [ json.loads( line ) for line in content.decode().splitlines() ]

def make_draft_input( section_keys: list[ str ] ) -> dict[ str, object ]:
    return {
        "draft": [
            { "section_key": section_key, "title": section_key.title(), "content": f"Content for {section_key}" }
            for section_key in section_keys
        ]
    }

def make_sse_body(
    section_keys: list[ str ],
    stop_reason: str = "tool_use",
    tool_use_id: str = "toolu_01",
    text: str = "",
    has_tool_call: bool = True
) -> str:
    input_json = json.dumps( make_draft_input( section_keys ) )
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
        )
    ]
    index = 0

    if text != "":
        events += [
            event(
                "content_block_start",
                { "type": "content_block_start", "index": index, "content_block": { "type": "text", "text": "" } }
            ),
            event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "text_delta", "text": text }
                }
            ),
            event( "content_block_stop", { "type": "content_block_stop", "index": index } )
        ]
        index += 1

    if has_tool_call:
        events += [
            event(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "tool_use", "id": tool_use_id, "name": "submit_draft", "input": {} }
                }
            ),
            event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "input_json_delta", "partial_json": input_json[ :middle ] }
                }
            ),
            event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "input_json_delta", "partial_json": input_json[ middle: ] }
                }
            ),
            event( "content_block_stop", { "type": "content_block_stop", "index": index } )
        ]

    events += [
        event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": { "stop_reason": stop_reason, "stop_sequence": None },
                "usage": { "output_tokens": 900 }
            }
        ),
        event( "message_stop", { "type": "message_stop" } )
    ]

    return "".join( events )

class StubbedApp:
    def __init__( self, app: FastAPI, recorded_requests: list[ httpx2.Request ] ) -> None:
        self.app = app
        self.client = TestClient( app )
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

    return StubbedApp( app, recorded_requests )

def post_request( stubbed_app: StubbedApp, request_body: dict[ str, object ] = valid_request ) -> list[ dict[ str, object ] ]:
    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( request_body ) )

    return read_lines( response.content )

def test_valid_tool_call_gets_one_usage_then_one_draft_result_and_no_delta( monkeypatch: pytest.MonkeyPatch ) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( list( BRIEF_SECTION_KEYS ) ) ] )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "result" ]
    assert lines[ 0 ] == {
        "type": "usage",
        "model": "claude-sonnet-5-5-20260930",
        "input_tokens": 300,
        "output_tokens": 900,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0
    }
    assert lines[ 1 ][ "prompt_hash" ] == hashlib.sha256( prompt_path.read_bytes() ).hexdigest()
    output = DraftArtifactOutput.model_validate( lines[ 1 ][ "output" ] )
    assert [ section.section_key for section in output.draft ] == list( BRIEF_SECTION_KEYS )

def test_recorded_request_offers_the_submit_draft_tool_with_auto_choice_with_the_front_matter_max_tokens_and_the_source_turn(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( list( BRIEF_SECTION_KEYS ) ) ] )

    post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 1
    sent = json.loads( stubbed_app.recorded_requests[ 0 ].content )
    assert [ tool[ "name" ] for tool in sent[ "tools" ] ] == [ "submit_draft" ]
    assert sent[ "tool_choice" ] == { "type": "auto" }
    assert sent[ "max_tokens" ] == 8192
    source_turn = build_source_turn( StepContext.model_validate( valid_request[ "context" ] ) )
    assert sent[ "messages" ] == source_turn.turns

def without( section_key: str ) -> list[ str ]:
    return [ key for key in BRIEF_SECTION_KEYS if key != section_key ]

def test_invalid_first_draft_is_retried_with_the_tool_use_turn_and_an_error_tool_result_naming_the_key(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [
            make_sse_body( without( "scope_later" ), tool_use_id = "toolu_first" ),
            make_sse_body( list( BRIEF_SECTION_KEYS ), tool_use_id = "toolu_second" )
        ]
    )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "result" ]
    assert len( stubbed_app.recorded_requests ) == 2
    first_sent = json.loads( stubbed_app.recorded_requests[ 0 ].content )
    second_sent = json.loads( stubbed_app.recorded_requests[ 1 ].content )
    assert second_sent[ "messages" ][ :-2 ] == first_sent[ "messages" ]
    assistant_turn, tool_result_turn = second_sent[ "messages" ][ -2: ]
    assert assistant_turn[ "role" ] == "assistant"
    assert assistant_turn[ "content" ] == [
        {
            "type": "tool_use",
            "id": "toolu_first",
            "name": "submit_draft",
            "input": make_draft_input( without( "scope_later" ) )
        }
    ]
    assert tool_result_turn[ "role" ] == "user"
    assert len( tool_result_turn[ "content" ] ) == 1
    tool_result = tool_result_turn[ "content" ][ 0 ]
    assert tool_result[ "type" ] == "tool_result"
    assert tool_result[ "tool_use_id" ] == "toolu_first"
    assert tool_result[ "is_error" ] is True
    assert "missing section: scope_later" in tool_result[ "content" ]

def test_two_invalid_drafts_get_two_usage_lines_then_a_non_retryable_validation_failed_error(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [ make_sse_body( without( "scope_later" ) ), make_sse_body( without( "scope_later" ) ) ]
    )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 2
    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "error" ]
    assert lines[ 2 ][ "code" ] == "validation_failed"
    assert lines[ 2 ][ "retryable" ] is False
    assert "missing section: scope_later" in str( lines[ 2 ][ "message" ] )

def test_stream_ending_with_max_tokens_gets_one_request_one_usage_and_a_truncated_error(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [ make_sse_body( without( "scope_later" ), stop_reason = "max_tokens" ) ]
    )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 1
    assert [ line[ "type" ] for line in lines ] == [ "usage", "error" ]
    assert lines[ 1 ][ "code" ] == "truncated"
    assert lines[ 1 ][ "retryable" ] is False
    assert "8192" in str( lines[ 1 ][ "message" ] )

def test_stream_ending_with_refusal_gets_one_request_and_a_refused_error( monkeypatch: pytest.MonkeyPatch ) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( [], stop_reason = "refusal" ) ] )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 1
    assert [ line[ "type" ] for line in lines ] == [ "usage", "error" ]
    assert lines[ 1 ][ "code" ] == "refused"
    assert lines[ 1 ][ "retryable" ] is False

def test_text_only_first_response_is_retried_with_the_assistant_text_and_the_missing_tool_call_notice(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [
            make_sse_body( [], stop_reason = "end_turn", text = "Here is the brief you asked for.", has_tool_call = False ),
            make_sse_body( list( BRIEF_SECTION_KEYS ) )
        ]
    )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "result" ]
    assert len( stubbed_app.recorded_requests ) == 2
    first_sent = json.loads( stubbed_app.recorded_requests[ 0 ].content )
    second_sent = json.loads( stubbed_app.recorded_requests[ 1 ].content )
    assert second_sent[ "messages" ][ :-2 ] == first_sent[ "messages" ]
    assert second_sent[ "messages" ][ -2: ] == [
        { "role": "assistant", "content": [ { "type": "text", "text": "Here is the brief you asked for." } ] },
        { "role": "user", "content": [ { "type": "text", "text": MISSING_TOOL_CALL_NOTICE } ] }
    ]

def test_two_text_only_responses_get_two_requests_and_a_non_retryable_validation_failed_error(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    text_only_body = make_sse_body( [], stop_reason = "end_turn", text = "No tool for you.", has_tool_call = False )
    stubbed_app = build_stubbed_app( monkeypatch, [ text_only_body, text_only_body ] )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 2
    assert [ line[ "type" ] for line in lines ] == [ "usage", "usage", "error" ]
    assert lines[ 2 ][ "code" ] == "validation_failed"
    assert lines[ 2 ][ "retryable" ] is False

def test_text_alongside_a_valid_submit_draft_call_is_ignored( monkeypatch: pytest.MonkeyPatch ) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        [ make_sse_body( list( BRIEF_SECTION_KEYS ), text = "Sure, drafting it now." ) ]
    )

    lines = post_request( stubbed_app )

    assert len( stubbed_app.recorded_requests ) == 1
    assert [ line[ "type" ] for line in lines ] == [ "usage", "result" ]
    assert "Sure, drafting it now." not in json.dumps( lines[ 1 ] )

def make_clock( seconds_after_two_calls: float ) -> Callable[ [], float ]:
    call_count = 0

    def clock() -> float:
        nonlocal call_count
        call_count += 1

        return 0.0 if call_count <= 2 else seconds_after_two_calls

    return clock

def test_a_16_second_gap_between_stream_events_writes_one_heartbeat_before_usage( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.setattr( "agents.runtime.draft.monotonic", make_clock( 16.0 ) )
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( list( BRIEF_SECTION_KEYS ) ) ] )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "heartbeat", "usage", "result" ]

def test_a_5_second_gap_between_stream_events_writes_no_heartbeat( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.setattr( "agents.runtime.draft.monotonic", make_clock( 5.0 ) )
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( list( BRIEF_SECTION_KEYS ) ) ] )

    lines = post_request( stubbed_app )

    assert [ line[ "type" ] for line in lines ] == [ "usage", "result" ]

def test_context_with_nothing_to_draft_from_gets_one_invalid_request_line_and_no_claude_call(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    stubbed_app = build_stubbed_app( monkeypatch, [ make_sse_body( list( BRIEF_SECTION_KEYS ) ) ] )

    lines = post_request( stubbed_app, make_request( [] ) )

    assert len( lines ) == 1
    assert lines[ 0 ][ "type" ] == "error"
    assert lines[ 0 ][ "code" ] == "invalid_request"
    assert lines[ 0 ][ "retryable" ] is False
    assert stubbed_app.recorded_requests == []

def test_fake_mode_writes_a_heartbeat_then_zero_usage_then_a_valid_brief_and_no_delta(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )
    client = TestClient( create_app() )

    lines = read_lines( client.post( "/v1/steps", content = json.dumps( valid_request ) ).content )

    assert [ line[ "type" ] for line in lines ] == [ "heartbeat", "usage", "result" ]
    assert lines[ 1 ] == {
        "type": "usage",
        "model": "fake",
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0
    }
    output = DraftArtifactOutput.model_validate( lines[ 2 ][ "output" ] )
    assert validate_draft( output.model_dump(), BRIEF_SECTION_KEYS ).outcome == DraftOutcome.VALID
