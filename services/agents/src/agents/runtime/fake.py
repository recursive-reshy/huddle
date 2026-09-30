import hashlib
from collections.abc import Iterator
from pathlib import Path

from agents.contract.lines import DeltaLine, ResultLine, StepLine, UsageLine
from agents.contract.request import StepRequest
from agents.roles.registry import registry

fixtures_directory = Path( __file__ ).parents[ 3 ] / "fixtures" / "fake"
delta_size = 20

def stream_fake_step( step_request: StepRequest ) -> Iterator[ StepLine ]:
    output_type = registry[ ( step_request.agent, step_request.kind ) ]
    fixture_bytes = ( fixtures_directory / step_request.agent / f"{step_request.kind}.json" ).read_bytes()
    output = output_type.model_validate_json( fixture_bytes )

    for start in range( 0, len( output.content ), delta_size ):
        yield DeltaLine( type = "delta", text = output.content[ start:start + delta_size ] )

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
