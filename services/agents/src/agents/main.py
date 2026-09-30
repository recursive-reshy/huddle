from anthropic import AsyncAnthropic
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from agents.config import Settings
from agents.contract.errors import ErrorCode
from agents.contract.lines import ErrorLine
from agents.contract.request import StepRequest
from agents.roles.registry import registry
from agents.runtime.claude import stream_chat_reply
from agents.runtime.context import build_system, build_turns
from agents.runtime.fake import stream_fake_step
from agents.runtime.prompts import load_prompt
from agents.runtime.stream import to_ndjson

def create_app( settings: Settings | None = None ) -> FastAPI:
    if settings is None:
        settings = Settings()

    app = FastAPI( docs_url = None, redoc_url = None, openapi_url = None )

    if not settings.is_fake:
        for agent, kind in registry:
            load_prompt( settings.prompts_dir, agent, kind )

        if settings.anthropic_api_key is not None:
            app.state.anthropic_client = AsyncAnthropic( api_key = settings.anthropic_api_key.get_secret_value() )

    @app.get( "/healthz" )
    def healthz() -> dict[ str, str ]:
        return { "status": "ok" }

    @app.post( "/v1/steps" )
    async def steps( request: Request ) -> StreamingResponse:
        body = await request.body()

        try:
            step_request = StepRequest.model_validate_json( body )
        except ValidationError as exception:
            invalid_request = ErrorLine(
                type = "error",
                code = ErrorCode.INVALID_REQUEST,
                message = f"Step request failed validation ({exception.error_count()} errors)",
                retryable = False
            )

            return StreamingResponse(
                iter( [ to_ndjson( invalid_request ) ] ),
                media_type = "application/x-ndjson"
            )

        if ( step_request.agent, step_request.kind ) not in registry:
            unknown_kind = ErrorLine(
                type = "error",
                code = ErrorCode.UNKNOWN_KIND,
                message = f"No handler for agent {step_request.agent!r} and kind {step_request.kind!r}",
                retryable = False
            )

            return StreamingResponse(
                iter( [ to_ndjson( unknown_kind ) ] ),
                media_type = "application/x-ndjson"
            )

        if not settings.is_fake:
            prompt = load_prompt( settings.prompts_dir, step_request.agent, step_request.kind )
            turns_result = build_turns( step_request.context.messages )

            if turns_result.reason is not None:
                invalid_turns = ErrorLine(
                    type = "error",
                    code = ErrorCode.INVALID_REQUEST,
                    message = turns_result.reason,
                    retryable = False
                )

                return StreamingResponse(
                    iter( [ to_ndjson( invalid_turns ) ] ),
                    media_type = "application/x-ndjson"
                )

            system = build_system( prompt.body, step_request.context.project )

            return StreamingResponse(
                (
                    to_ndjson( line )
                    async for line in stream_chat_reply(
                        app.state.anthropic_client,
                        step_request.model,
                        prompt,
                        system,
                        turns_result.turns
                    )
                ),
                media_type = "application/x-ndjson"
            )

        return StreamingResponse(
            ( to_ndjson( line ) for line in stream_fake_step( step_request ) ),
            media_type = "application/x-ndjson"
        )

    return app
