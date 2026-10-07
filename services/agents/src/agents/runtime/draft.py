import logging
from collections.abc import AsyncIterator
from enum import StrEnum
from time import monotonic

from anthropic import AsyncAnthropic
from anthropic.lib.streaming import AsyncMessageStream
from anthropic.types import Message, MessageParam, TextBlockParam, ToolChoiceAutoParam, ToolParam, ToolUseBlock
from pydantic import BaseModel, ValidationError

from agents.contract.errors import ErrorCode
from agents.contract.lines import ErrorLine, HeartbeatLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import DraftArtifactOutput, DraftSection
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
    tool: ToolParam = {
        "name": "submit_draft",
        "description": "Submit the complete draft as a list of sections.",
        "input_schema": DraftToolInput.model_json_schema()
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
                tool_choice = tool_choice
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
                    message = f"Draft reached the max_tokens limit of {prompt.max_tokens}",
                    retryable = False
                )
            elif message.stop_reason == "refusal":
                error_line = ErrorLine(
                    type = "error",
                    code = ErrorCode.REFUSED,
                    message = "Claude refused to draft",
                    retryable = False
                )
        except Exception as exception:
            error_line = map_exception( exception )

            if error_line.code == ErrorCode.INTERNAL_ERROR:
                logger.exception( "Unexpected error while streaming a draft" )

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
            if block.type == "tool_use" and block.name == "submit_draft":
                tool_use = block

        follow_up_turns: list[ MessageParam ]
        if tool_use is None:
            errors = [ "submit_draft was not called" ]
            texts = [ block.text for block in message.content if block.type == "text" and block.text != "" ]
            follow_up_turns = []
            if texts:
                follow_up_turns.append(
                    { "role": "assistant", "content": [ { "type": "text", "text": text } for text in texts ] }
                )

            follow_up_turns.append( { "role": "user", "content": [ { "type": "text", "text": MISSING_TOOL_CALL_NOTICE } ] } )
        else:
            validation = validate_draft( tool_use.input, section_keys )
            if attempt_number == 1 and first_tool_error is not None:
                validation = DraftValidation( outcome = DraftOutcome.INVALID, errors = [ first_tool_error ] )

            if validation.outcome == DraftOutcome.VALID:
                yield ResultLine(
                    type = "result",
                    prompt_hash = prompt.hash,
                    output = DraftArtifactOutput( output_type = "draft_artifact", draft = validation.draft )
                )
                return

            errors = validation.errors
            follow_up_turns = [
                {
                    "role": "assistant",
                    "content": [
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
                            "content": f"Draft failed validation: {'; '.join( errors )}"
                        }
                    ]
                }
            ]

        if attempt_number == 2:
            yield ErrorLine(
                type = "error",
                code = ErrorCode.VALIDATION_FAILED,
                message = f"Draft failed validation after one retry: {'; '.join( errors )}",
                retryable = False
            )
            return

        messages = [ *turns, *follow_up_turns ]
