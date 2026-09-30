import pytest
from pydantic import ValidationError

from agents.contract.context import ProjectRef, StepContext, Task, TaskMode
from agents.contract.request import StepRequest

valid_context: dict[ str, object ] = {
    "project": { "id": "p-1", "name": "My Team" },
    "artifacts": [],
    "decisions": [],
    "draft": [],
    "questions": [],
    "messages": [],
    "task": { "notes": "hello", "mode": "normal" }
}

valid_request: dict[ str, object ] = {
    "job_id": 7,
    "attempt": 2,
    "kind": "pm_discovery_reply",
    "agent": "pm",
    "model": "claude-sonnet-5-5",
    "context": valid_context
}

def test_request_parses_every_field() -> None:
    request = StepRequest.model_validate(
        {
            "job_id": 7,
            "attempt": 2,
            "kind": "pm_discovery_reply",
            "agent": "pm",
            "model": "claude-sonnet-5-5",
            "context": valid_context
        }
    )

    assert request.job_id == 7
    assert request.attempt == 2
    assert request.kind == "pm_discovery_reply"
    assert request.agent == "pm"
    assert request.model == "claude-sonnet-5-5"
    assert request.context == StepContext(
        project = ProjectRef( id = "p-1", name = "My Team" ),
        artifacts = [],
        decisions = [],
        draft = [],
        questions = [],
        messages = [],
        task = Task( notes = "hello", mode = TaskMode.NORMAL )
    )

def test_request_without_model_raises() -> None:
    payload = { key: value for key, value in valid_request.items() if key != "model" }

    with pytest.raises( ValidationError ):
        StepRequest.model_validate( payload )

def test_request_with_extra_field_raises() -> None:
    with pytest.raises( ValidationError ):
        StepRequest.model_validate( { **valid_request, "unexpected": True } )

@pytest.mark.parametrize(
    ( "field", "value" ),
    [
        ( "job_id", 0 ),
        ( "attempt", 0 ),
        ( "model", "" ),
        ( "kind", "" ),
        ( "agent", "" )
    ]
)
def test_request_with_out_of_range_value_raises( field: str, value: object ) -> None:
    with pytest.raises( ValidationError ):
        StepRequest.model_validate( { **valid_request, field: value } )
