"""Keychain manager for credential and session management."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from src.config.paths import NION_DATA_DIR
from src.keychain.encryption import KeychainEncryption
from src.keychain.models import Credential, CredentialType, SessionState


class KeychainManager:
    """Manages credentials and CLI sessions."""

    def __init__(self, data_dir: Path | None = None):
        """Initialize keychain manager.

        Args:
            data_dir: Data directory (defaults to .nion/keychain)
        """
        self.data_dir = data_dir or NION_DATA_DIR / "keychain"
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.db_path = self.data_dir / "credentials.db"
        self.sessions_dir = self.data_dir / "sessions"
        self.sessions_dir.mkdir(exist_ok=True)

        self.encryption = KeychainEncryption(self.data_dir / "master.key")
        self._lock = threading.Lock()
        self._init_database()

    def _init_database(self):
        """Initialize SQLite database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS credentials (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    service TEXT NOT NULL,
                    account TEXT,
                    secret TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_service ON credentials(service)")
            conn.commit()

    # ==================== Credential Management ====================

    def store_credential(
        self,
        service: str,
        credential_type: CredentialType,
        secret: str,
        account: str | None = None,
        metadata: dict[str, Any] | None = None,
        expires_in: timedelta | None = None,
    ) -> Credential:
        """Store a credential.

        Args:
            service: Service name (e.g., "xhs-cli")
            credential_type: Type of credential
            secret: Secret value (will be encrypted)
            account: Account/username
            metadata: Additional metadata
            expires_in: Expiration duration

        Returns:
            Stored credential
        """
        with self._lock:
            cred_id = f"{service}:{credential_type.value}"
            if account:
                cred_id += f":{account}"

            encrypted_secret = self.encryption.encrypt(secret)
            now = datetime.utcnow()
            expires_at = now + expires_in if expires_in else None

            credential = Credential(
                id=cred_id,
                type=credential_type,
                service=service,
                account=account,
                secret=encrypted_secret,
                metadata=metadata or {},
                created_at=now,
                updated_at=now,
                expires_at=expires_at,
            )

            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO credentials
                    (id, type, service, account, secret, metadata, created_at, updated_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        credential.id,
                        credential.type.value,
                        credential.service,
                        credential.account,
                        credential.secret,
                        json.dumps(credential.metadata),
                        credential.created_at.isoformat(),
                        credential.updated_at.isoformat(),
                        credential.expires_at.isoformat() if credential.expires_at else None,
                    ),
                )
                conn.commit()

            return credential

    def get_credential(self, service: str, credential_type: CredentialType, account: str | None = None) -> Credential | None:
        """Get a credential.

        Args:
            service: Service name
            credential_type: Type of credential
            account: Account/username (optional)

        Returns:
            Credential if found, None otherwise
        """
        with self._lock:
            cred_id = f"{service}:{credential_type.value}"
            if account:
                cred_id += f":{account}"

            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("SELECT * FROM credentials WHERE id = ?", (cred_id,))
                row = cursor.fetchone()

                if not row:
                    return None

                # Check expiration
                if row["expires_at"]:
                    expires_at = datetime.fromisoformat(row["expires_at"])
                    if expires_at < datetime.utcnow():
                        # Expired, delete it
                        conn.execute("DELETE FROM credentials WHERE id = ?", (cred_id,))
                        conn.commit()
                        return None

                return Credential(
                    id=row["id"],
                    type=CredentialType(row["type"]),
                    service=row["service"],
                    account=row["account"],
                    secret=row["secret"],
                    metadata=json.loads(row["metadata"]),
                    created_at=datetime.fromisoformat(row["created_at"]),
                    updated_at=datetime.fromisoformat(row["updated_at"]),
                    expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
                )

    def get_credential_value(self, service: str, credential_type: CredentialType, account: str | None = None) -> str | None:
        """Get decrypted credential value.

        Args:
            service: Service name
            credential_type: Type of credential
            account: Account/username (optional)

        Returns:
            Decrypted secret value if found, None otherwise
        """
        credential = self.get_credential(service, credential_type, account)
        if not credential:
            return None

        return self.encryption.decrypt(credential.secret)

    def list_credentials(self, service: str | None = None) -> list[Credential]:
        """List all credentials.

        Args:
            service: Filter by service name (optional)

        Returns:
            List of credentials (secrets are still encrypted)
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                if service:
                    cursor = conn.execute("SELECT * FROM credentials WHERE service = ?", (service,))
                else:
                    cursor = conn.execute("SELECT * FROM credentials")

                credentials = []
                for row in cursor.fetchall():
                    credentials.append(
                        Credential(
                            id=row["id"],
                            type=CredentialType(row["type"]),
                            service=row["service"],
                            account=row["account"],
                            secret=row["secret"],
                            metadata=json.loads(row["metadata"]),
                            created_at=datetime.fromisoformat(row["created_at"]),
                            updated_at=datetime.fromisoformat(row["updated_at"]),
                            expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
                        )
                    )

                return credentials

    def delete_credential(self, service: str, credential_type: CredentialType, account: str | None = None) -> bool:
        """Delete a credential.

        Args:
            service: Service name
            credential_type: Type of credential
            account: Account/username (optional)

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            cred_id = f"{service}:{credential_type.value}"
            if account:
                cred_id += f":{account}"

            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("DELETE FROM credentials WHERE id = ?", (cred_id,))
                conn.commit()
                return cursor.rowcount > 0

    # ==================== Session Management ====================

    def save_session(self, session: SessionState):
        """Save CLI session state.

        Args:
            session: Session state to save
        """
        with self._lock:
            session_file = self.sessions_dir / f"{session.service}.json"
            session_data = {
                "service": session.service,
                "session_id": session.session_id,
                "cookies": session.cookies,
                "tokens": session.tokens,
                "environment": session.environment,
                "working_dir": session.working_dir,
                "last_active": session.last_active.isoformat(),
                "expires_at": session.expires_at.isoformat() if session.expires_at else None,
            }

            # Encrypt sensitive data
            if session.cookies:
                session_data["cookies"] = {k: self.encryption.encrypt(v) for k, v in session.cookies.items()}
            if session.tokens:
                session_data["tokens"] = {k: self.encryption.encrypt(v) for k, v in session.tokens.items()}

            session_file.write_text(json.dumps(session_data, indent=2))

    def load_session(self, service: str) -> SessionState | None:
        """Load CLI session state.

        Args:
            service: Service name

        Returns:
            Session state if found, None otherwise
        """
        with self._lock:
            session_file = self.sessions_dir / f"{service}.json"
            if not session_file.exists():
                return None

            session_data = json.loads(session_file.read_text())

            # Check expiration
            if session_data.get("expires_at"):
                expires_at = datetime.fromisoformat(session_data["expires_at"])
                if expires_at < datetime.utcnow():
                    session_file.unlink()
                    return None

            # Decrypt sensitive data
            cookies = {}
            if session_data.get("cookies"):
                cookies = {k: self.encryption.decrypt(v) for k, v in session_data["cookies"].items()}

            tokens = {}
            if session_data.get("tokens"):
                tokens = {k: self.encryption.decrypt(v) for k, v in session_data["tokens"].items()}

            return SessionState(
                service=session_data["service"],
                session_id=session_data["session_id"],
                cookies=cookies,
                tokens=tokens,
                environment=session_data.get("environment", {}),
                working_dir=session_data.get("working_dir"),
                last_active=datetime.fromisoformat(session_data["last_active"]),
                expires_at=datetime.fromisoformat(session_data["expires_at"]) if session_data.get("expires_at") else None,
            )

    def delete_session(self, service: str) -> bool:
        """Delete CLI session state.

        Args:
            service: Service name

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            session_file = self.sessions_dir / f"{service}.json"
            if session_file.exists():
                session_file.unlink()
                return True
            return False


# Global singleton
_keychain: KeychainManager | None = None
_keychain_lock = threading.Lock()


def get_keychain() -> KeychainManager:
    """Get the global keychain manager instance."""
    global _keychain
    if _keychain is None:
        with _keychain_lock:
            if _keychain is None:
                _keychain = KeychainManager()
    return _keychain
