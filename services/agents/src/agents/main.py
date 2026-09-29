from fastapi import FastAPI

from agents.config import Settings

def create_app( settings: Settings | None = None ) -> FastAPI:
    if settings is None:
        settings = Settings()

    app = FastAPI( docs_url = None, redoc_url = None, openapi_url = None )

    @app.get( "/healthz" )
    def healthz() -> dict[ str, str ]:
        return { "status": "ok" }

    return app
