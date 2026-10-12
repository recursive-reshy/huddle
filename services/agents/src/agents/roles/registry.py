from pydantic import BaseModel

from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput, ReviewOutput
from agents.roles.sections import BRIEF_SECTION_KEYS

class RegistryEntry( BaseModel ):
    output_type: type[ ChatReplyOutput ] | type[ DraftArtifactOutput ] | type[ ReviewOutput ]
    section_keys: tuple[ str, ... ] | None = None

registry: dict[ tuple[ str, str ], RegistryEntry ] = {
    ( "pm", "pm_discovery_reply" ): RegistryEntry( output_type = ChatReplyOutput ),
    ( "pm", "pm_draft_brief" ): RegistryEntry( output_type = DraftArtifactOutput, section_keys = BRIEF_SECTION_KEYS ),
    ( "sa", "sa_review_brief" ): RegistryEntry( output_type = ReviewOutput )
}
