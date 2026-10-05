from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

class ChatReplyOutput( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    output_type: Literal[ "chat_reply" ]
    content: str = Field( min_length = 1 )

class DraftSection( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    section_key: str = Field( min_length = 1 )
    title: str = Field( min_length = 1 )
    content: str = Field( min_length = 1 )

class DraftArtifactOutput( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    output_type: Literal[ "draft_artifact" ]
    draft: list[ DraftSection ] = Field( min_length = 1 )

    @field_validator( "draft" )
    @classmethod
    def section_keys_are_unique( cls, draft: list[ DraftSection ] ) -> list[ DraftSection ]:
        section_keys = [ section.section_key for section in draft ]
        if len( set( section_keys ) ) != len( section_keys ):
            raise ValueError( "section_key values must be unique within a draft" )

        return draft

Output = Annotated[ ChatReplyOutput | DraftArtifactOutput, Field( discriminator = "output_type" ) ]
