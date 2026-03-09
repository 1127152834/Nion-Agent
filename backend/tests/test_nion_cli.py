import json
from unittest.mock import patch

from src.nion_cli import main
from src.security.audit import AuditFinding, AuditReport


def _report_with_findings(findings: list[AuditFinding]) -> AuditReport:
    return AuditReport(
        generated_at="2026-03-08T00:00:00+00:00",
        findings=findings,
    )


def test_nion_cli_audit_fail_on_medium_returns_non_zero(capsys):
    report = _report_with_findings(
        [
            AuditFinding(
                code="sandbox.local_runtime",
                severity="medium",
                title="local",
                detail="detail",
                recommendation="fix",
            )
        ]
    )
    with patch("src.nion_cli.run_security_audit", return_value=report):
        exit_code = main(["security", "audit", "--fail-on", "medium"])

    assert exit_code == 2
    out = capsys.readouterr().out
    assert "Nion Security Audit" in out


def test_nion_cli_audit_json_output(capsys):
    report = _report_with_findings([])
    with patch("src.nion_cli.run_security_audit", return_value=report):
        exit_code = main(["security", "audit", "--json"])

    assert exit_code == 0
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload["generated_at"] == "2026-03-08T00:00:00+00:00"
