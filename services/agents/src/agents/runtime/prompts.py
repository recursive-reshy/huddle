import hashlib
import tomllib
from pathlib import Path

from pydantic import BaseModel

class Prompt( BaseModel ):
    body: str
    max_tokens: int
    hash: str

def load_prompt( prompts_directory: Path, agent: str, kind: str ) -> Prompt:
    prompt_path = prompts_directory / agent / f"{kind}.md"
    prompt_bytes = prompt_path.read_bytes()
    text = prompt_bytes.decode( "utf-8" )

    if not text.startswith( "+++\n" ):
        raise ValueError( f"Prompt {prompt_path} has no front matter" )

    closing_index = text.find( "\n+++\n", 3 )
    if closing_index == -1:
        raise ValueError( f"Prompt {prompt_path} has no closing +++ line" )

    front_matter = tomllib.loads( text[ 4:closing_index + 1 ] )
    max_tokens = front_matter.get( "max_tokens" )
    if not isinstance( max_tokens, int ) or isinstance( max_tokens, bool ) or max_tokens < 1:
        raise ValueError( f"Prompt {prompt_path} needs a positive integer max_tokens, got {max_tokens!r}" )

    return Prompt(
        body = text[ closing_index + 5: ],
        max_tokens = max_tokens,
        hash = hashlib.sha256( prompt_bytes ).hexdigest()
    )
