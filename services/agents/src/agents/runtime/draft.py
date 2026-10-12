import logging
from collections.abc import AsyncIterator, Callable
from enum import StrEnum
from time import monotonic
from typing import Any

from anthropic import AsyncAnthropic, omit
from anthropic.lib.streaming import AsyncMessageStream
from anthropic.types import (
    Message,
    MessageParam,
    RedactedThinkingBlockParam,
    TextBlockParam,
    ThinkingBlockParam,
    ToolChoiceAutoParam,
    ToolParam,
    ToolUseBlock
)
from pydantic import BaseModel, ConfigDict, ValidationError

from agents.contract.errors import ErrorCode
from agents.contract.lines import ErrorLine, HeartbeatLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import DraftArtifactOutput, DraftSection, ReviewOutput
from agents.runtime.errors import map_exception
from agents.runtime.prompts import Prompt

logger = logging.getLogger( __name__ )

MISSING_TOOL_CALL_NOTICE = "Call submit_draft with the complete draft. Reply with the tool call only."

class DraftToolInput( BaseModel ):
    draft: list[ DraftSection ]

class DraftOutcome( StrEnum ):
    VALID = "valid"
    INVALID = "invalid"

class DraftValidation( BaseModel ):
    outcome: DraftOutcome
    draft: list[ DraftSection ] = []
    errors: list[ str ] = []

def validate_draft( tool_input: object, section_keys: tuple[ str, ... ] ) -> DraftValidation:
    try:
        parsed = DraftToolInput.model_validate( tool_input )
    except ValidationError as exception:
        return DraftValidation(
            outcome = DraftOutcome.INVALID,
            errors = [
                f"invalid draft at {'.'.join( str( part ) for part in error[ 'loc' ] )}: {error[ 'msg' ]}"
                for error in exception.errors()
            ]
        )

    errors: list[ str ] = []
    seen_keys: list[ str ] = []
    for section in parsed.draft:
        if section.section_key not in section_keys:
            if f"unknown section: {section.section_key}" not in errors:
                errors.append( f"unknown section: {section.section_key}" )
        elif section.section_key in seen_keys:
            if f"duplicate section: {section.section_key}" not in errors:
                errors.append( f"duplicate section: {section.section_key}" )
        else:
            seen_keys.append( section.section_key )

    errors.extend( f"missing section: {section_key}" for section_key in section_keys if section_key not in seen_keys )

    expected_order = [ section_key for section_key in section_keys if section_key in seen_keys ]
    for actual_key, expected_key in zip( seen_keys, expected_order ):
        if actual_key != expected_key:
            errors.append( f"section out of order: {actual_key} before {expected_key}" )
            break

    if errors:
        return DraftValidation( outcome = DraftOutcome.INVALID, errors = errors )

    return DraftValidation( outcome = DraftOutcome.VALID, draft = parsed.draft )

class ToolValidation( BaseModel ):
    output: DraftArtifactOutput | ReviewOutput | None = None
    errors: list[ str ] = []

class ToolSpec( BaseModel ):
    model_config = ConfigDict( arbitrary_types_allowed = True )

    name: str
    description: str
    input_schema: dict[ str, Any ]
    action: str
    missing_tool_notice: str
    validate_input: Callable[ [ object ], ToolValidation ]

async def stream_tool_call(
    client: AsyncAnthropic,
    model: str,
    prompt: Prompt,
    system: list[ TextBlockParam ],
    turns: list[ MessageParam ],
    spec: ToolSpec,
    heartbeat_seconds: float,
    first_tool_error: str | None = None
) -> AsyncIterator[ StepLine ]:
    tool: ToolParam = {
        "name": spec.name,
        "description": spec.description,
        "input_schema": spec.input_schema
    }
    tool_choice: ToolChoiceAutoParam = { "type": "auto" }
    messages: list[ MessageParam ] = turns
    last_written_at = monotonic()

    for attempt_number in ( 1, 2 ):
        error_line: ErrorLine | None = None
        message: Message | None = None
        active_stream: AsyncMessageStream | None = None
        has_started = False

        try:
            async with client.messages.stream(
                model = model,
                max_tokens = prompt.max_tokens,
                system = system,
                messages = messages,
                tools = [ tool ],
                tool_choice = tool_choice,
                thinking = prompt.thinking or omit,
                output_config = prompt.output_config or omit
            ) as stream:
                active_stream = stream

                async for event in stream:
                    if event.type == "message_start":
                        has_started = True

                    now = monotonic()
                    if now - last_written_at >= heartbeat_seconds:
                        last_written_at = now
                        yield HeartbeatLine( type = "heartbeat" )

                message = await stream.get_final_message()

            if message.stop_reason == "max_tokens":
                error_line = ErrorLine(
                    type = "error",
                    code = ErrorCode.TRUNCATED,
                    message = f"{spec.action.capitalize()} reached the max_tokens limit of {prompt.max_tokens}",
                    retryable = False
                )
            elif message.stop_reason == "refusal":
                error_line = ErrorLine(
                    type = "error",
                    code = ErrorCode.REFUSED,
                    message = f"Claude refused to {spec.action}",
                    retryable = False
                )
        except Exception as exception:
            error_line = map_exception( exception )

            if error_line.code == ErrorCode.INTERNAL_ERROR:
                logger.exception( "Unexpected error while streaming a %s", spec.action )

        if active_stream is not None and has_started:
            snapshot = active_stream.current_message_snapshot
            yield UsageLine(
                type = "usage",
                model = snapshot.model,
                input_tokens = snapshot.usage.input_tokens,
                output_tokens = snapshot.usage.output_tokens,
                cache_read_tokens = snapshot.usage.cache_read_input_tokens or 0,
                cache_write_tokens = snapshot.usage.cache_creation_input_tokens or 0
            )
            last_written_at = monotonic()

        if error_line is not None:
            yield error_line
            return

        if message is None:
            return

        tool_use: ToolUseBlock | None = None
        for block in message.content:
            if block.type == "tool_use" and block.name == spec.name:
                tool_use = block

        thinking_blocks: list[ ThinkingBlockParam | RedactedThinkingBlockParam ] = []
        for block in message.content:
            if block.type == "thinking":
                thinking_blocks.append(
                    { "type": "thinking", "thinking": block.thinking, "signature": block.signature }
                )
            elif block.type == "redacted_thinking":
                thinking_blocks.append( { "type": "redacted_thinking", "data": block.data } )

        follow_up_turns: list[ MessageParam ]
        if tool_use is None:
            errors = [ f"{spec.name} was not called" ]
            texts = [ block.text for block in message.content if block.type == "text" and block.text != "" ]
            follow_up_turns = []
            if thinking_blocks or texts:
                follow_up_turns.append(
                    {
                        "role": "assistant",
                        "content": [ *thinking_blocks, *( { "type": "text", "text": text } for text in texts ) ]
                    }
                )

            follow_up_turns.append( { "role": "user", "content": [ { "type": "text", "text": spec.missing_tool_notice } ] } )
        else:
            validation = spec.validate_input( tool_use.input )
            if attempt_number == 1 and first_tool_error is not None:
                validation = ToolValidation( errors = [ first_tool_error ] )

            if validation.output is not None:
                yield ResultLine( type = "result", prompt_hash = prompt.hash, output = validation.output )
                return

            errors = validation.errors
            follow_up_turns = [
                {
                    "role": "assistant",
                    "content": [
                        *thinking_blocks,
                        { "type": "tool_use", "id": tool_use.id, "name": tool_use.name, "input": tool_use.input }
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "is_error": True,
                            "content": f"{spec.action.capitalize()} failed validation: {'; '.join( errors )}"
                        }
                    ]
                }
            ]

        if attempt_number == 2:
            yield ErrorLine(
                type = "error",
                code = ErrorCode.VALIDATION_FAILED,
                message = f"{spec.action.capitalize()} failed validation after one retry: {'; '.join( errors )}",
                retryable = False
            )
            return

        messages = [ *turns, *follow_up_turns ]

async def stream_draft_artifact(
    client: AsyncAnthropic,
    model: str,
    prompt: Prompt,
    system: list[ TextBlockParam ],
    turns: list[ MessageParam ],
    section_keys: tuple[ str, ... ],
    heartbeat_seconds: float,
    first_tool_error: str | None = None
) -> AsyncIterator[ StepLine ]:
    def validate_input( tool_input: object ) -> ToolValidation:
        validation = validate_draft( tool_input, section_keys )
        if validation.outcome == DraftOutcome.INVALID:
            return ToolValidation( errors = validation.errors )

        return ToolValidation(
            output = DraftArtifactOutput( output_type = "draft_artifact", draft = validation.draft )
        )

    spec = ToolSpec(
        name = "submit_draft",
        description = "Submit the complete draft as a list of sections.",
        input_schema = DraftToolInput.model_json_schema(),
        action = "draft",
        missing_tool_notice = MISSING_TOOL_CALL_NOTICE,
        validate_input = validate_input
    )

    async for line in stream_tool_call(
        client,
        model,
        prompt,
        system,
        turns,
        spec,
        heartbeat_seconds,
        first_tool_error
    ):
        yield line
