import copy
from typing import Any

import pytest
from pydantic import ValidationError

from agents.contract.context import (
    ArtifactKind,
    Decision,
    MessageKind,
    ProjectRef,
    Question,
    QuestionStatus,
    Section,
    StepContext,
    Task,
    TaskMode,
    ThreadMessage
)

section_payload: dict[ str, object ] = {
    "artifact_id": "art-1",
    "version": 2,
    "kind": "prd",
    "section_key": "goals",
    "title": "Goals",
    "content": "Ship it"
}

question_payload: dict[ str, object ] = {
    "id": "q-1",
    "thread_id": "th-1",
    "round": 1,
    "from_agent": "sa",
    "to_agent": "pm",
    "question": "Who is the user?",
    "status": "answered",
    "answer": "Naresh",
    "answered_by": "pm"
}

full_context: dict[ str, object ] = {
    "project": { "id": "p-1", "name": "My Team" },
    "artifacts": [ section_payload ],
    "decisions": [ { "id": "d-1", "title": "Stack", "decision": "SQLite", "rationale": "Single user" } ],
    "draft": [ { **section_payload, "kind": "trd" } ],
    "questions": [ question_payload ],
    "messages": [ { "author": "naresh", "kind": "discussion", "content": "Why?" } ],
    "task": { "notes": "Be brief", "mode": "escalation" }
}

def test_context_parses_every_nested_model_and_enum() -> None:
    context = StepContext.model_validate( full_context )

    assert context.project == ProjectRef( id = "p-1", name = "My Team" )
    assert context.artifacts == [
        Section(
            artifact_id = "art-1",
            version = 2,
            kind = ArtifactKind.PRD,
            section_key = "goals",
            title = "Goals",
            content = "Ship it"
        )
    ]
    assert context.decisions == [
        Decision( id = "d-1", title = "Stack", decision = "SQLite", rationale = "Single user" )
    ]
    assert context.draft[ 0 ].kind is ArtifactKind.TRD
    assert context.questions == [
        Question(
            id = "q-1",
            thread_id = "th-1",
            round = 1,
            from_agent = "sa",
            to_agent = "pm",
            question = "Who is the user?",
            status = QuestionStatus.ANSWERED,
            answer = "Naresh",
            answered_by = "pm"
        )
    ]
    assert context.messages == [ ThreadMessage( author = "naresh", kind = MessageKind.DISCUSSION, content = "Why?" ) ]
    assert context.task == Task( notes = "Be brief", mode = TaskMode.ESCALATION )

def test_context_with_empty_lists_and_empty_notes_is_accepted() -> None:
    context = StepContext.model_validate(
        {
            "project": { "id": "p-1", "name": "My Team" },
            "artifacts": [],
            "decisions": [],
            "draft": [],
            "questions": [],
            "messages": [],
            "task": { "notes": "", "mode": "normal" }
        }
    )

    assert context.artifacts == []
    assert context.task == Task( notes = "", mode = TaskMode.NORMAL )

@pytest.mark.parametrize( "field", list( full_context ) )
def test_context_missing_a_top_level_field_raises( field: str ) -> None:
    payload = { key: value for key, value in full_context.items() if key != field }

    with pytest.raises( ValidationError ):
        StepContext.model_validate( payload )

@pytest.mark.parametrize( "field", [ "draft", "task" ] )
def test_context_with_null_top_level_field_raises( field: str ) -> None:
    with pytest.raises( ValidationError ):
        StepContext.model_validate( { **full_context, field: None } )

def test_open_question_with_null_answer_fields_is_accepted() -> None:
    question = Question.model_validate( { **question_payload, "status": "open", "answer": None, "answered_by": None } )

    assert question.status is QuestionStatus.OPEN
    assert question.answer is None
    assert question.answered_by is None

@pytest.mark.parametrize(
    "payload",
    [
        { key: value for key, value in question_payload.items() if key != "answer" },
        { key: value for key, value in question_payload.items() if key != "answered_by" },
        { **question_payload, "status": "pending" }
    ]
)
def test_question_with_absent_answer_key_or_unknown_status_raises( payload: dict[ str, object ] ) -> None:
    with pytest.raises( ValidationError ):
        Question.model_validate( payload )

@pytest.mark.parametrize(
    ( "path", "value" ),
    [
        ( "task.mode", "urgent" ),
        ( "artifacts.0.version", 0 ),
        ( "artifacts.0.kind", "memo" ),
        ( "draft.0.kind", "memo" ),
        ( "questions.0.round", 0 ),
        ( "messages.0.kind", "email" )
    ]
)
def test_context_with_out_of_range_value_raises( path: str, value: object ) -> None:
    payload: dict[ str, Any ] = copy.deepcopy( full_context )
    *parents, leaf = path.split( "." )
    target: Any = payload
    for part in parents:
        target = target[ int( part ) if part.isdigit() else part ]
    target[ int( leaf ) if leaf.isdigit() else leaf ] = value

    with pytest.raises( ValidationError ):
        StepContext.model_validate( payload )

@pytest.mark.parametrize(
    "path",
    [ "", "project", "artifacts.0", "decisions.0", "questions.0", "messages.0", "task" ]
)
def test_context_with_extra_field_raises( path: str ) -> None:
    payload: dict[ str, Any ] = copy.deepcopy( full_context )
    target: Any = payload
    for part in path.split( "." ) if path else []:
        target = target[ int( part ) if part.isdigit() else part ]
    target[ "unexpected" ] = True

    with pytest.raises( ValidationError ):
        StepContext.model_validate( payload )
