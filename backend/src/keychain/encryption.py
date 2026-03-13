"""Encryption utilities for keychain."""

from __future__ import annotations

import base64
import os
from pathlib import Path

from cryptography.fernet import Fernet


class KeychainEncryption:
    """Handles encryption/decryption for keychain."""

    def __init__(self, key_path: Path):
        """Initialize encryption with master key.

        Args:
            key_path: Path to master key file
        """
        self.key_path = key_path
        self._fernet: Fernet | None = None

    def _ensure_master_key(self) -> bytes:
        """Ensure master key exists, create if not."""
        if self.key_path.exists():
            return self.key_path.read_bytes()

        # Generate new master key
        key = Fernet.generate_key()
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        self.key_path.write_bytes(key)
        self.key_path.chmod(0o600)  # Owner read/write only
        return key

    def _get_fernet(self) -> Fernet:
        """Get Fernet cipher instance."""
        if self._fernet is None:
            key = self._ensure_master_key()
            self._fernet = Fernet(key)
        return self._fernet

    def encrypt(self, plaintext: str) -> str:
        """Encrypt plaintext string.

        Args:
            plaintext: String to encrypt

        Returns:
            Base64-encoded encrypted string
        """
        fernet = self._get_fernet()
        encrypted = fernet.encrypt(plaintext.encode("utf-8"))
        return base64.b64encode(encrypted).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt ciphertext string.

        Args:
            ciphertext: Base64-encoded encrypted string

        Returns:
            Decrypted plaintext string
        """
        fernet = self._get_fernet()
        encrypted = base64.b64decode(ciphertext.encode("ascii"))
        decrypted = fernet.decrypt(encrypted)
        return decrypted.decode("utf-8")
