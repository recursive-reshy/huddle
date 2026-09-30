from pydantic import TypeAdapter

from agents.contract.lines import StepLine

step_line_adapter: TypeAdapter[ StepLine ] = TypeAdapter( StepLine )

def to_ndjson( line: StepLine ) -> bytes:
    return step_line_adapter.dump_json( line ) + b"\n"
