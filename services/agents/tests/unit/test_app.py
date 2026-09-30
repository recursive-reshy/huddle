from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from agents.config import Settings
from agents.main import create_app

def test_app_refuses_to_start_without_api_key_or_fake_mode( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    with pytest.raises( ValidationError ):
        create_app()

def test_healthz_reports_ok_in_fake_mode( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    response = TestClient( create_app() ).get( "/healthz" )

    assert response.status_code == 200
    assert response.json() == { "status": "ok" }

def test_healthz_reports_ok_with_api_key( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.setenv( "ANTHROPIC_API_KEY", "sk-test-secret" )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    response = TestClient( create_app() ).get( "/healthz" )

    assert response.status_code == 200
    assert response.json() == { "status": "ok" }

@pytest.mark.parametrize( "path", [ "/docs", "/redoc", "/openapi.json" ] )
def test_documentation_routes_are_disabled( monkeypatch: pytest.MonkeyPatch, path: str ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    response = TestClient( create_app() ).get( path )

    assert response.status_code == 404

def test_real_mode_refuses_to_start_when_a_registered_prompt_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path
) -> None:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    with pytest.raises( FileNotFoundError ):
        create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), prompts_dir = tmp_path ) )

def test_fake_mode_starts_without_prompts( monkeypatch: pytest.MonkeyPatch, tmp_path: Path ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    response = TestClient( create_app( Settings( prompts_dir = tmp_path ) ) ).get( "/healthz" )

    assert response.status_code == 200

def test_anthropic_client_uses_two_max_retries_by_default( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ) ) )

    assert app.state.anthropic_client.max_retries == 2

def test_anthropic_client_uses_the_configured_max_retries( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    app = create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), anthropic_max_retries = 0 ) )

    assert app.state.anthropic_client.max_retries == 0
