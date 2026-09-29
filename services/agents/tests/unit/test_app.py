import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

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
