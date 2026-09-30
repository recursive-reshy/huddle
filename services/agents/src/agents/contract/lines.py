from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from agents.contract.errors import ErrorCode
from agents.contract.outputs import Output

class DeltaLine( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    type: Literal[ "delta" ]
    text: str = Field( min_length = 1 )

class UsageLine( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    type: Literal[ "usage" ]
    model: str
    input_tokens: int = Field( ge = 0 )
    output_tokens: int = Field( ge = 0 )
    cache_read_tokens: int = Field( ge = 0 )
    cache_write_tokens: int = Field( ge = 0 )

class ResultLine( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    type: Literal[ "result" ]
    prompt_hash: str = Field( pattern = "^[0-9a-f]{64}$" )
    output: Output

class ErrorLine( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    type: Literal[ "error" ]
    code: ErrorCode
    message: str
    retryable: bool

StepLine = Annotated[ DeltaLine | UsageLine | ResultLine | ErrorLine, Field( discriminator = "type" ) ]
