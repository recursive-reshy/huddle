from agents.contract.outputs import ChatReplyOutput

registry: dict[ tuple[ str, str ], type[ ChatReplyOutput ] ] = {
    ( "pm", "pm_discovery_reply" ): ChatReplyOutput
}
