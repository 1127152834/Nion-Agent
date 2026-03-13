"""Nion Keychain CLI tool for credential management."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path

from src.keychain import CredentialType, get_keychain


def cmd_store(args):
    """Store a credential."""
    keychain = get_keychain()

    # Read secret from stdin if not provided
    secret = args.secret
    if not secret:
        import getpass

        if args.type == "password":
            secret = getpass.getpass("Enter password: ")
        else:
            secret = input("Enter secret: ")

    # Parse expiration
    expires_in = None
    if args.expires:
        days = int(args.expires)
        expires_in = timedelta(days=days)

    # Parse metadata
    metadata = {}
    if args.metadata:
        metadata = json.loads(args.metadata)

    credential = keychain.store_credential(
        service=args.service,
        credential_type=CredentialType(args.type),
        secret=secret,
        account=args.account,
        metadata=metadata,
        expires_in=expires_in,
    )

    print(f"✓ Stored credential: {credential.id}")


def cmd_get(args):
    """Get a credential value."""
    keychain = get_keychain()

    value = keychain.get_credential_value(
        service=args.service,
        credential_type=CredentialType(args.type),
        account=args.account,
    )

    if value is None:
        print(f"✗ Credential not found", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps({"value": value}))
    else:
        print(value)


def cmd_list(args):
    """List credentials."""
    keychain = get_keychain()

    credentials = keychain.list_credentials(service=args.service)

    if args.json:
        data = [
            {
                "id": c.id,
                "type": c.type.value,
                "service": c.service,
                "account": c.account,
                "created_at": c.created_at.isoformat(),
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
            }
            for c in credentials
        ]
        print(json.dumps(data, indent=2))
    else:
        if not credentials:
            print("No credentials found")
            return

        print(f"{'ID':<40} {'Type':<12} {'Service':<20} {'Account':<20}")
        print("-" * 92)
        for c in credentials:
            account = c.account or "-"
            print(f"{c.id:<40} {c.type.value:<12} {c.service:<20} {account:<20}")


def cmd_delete(args):
    """Delete a credential."""
    keychain = get_keychain()

    deleted = keychain.delete_credential(
        service=args.service,
        credential_type=CredentialType(args.type),
        account=args.account,
    )

    if deleted:
        print(f"✓ Deleted credential")
    else:
        print(f"✗ Credential not found", file=sys.stderr)
        sys.exit(1)


def cmd_session_list(args):
    """List CLI sessions."""
    keychain = get_keychain()

    sessions_dir = keychain.sessions_dir
    if not sessions_dir.exists():
        print("No sessions found")
        return

    sessions = []
    for session_file in sessions_dir.glob("*.json"):
        session = keychain.load_session(session_file.stem)
        if session:
            sessions.append(session)

    if args.json:
        data = [
            {
                "service": s.service,
                "session_id": s.session_id,
                "last_active": s.last_active.isoformat(),
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            }
            for s in sessions
        ]
        print(json.dumps(data, indent=2))
    else:
        if not sessions:
            print("No sessions found")
            return

        print(f"{'Service':<20} {'Session ID':<40} {'Last Active':<25}")
        print("-" * 85)
        for s in sessions:
            print(f"{s.service:<20} {s.session_id:<40} {s.last_active.isoformat():<25}")


def cmd_session_delete(args):
    """Delete a CLI session."""
    keychain = get_keychain()

    deleted = keychain.delete_session(args.service)

    if deleted:
        print(f"✓ Deleted session for {args.service}")
    else:
        print(f"✗ Session not found", file=sys.stderr)
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Nion Keychain - Unified credential management",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Store command
    store_parser = subparsers.add_parser("store", help="Store a credential")
    store_parser.add_argument("service", help="Service name (e.g., xhs-cli)")
    store_parser.add_argument("type", choices=[t.value for t in CredentialType], help="Credential type")
    store_parser.add_argument("--account", help="Account/username")
    store_parser.add_argument("--secret", help="Secret value (reads from stdin if not provided)")
    store_parser.add_argument("--expires", help="Expiration in days")
    store_parser.add_argument("--metadata", help="JSON metadata")
    store_parser.set_defaults(func=cmd_store)

    # Get command
    get_parser = subparsers.add_parser("get", help="Get a credential value")
    get_parser.add_argument("service", help="Service name")
    get_parser.add_argument("type", choices=[t.value for t in CredentialType], help="Credential type")
    get_parser.add_argument("--account", help="Account/username")
    get_parser.add_argument("--json", action="store_true", help="Output as JSON")
    get_parser.set_defaults(func=cmd_get)

    # List command
    list_parser = subparsers.add_parser("list", help="List credentials")
    list_parser.add_argument("--service", help="Filter by service")
    list_parser.add_argument("--json", action="store_true", help="Output as JSON")
    list_parser.set_defaults(func=cmd_list)

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a credential")
    delete_parser.add_argument("service", help="Service name")
    delete_parser.add_argument("type", choices=[t.value for t in CredentialType], help="Credential type")
    delete_parser.add_argument("--account", help="Account/username")
    delete_parser.set_defaults(func=cmd_delete)

    # Session commands
    session_parser = subparsers.add_parser("session", help="Manage CLI sessions")
    session_subparsers = session_parser.add_subparsers(dest="session_command")

    session_list_parser = session_subparsers.add_parser("list", help="List sessions")
    session_list_parser.add_argument("--json", action="store_true", help="Output as JSON")
    session_list_parser.set_defaults(func=cmd_session_list)

    session_delete_parser = session_subparsers.add_parser("delete", help="Delete a session")
    session_delete_parser.add_argument("service", help="Service name")
    session_delete_parser.set_defaults(func=cmd_session_delete)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if hasattr(args, "func"):
        args.func(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
