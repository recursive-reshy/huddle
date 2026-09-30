from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from agents.config import Settings
from agents.contract.errors import ErrorCode
from agents.contract.lines import ErrorLine
from agents.contract.request import StepRequest
from agents.roles.registry import registry
from agents.runtime.fake import stream_fake_step
from agents.runtime.stream import to_ndjson

def create_app( settings: Settings | None = None ) -> FastAPI:
    if settings is None:
        settings = Settings()

    app = FastAPI( docs_url = None, redoc_url = None, openapi_url = None )

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
            raise NotImplementedError

        return StreamingResponse(
            ( to_ndjson( line ) for line in stream_fake_step( step_request ) ),
            media_type = "application/x-ndjson"
        )

    return app
