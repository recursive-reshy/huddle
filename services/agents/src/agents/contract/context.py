from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

class ArtifactKind( StrEnum ):
    BRIEF = "brief"
    PRD = "prd"
    TRD = "trd"

class QuestionStatus( StrEnum ):
    OPEN = "open"
    ANSWERED = "answered"
    DEFERRED = "deferred"
    ESCALATED = "escalated"

class MessageKind( StrEnum ):
    CHAT = "chat"
    DISCUSSION = "discussion"
    SUMMARY = "summary"
    SYSTEM = "system"

class TaskMode( StrEnum ):
    NORMAL = "normal"
    ESCALATION = "escalation"

class ProjectRef( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    id: str
    name: str

class Section( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    artifact_id: str
    version: int = Field( ge = 1 )
    kind: ArtifactKind
    section_key: str
    title: str
    content: str

class Decision( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    id: str
    title: str
    decision: str
    rationale: str

class Question( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    id: str
    thread_id: str
    round: int = Field( ge = 1 )
    from_agent: str
    to_agent: str
    question: str
    status: QuestionStatus
    answer: str | None
    answered_by: str | None

class ThreadMessage( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    author: str
    kind: MessageKind
    content: str

class Task( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    notes: str
    mode: TaskMode
    may_ask: bool = Field( strict = True )

class StepContext( BaseModel ):
    model_config = ConfigDict( extra = "forbid" )

    project: ProjectRef
    artifacts: list[ Section ]
    decisions: list[ Decision ]
    draft: list[ Section ]
    questions: list[ Question ]
    messages: list[ ThreadMessage ]
    task: Task
