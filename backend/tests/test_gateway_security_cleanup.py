from src.gateway.app import create_app


def test_gateway_does_not_expose_security_audit_route() -> None:
    app = create_app()
    route_paths = {route.path for route in app.routes}

    assert "/api/security/audit" not in route_paths
