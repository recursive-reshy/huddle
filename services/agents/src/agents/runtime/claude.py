import logging
from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic
from anthropic.lib.streaming import AsyncMessageStream
from anthropic.types import MessageParam, TextBlockParam

from agents.contract.errors import ErrorCode
from agents.contract.lines import DeltaLine, ErrorLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import ChatReplyOutput
from agents.runtime.errors import map_exception
from agents.runtime.prompts import Prompt

logger = logging.getLogger( __name__ )

async def stream_chat_reply(
    client: AsyncAnthropic,
    model: str,
    prompt: Prompt,
    system: list[ TextBlockParam ],
    turns: list[ MessageParam ]
) -> AsyncIterator[ StepLine ]:
    texts: list[ str ] = []
    error_line: ErrorLine | None = None
    active_stream: AsyncMessageStream | None = None
    has_started = False

    try:
        async with client.messages.stream(
            model = model,
            max_tokens = prompt.max_tokens,
            system = system,
            messages = turns
        ) as stream:
            active_stream = stream

            async for event in stream:
                if event.type == "message_start":
                    has_started = True

                if event.type == "text" and event.text:
                    texts.append( event.text )
                    yield DeltaLine( type = "delta", text = event.text )

            message = await stream.get_final_message()

        if message.stop_reason == "max_tokens":
            error_line = ErrorLine(
                type = "error",
                code = ErrorCode.TRUNCATED,
                message = f"Reply reached the max_tokens limit of {prompt.max_tokens}",
                retryable = False
            )
        elif message.stop_reason == "refusal":
            error_line = ErrorLine(
                type = "error",
                code = ErrorCode.REFUSED,
                message = "Claude refused to reply",
                retryable = False
            )
        elif not texts:
            error_line = ErrorLine(
                type = "error",
                code = ErrorCode.EMPTY_REPLY,
                message = "Claude's reply had no text",
                retryable = True
            )
    except Exception as exception:
        error_line = map_exception( exception )

        if error_line.code == ErrorCode.INTERNAL_ERROR:
            logger.exception( "Unexpected error while streaming a chat reply" )

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

    if error_line is not None:
        yield error_line
        return

    yield ResultLine(
        type = "result",
        prompt_hash = prompt.hash,
        output = ChatReplyOutput( output_type = "chat_reply", content = "".join( texts ) )
    )
