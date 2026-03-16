"""Nion command line entrypoint."""

from __future__ import annotations

import argparse
import json
import sys

from src.security.audit import Severity, run_security_audit, severity_at_least


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="nion")
    subparsers = parser.add_subparsers(dest="command")

    security_parser = subparsers.add_parser("security", help="Security tools")
    security_subparsers = security_parser.add_subparsers(dest="security_command")

    audit_parser = security_subparsers.add_parser("audit", help="Run security audit checks")
    audit_parser.add_argument("--json", action="store_true", dest="as_json", help="Print machine-readable JSON output")
    audit_parser.add_argument(
        "--fail-on",
        choices=["low", "medium", "high"],
        default="high",
        help="Exit with non-zero if any finding meets or exceeds this severity (default: high)",
    )

    return parser.parse_args(argv)


def _print_human_report(report_dict: dict) -> None:
    print("Nion Security Audit")
    print(f"generated_at: {report_dict['generated_at']}")
    counts = report_dict["counts"]
    print(f"counts: info={counts['info']} low={counts['low']} medium={counts['medium']} high={counts['high']}")
    print(f"highest_severity: {report_dict['highest_severity']}")
    print()

    findings = report_dict["findings"]
    if not findings:
        print("No findings.")
        return
    for idx, finding in enumerate(findings, start=1):
        print(f"{idx}. [{finding['severity'].upper()}] {finding['title']} ({finding['code']})")
        print(f"   detail: {finding['detail']}")
        print(f"   recommendation: {finding['recommendation']}")


def _run_security_audit(*, as_json: bool, fail_on: Severity) -> int:
    report = run_security_audit()
    report_dict = report.as_dict()

    if as_json:
        print(json.dumps(report_dict, ensure_ascii=False, indent=2))
    else:
        _print_human_report(report_dict)

    should_fail = any(severity_at_least(finding.severity, fail_on) for finding in report.findings)
    return 2 if should_fail else 0


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.command == "security" and args.security_command == "audit":
        fail_on = args.fail_on  # type: ignore[assignment]
        return _run_security_audit(as_json=bool(args.as_json), fail_on=fail_on)

    # Print help if command is incomplete or unknown
    _parse_args(["-h"])
    return 1


if __name__ == "__main__":
    sys.exit(main())
