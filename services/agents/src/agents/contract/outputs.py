from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

class ChatReplyOutput( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    output_type: Literal[ "chat_reply" ]
    content: str = Field( min_length = 1 )

Output = Annotated[ ChatReplyOutput, Field( discriminator = "output_type" ) ]
