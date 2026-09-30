from pathlib import Path

import pytest
from pydantic import ValidationError

from agents.config import Settings

def test_missing_api_key_without_fake_mode_is_rejected( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    with pytest.raises( ValidationError ) as exception_info:
        Settings()

    assert "ANTHROPIC_API_KEY" in str( exception_info.value )

def test_fake_mode_allows_missing_api_key( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.setenv( "AGENTS_FAKE", "1" )

    settings = Settings()

    assert settings.is_fake is True
    assert settings.anthropic_api_key is None

def test_api_key_never_appears_in_printed_settings( monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.setenv( "ANTHROPIC_API_KEY", "sk-test-secret" )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )

    settings = Settings()

    assert "sk-test-secret" not in repr( settings )
    assert "sk-test-secret" not in str( settings )
    assert "sk-test-secret" not in settings.model_dump_json()

def test_settings_read_api_key_from_env_file( tmp_path: Path, monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.delenv( "ANTHROPIC_API_KEY", raising = False )
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    ( tmp_path / ".env" ).write_text( "ANTHROPIC_API_KEY=sk-from-file\nUNRELATED=1\n", encoding = "utf-8" )

    settings = Settings()

    assert settings.anthropic_api_key is not None
    assert settings.anthropic_api_key.get_secret_value() == "sk-from-file"
