import hashlib
from pathlib import Path

import pytest
from pydantic import SecretStr

from agents.config import Settings
from agents.main import create_app
from agents.roles.registry import registry
from agents.runtime.context import EARLIER_MESSAGES_NOTICE
from agents.runtime.prompts import load_prompt

body = "You are the PM.\n\nNaresh’s café — “quotes”\n\n  Trailing spaces  \n"

def write_prompt( prompts_directory: Path, content: bytes ) -> None:
    prompt_path = prompts_directory / "pm" / "pm_discovery_reply.md"
    prompt_path.parent.mkdir( parents = True, exist_ok = True )
    prompt_path.write_bytes( content )

def test_prompt_front_matter_is_parsed_and_the_body_comes_back_byte_for_byte( tmp_path: Path ) -> None:
    write_prompt( tmp_path, f"+++\nmax_tokens = 1024\n+++\n{body}".encode() )

    prompt = load_prompt( tmp_path, "pm", "pm_discovery_reply" )

    assert prompt.max_tokens == 1024
    assert prompt.body.encode() == body.encode()

@pytest.mark.parametrize(
    "content",
    [
        f"+++\nnote = \"x\"\n+++\n{body}".encode(),
        f"+++\nmax_tokens = 0\n+++\n{body}".encode(),
        body.encode(),
        b"+++\nmax_tokens = 1024\n+++\nbad byte \xff here"
    ]
)
def test_prompt_without_valid_front_matter_or_utf8_fails_to_load( tmp_path: Path, content: bytes ) -> None:
    write_prompt( tmp_path, content )

    with pytest.raises( ValueError ):
        load_prompt( tmp_path, "pm", "pm_discovery_reply" )

def test_prompt_hash_is_the_sha256_of_the_whole_file( tmp_path: Path ) -> None:
    content = f"+++\nmax_tokens = 1024\n+++\n{body}".encode()
    write_prompt( tmp_path, content )

    prompt = load_prompt( tmp_path, "pm", "pm_discovery_reply" )

    assert prompt.hash == hashlib.sha256( content ).hexdigest()

def test_repo_prompt_has_front_matter_and_names_the_earlier_messages_notice() -> None:
    prompt = load_prompt( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ) ).prompts_dir, "pm", "pm_discovery_reply" )

    assert prompt.max_tokens > 0
    assert EARLIER_MESSAGES_NOTICE in prompt.body

@pytest.mark.parametrize(
    ( "front_matter_line", "key", "bad_value", "allowed_value" ),
    [
        ( "thinking = \"disabled\"", "thinking", "disabled", "between_tools" ),
        ( "thinking = \"enabled\"", "thinking", "enabled", "adaptive" ),
        ( "effort = \"extreme\"", "effort", "extreme", "medium" ),
        ( "effort = 3", "effort", "3", "high" )
    ]
)
def test_undocumented_thinking_or_effort_fails_to_load_naming_the_key_the_value_and_the_allowed_values(
    tmp_path: Path,
    front_matter_line: str,
    key: str,
    bad_value: str,
    allowed_value: str
) -> None:
    write_prompt( tmp_path, f"+++\nmax_tokens = 1024\n{front_matter_line}\n+++\n{body}".encode() )

    with pytest.raises( ValueError ) as exception_info:
        load_prompt( tmp_path, "pm", "pm_discovery_reply" )

    message = str( exception_info.value )
    assert key in message
    assert bad_value in message
    assert allowed_value in message

@pytest.mark.parametrize( "front_matter_line", [ "thinking = \"disabled\"", "effort = \"extreme\"" ] )
def test_real_mode_refuses_to_start_when_a_registered_prompt_has_a_bad_generation_setting(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    front_matter_line: str
) -> None:
    monkeypatch.delenv( "AGENTS_FAKE", raising = False )
    for agent, kind in registry:
        prompt_path = tmp_path / agent / f"{kind}.md"
        prompt_path.parent.mkdir( parents = True, exist_ok = True )
        prompt_path.write_bytes( f"+++\nmax_tokens = 1024\n+++\n{body}".encode() )
    write_prompt( tmp_path, f"+++\nmax_tokens = 1024\n{front_matter_line}\n+++\n{body}".encode() )

    with pytest.raises( ValueError ):
        create_app( Settings( anthropic_api_key = SecretStr( "sk-test-secret" ), prompts_dir = tmp_path ) )

def test_every_registered_repo_prompt_loads_with_or_without_generation_settings() -> None:
    prompts_directory = Settings( anthropic_api_key = SecretStr( "sk-test-secret" ) ).prompts_dir

    for agent, kind in registry:
        prompt = load_prompt( prompts_directory, agent, kind )

        assert prompt.max_tokens > 0
