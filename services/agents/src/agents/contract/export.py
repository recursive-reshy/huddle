import json
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from agents.contract.lines import StepLine
from agents.contract.request import StepRequest

schema_path = Path( __file__ ).parents[ 3 ] / "schema" / "step_contract.json"

def render_schema() -> str:
    request_schema: dict[ str, Any ] = TypeAdapter( StepRequest ).json_schema( mode = "validation" )
    line_schema: dict[ str, Any ] = TypeAdapter( StepLine ).json_schema( mode = "serialization" )

    definitions: dict[ str, Any ] = {
        **request_schema.pop( "$defs", {} ),
        **line_schema.pop( "$defs", {} ),
        "StepRequest": request_schema,
        "StepLine": line_schema
    }

    return json.dumps( { "$defs": definitions }, indent = 2, sort_keys = True ) + "\n"

if __name__ == "__main__":
    schema_path.parent.mkdir( exist_ok = True )
    schema_path.write_text( render_schema(), encoding = "utf-8" )
