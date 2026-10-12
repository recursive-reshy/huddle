from pathlib import Path

import pytest

from agents.roles.registry import registry

@pytest.fixture( autouse = True )
def run_in_empty_directory( tmp_path: Path, monkeypatch: pytest.MonkeyPatch ) -> None:
    monkeypatch.chdir( tmp_path )

def write_registry_prompts( prompts_directory: Path, prompt_bytes: bytes ) -> None:
    for agent, kind in registry:
        prompt_path = prompts_directory / agent / f"{kind}.md"
        prompt_path.parent.mkdir( parents = True, exist_ok = True )
        prompt_path.write_bytes( prompt_bytes )
