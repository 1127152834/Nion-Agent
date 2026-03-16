install:
	uv sync

dev:
	uv run langgraph dev --no-browser --allow-blocking --no-reload

gateway:
	PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001

test:
	PYTHONPATH=. uv run pytest tests/ -v

lint:
	uvx ruff check .

format:
	uvx ruff check . --fix && uvx ruff format .

# Coverage (pytest-cov) - report only, does not change the default `make test` behavior.
coverage:
	PYTHONPATH=. uv run pytest tests/ -v --cov=nion --cov=app --cov-report=term-missing --cov-report=xml

coverage-html:
	PYTHONPATH=. uv run pytest tests/ -v --cov=nion --cov=app --cov-report=term-missing --cov-report=html

# Dead code candidate scan (heuristic). Use as an input signal for cleanup, NOT as a hard gate by default.
deadcode:
	uv run vulture packages/harness/nion app --min-confidence 80
