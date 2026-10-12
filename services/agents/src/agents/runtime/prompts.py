import hashlib
import tomllib
from pathlib import Path

from anthropic.types import OutputConfigParam, ThinkingConfigAdaptiveParam, ThinkingConfigBetweenToolsParam
from pydantic import BaseModel

THINKING_TYPES = ( "adaptive", "between_tools" )
EFFORT_LEVELS = ( "low", "medium", "high", "xhigh", "max" )

class Prompt( BaseModel ):
    body: str
    max_tokens: int
    thinking: ThinkingConfigAdaptiveParam | ThinkingConfigBetweenToolsParam | None = None
    output_config: OutputConfigParam | None = None
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

    thinking: ThinkingConfigAdaptiveParam | ThinkingConfigBetweenToolsParam | None = None
    thinking_type = front_matter.get( "thinking" )
    if thinking_type == "adaptive":
        thinking = { "type": "adaptive" }
    elif thinking_type == "between_tools":
        thinking = { "type": "between_tools" }
    elif thinking_type is not None:
        raise ValueError( f"Prompt {prompt_path} has thinking = {thinking_type!r}; allowed values are {THINKING_TYPES}" )

    output_config: OutputConfigParam | None = None
    effort = front_matter.get( "effort" )
    if effort == "low":
        output_config = { "effort": "low" }
    elif effort == "medium":
        output_config = { "effort": "medium" }
    elif effort == "high":
        output_config = { "effort": "high" }
    elif effort == "xhigh":
        output_config = { "effort": "xhigh" }
    elif effort == "max":
        output_config = { "effort": "max" }
    elif effort is not None:
        raise ValueError( f"Prompt {prompt_path} has effort = {effort!r}; allowed values are {EFFORT_LEVELS}" )

    return Prompt(
        body = text[ closing_index + 5: ],
        max_tokens = max_tokens,
        thinking = thinking,
        output_config = output_config,
        hash = hashlib.sha256( prompt_bytes ).hexdigest()
    )
