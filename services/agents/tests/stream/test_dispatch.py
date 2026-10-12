import json
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from anthropic import AsyncAnthropic
from fastapi.testclient import TestClient
from pydantic import SecretStr

from agents.config import Settings
from agents.main import create_app
from agents.runtime.context import build_source_turn, build_turns

def make_request( agent: str, kind: str ) -> dict[ str, object ]:
    return {
        "job_id": 41,
        "attempt": 1,
        "kind": kind,
        "agent": agent,
        "model": "claude-sonnet-5-5",
        "context": {
            "project": { "id": "p-1", "name": "Demo" },
            "artifacts": [],
            "decisions": [],
            "draft": [],
            "questions": [],
            "messages": [ { "author": "human", "kind": "chat", "content": "Hello" } ],
            "task": { "notes": "", "mode": "normal", "may_ask": False }
        }
    }

def build_client( monkeypatch: pytest.MonkeyPatch ) -> TestClient:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    def respond( request: httpx2.Request ) -> httpx2.Response:
        return httpx2.Response( 500, json = { "error": { "type": "api_error", "message": "stub" } } )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ) ) )
    app.state.anthropic_client = AsyncAnthropic(
        api_key = "sk-test-secret",
        max_retries = 0,
        http_client = httpx2.AsyncClient( transport = httpx2.MockTransport( respond ) )
    )

    return TestClient( app )

@pytest.mark.parametrize(
    ( "agent", "kind", "expected_builder_name" ),
    [
        ( "pm", "pm_discovery_reply", "build_turns" ),
        ( "pm", "pm_draft_brief", "build_source_turn" ),
        ( "sa", "sa_review_brief", "build_source_turn" )
    ]
)
def test_chat_kinds_use_build_turns_and_every_other_output_type_uses_build_source_turn(
    monkeypatch: pytest.MonkeyPatch,
    agent: str,
    kind: str,
    expected_builder_name: str
) -> None:
    called_builders: list[ str ] = []

    def spy( name: str, builder: Callable[ ..., Any ] ) -> Callable[ ..., Any ]:
        def wrapper( *arguments: Any ) -> Any:
            called_builders.append( name )

            return builder( *arguments )

        return wrapper

    monkeypatch.setattr( "agents.main.build_turns", spy( "build_turns", build_turns ) )
    monkeypatch.setattr( "agents.main.build_source_turn", spy( "build_source_turn", build_source_turn ) )
    client = build_client( monkeypatch )

    client.post( "/v1/steps", content = json.dumps( make_request( agent, kind ) ) )

    assert called_builders == [ expected_builder_name ]
