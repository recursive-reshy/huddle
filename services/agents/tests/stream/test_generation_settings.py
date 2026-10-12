import json
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
from agents.roles.sections import BRIEF_SECTION_KEYS
from tests.conftest import write_registry_prompts

chat_sse_body = ( Path( __file__ ).parents[ 1 ] / "fixtures" / "sse" / "chat_reply.txt" ).read_text()

def make_request( kind: str ) -> dict[ str, object ]:
    return {
        "job_id": 11,
        "attempt": 1,
        "kind": kind,
        "agent": "pm",
        "model": "claude-sonnet-5-5",
        "context": {
            "project": { "id": "p-1", "name": "My Team" },
            "artifacts": [],
            "decisions": [],
            "draft": [],
            "questions": [],
            "messages": [
                { "author": "pm", "kind": "chat", "content": "Welcome" },
                { "author": "human", "kind": "chat", "content": "Hi" }
            ],
            "task": { "notes": "", "mode": "normal", "may_ask": False }
        }
    }

def event( name: str, data: dict[ str, object ] ) -> str:
    return f"event: {name}\ndata: {json.dumps( data )}\n\n"

def make_draft_sse_body(
    section_keys: list[ str ],
    leading_blocks: list[ dict[ str, object ] ] | None = None,
    has_tool_call: bool = True
) -> str:
    draft_input = {
        "draft": [
            { "section_key": section_key, "title": section_key.title(), "content": f"Content for {section_key}" }
            for section_key in section_keys
        ]
    }
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

    for block in leading_blocks or []:
        if block[ "type" ] == "thinking":
            start_block = { "type": "thinking", "thinking": "" }
            deltas = [
                { "type": "thinking_delta", "thinking": block[ "thinking" ] },
                { "type": "signature_delta", "signature": block[ "signature" ] }
            ]
        else:
            start_block = block
            deltas = []

        events.append(
            event( "content_block_start", { "type": "content_block_start", "index": index, "content_block": start_block } )
        )
        for delta in deltas:
            events.append( event( "content_block_delta", { "type": "content_block_delta", "index": index, "delta": delta } ) )
        events.append( event( "content_block_stop", { "type": "content_block_stop", "index": index } ) )
        index += 1

    if has_tool_call:
        events += [
            event(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "tool_use", "id": "toolu_01", "name": "submit_draft", "input": {} }
                }
            ),
            event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "input_json_delta", "partial_json": json.dumps( draft_input ) }
                }
            ),
            event( "content_block_stop", { "type": "content_block_stop", "index": index } )
        ]

    events += [
        event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": { "stop_reason": "tool_use" if has_tool_call else "end_turn", "stop_sequence": None },
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

def build_stubbed_app(
    monkeypatch: pytest.MonkeyPatch,
    prompts_directory: Path,
    front_matter: str,
    response_bodies: list[ str ]
) -> StubbedApp:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    prompt_bytes = f"+++\nmax_tokens = 1024\n{front_matter}+++\nYou are the PM.\n".encode()
    write_registry_prompts( prompts_directory, prompt_bytes )

    recorded_requests: list[ httpx2.Request ] = []

    def respond( request: httpx2.Request ) -> httpx2.Response:
        recorded_requests.append( request )

        return httpx2.Response(
            200,
            headers = { "content-type": "text/event-stream" },
            content = response_bodies[ len( recorded_requests ) - 1 ].encode()
        )

    app = create_app(
        Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), prompts_dir = prompts_directory )
    )
    app.state.anthropic_client = AsyncAnthropic(
        api_key = "sk-test-secret",
        max_retries = 0,
        http_client = httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
    )

    return StubbedApp( app, recorded_requests )

def post_step( stubbed_app: StubbedApp, kind: str ) -> list[ dict[ str, object ] ]:
    response = stubbed_app.client.post( "/v1/steps", content = json.dumps( make_request( kind ) ) )

    return [ json.loads( line ) for line in response.content.decode().splitlines() ]

def sent_body( stubbed_app: StubbedApp, request_index: int = 0 ) -> dict[ str, Any ]:
    return json.loads( stubbed_app.recorded_requests[ request_index ].content )

@pytest.mark.parametrize( "kind", [ "pm_discovery_reply", "pm_draft_brief" ] )
def test_prompt_with_neither_key_sends_no_thinking_and_no_effort( monkeypatch: pytest.MonkeyPatch, tmp_path: Path, kind: str ) -> None:
    body = chat_sse_body if kind == "pm_discovery_reply" else make_draft_sse_body( list( BRIEF_SECTION_KEYS ) )
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, "", [ body ] )

    post_step( stubbed_app, kind )

    sent = sent_body( stubbed_app )
    assert "thinking" not in sent
    assert "output_config" not in sent

@pytest.mark.parametrize( "kind", [ "pm_discovery_reply", "pm_draft_brief" ] )
@pytest.mark.parametrize( "thinking", [ "adaptive", "between_tools" ] )
def test_prompt_thinking_is_sent_as_a_thinking_type(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    kind: str,
    thinking: str
) -> None:
    body = chat_sse_body if kind == "pm_discovery_reply" else make_draft_sse_body( list( BRIEF_SECTION_KEYS ) )
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, f"thinking = \"{thinking}\"\n", [ body ] )

    post_step( stubbed_app, kind )

    sent = sent_body( stubbed_app )
    assert sent[ "thinking" ] == { "type": thinking }
    assert "output_config" not in sent

@pytest.mark.parametrize( "kind", [ "pm_discovery_reply", "pm_draft_brief" ] )
def test_prompt_effort_is_sent_in_output_config( monkeypatch: pytest.MonkeyPatch, tmp_path: Path, kind: str ) -> None:
    body = chat_sse_body if kind == "pm_discovery_reply" else make_draft_sse_body( list( BRIEF_SECTION_KEYS ) )
    stubbed_app = build_stubbed_app( monkeypatch, tmp_path, "effort = \"low\"\n", [ body ] )

    post_step( stubbed_app, kind )

    sent = sent_body( stubbed_app )
    assert sent[ "output_config" ] == { "effort": "low" }
    assert "thinking" not in sent

def test_drafting_retry_carries_the_same_thinking_and_effort_as_the_first_call(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    stubbed_app = build_stubbed_app(
        monkeypatch,
        tmp_path,
        "thinking = \"adaptive\"\neffort = \"low\"\n",
        [
            make_draft_sse_body( list( BRIEF_SECTION_KEYS )[ :-1 ] ),
            make_draft_sse_body( list( BRIEF_SECTION_KEYS ) )
        ]
    )

    post_step( stubbed_app, "pm_draft_brief" )

    assert len( stubbed_app.recorded_requests ) == 2
    for request_index in ( 0, 1 ):
        sent = sent_body( stubbed_app, request_index )
        assert sent[ "thinking" ] == { "type": "adaptive" }
        assert sent[ "output_config" ] == { "effort": "low" }

thinking_block: dict[ str, object ] = { "type": "thinking", "thinking": "Weigh café scope — “later” items.\n", "signature": "EqQBCkYIARgCIkAq+/9=" }
redacted_thinking_block: dict[ str, object ] = { "type": "redacted_thinking", "data": "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT" }

@pytest.mark.parametrize( "has_tool_call", [ True, False ] )
def test_retry_sends_the_first_responses_thinking_blocks_unchanged_and_in_order_before_the_rest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    has_tool_call: bool
) -> None:
    leading_blocks = [ thinking_block, redacted_thinking_block ]
    stubbed_app = build_stubbed_app(
        monkeypatch,
        tmp_path,
        "thinking = \"adaptive\"\n",
        [
            make_draft_sse_body( list( BRIEF_SECTION_KEYS )[ :-1 ], leading_blocks, has_tool_call ),
            make_draft_sse_body( list( BRIEF_SECTION_KEYS ) )
        ]
    )

    post_step( stubbed_app, "pm_draft_brief" )

    assistant_turn = sent_body( stubbed_app, 1 )[ "messages" ][ -2 ]
    assert assistant_turn[ "role" ] == "assistant"
    assert assistant_turn[ "content" ][ :2 ] == leading_blocks
    assert [ block[ "type" ] for block in assistant_turn[ "content" ][ 2: ] ] == (
        [ "tool_use" ] if has_tool_call else []
    )
