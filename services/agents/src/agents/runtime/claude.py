from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic
from anthropic.types import MessageParam, TextBlockParam

from agents.contract.lines import DeltaLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import ChatReplyOutput
from agents.runtime.prompts import Prompt

async def stream_chat_reply(
    client: AsyncAnthropic,
    model: str,
    prompt: Prompt,
    system: list[ TextBlockParam ],
    turns: list[ MessageParam ]
) -> AsyncIterator[ StepLine ]:
    texts: list[ str ] = []

    async with client.messages.stream(
        model = model,
        max_tokens = prompt.max_tokens,
        system = system,
        messages = turns
    ) as stream:
        async for text in stream.text_stream:
            if text:
                texts.append( text )
                yield DeltaLine( type = "delta", text = text )

        message = await stream.get_final_message()

    yield UsageLine(
        type = "usage",
        model = message.model,
        input_tokens = message.usage.input_tokens,
        output_tokens = message.usage.output_tokens,
        cache_read_tokens = message.usage.cache_read_input_tokens or 0,
        cache_write_tokens = message.usage.cache_creation_input_tokens or 0
    )
    yield ResultLine(
        type = "result",
        prompt_hash = prompt.hash,
        output = ChatReplyOutput( output_type = "chat_reply", content = "".join( texts ) )
    )
