import hashlib
import re
from collections.abc import Iterator
from pathlib import Path

from agents.contract.lines import DeltaLine, HeartbeatLine, ResultLine, StepLine, UsageLine
from agents.contract.outputs import ChatReplyOutput
from agents.contract.request import StepRequest
from agents.roles.registry import registry

fixtures_directory = Path( __file__ ).parents[ 3 ] / "fixtures" / "fake"
delta_size = 20
variant_pattern = re.compile( r"\[([A-Za-z0-9_-]+)\]" )

def stream_fake_step( step_request: StepRequest ) -> Iterator[ StepLine ]:
    output_type = registry[ ( step_request.agent, step_request.kind ) ].output_type
    fixture_path = fixtures_directory / step_request.agent / f"{step_request.kind}.json"

    variant_match = variant_pattern.search( step_request.context.project.name )
    if variant_match is not None:
        variant_path = fixture_path.with_name( f"{step_request.kind}.{variant_match.group( 1 )}.json" )
        if variant_path.exists():
            fixture_path = variant_path

    fixture_bytes = fixture_path.read_bytes()
    output = output_type.model_validate_json( fixture_bytes )

    if isinstance( output, ChatReplyOutput ):
        for start in range( 0, len( output.content ), delta_size ):
            yield DeltaLine( type = "delta", text = output.content[ start:start + delta_size ] )
    else:
        yield HeartbeatLine( type = "heartbeat" )

    yield UsageLine(
        type = "usage",
        model = "fake",
        input_tokens = 0,
        output_tokens = 0,
        cache_read_tokens = 0,
        cache_write_tokens = 0
    )
    yield ResultLine(
        type = "result",
        prompt_hash = hashlib.sha256( fixture_bytes ).hexdigest(),
        output = output
    )
