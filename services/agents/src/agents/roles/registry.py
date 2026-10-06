from pydantic import BaseModel

from agents.contract.outputs import ChatReplyOutput, DraftArtifactOutput
from agents.roles.sections import BRIEF_SECTION_KEYS

class RegistryEntry( BaseModel ):
    output_type: type[ ChatReplyOutput ] | type[ DraftArtifactOutput ]
    section_keys: tuple[ str, ... ] | None = None

registry: dict[ tuple[ str, str ], RegistryEntry ] = {
    ( "pm", "pm_discovery_reply" ): RegistryEntry( output_type = ChatReplyOutput ),
    ( "pm", "pm_draft_brief" ): RegistryEntry( output_type = DraftArtifactOutput, section_keys = BRIEF_SECTION_KEYS )
}
