import hashlib
from pathlib import Path

import pytest
from pydantic import SecretStr

from agents.config import Settings
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
