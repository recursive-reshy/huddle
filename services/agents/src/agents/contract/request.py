from pydantic import BaseModel, ConfigDict, Field

from agents.contract.context import StepContext

class StepRequest( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    job_id: int = Field( ge = 1 )
    attempt: int = Field( ge = 1 )
    kind: str = Field( min_length = 1 )
    agent: str = Field( min_length = 1 )
    model: str = Field( min_length = 1 )
    context: StepContext
