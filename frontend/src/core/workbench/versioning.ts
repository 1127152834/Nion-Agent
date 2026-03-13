const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
};

export function parseSemver(version: string | null | undefined): ParsedSemver | null {
  if (!version) {
    return null;
  }
  const normalized = version.trim();
  const match = SEMVER_RE.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
  };
}

export function isSemver(version: string | null | undefined): boolean {
  return parseSemver(version) !== null;
}

export function normalizeSemver(version: string | null | undefined, fallback = "0.1.0"): string {
  return isSemver(version) ? version!.trim() : fallback;
}

export function compareSemver(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  return 0;
}

export function incrementPatch(version: string | null | undefined, fallback = "0.1.0"): string {
  const parsed = parseSemver(version);
  if (!parsed) {
    return fallback;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/**
 * Marketplace list/detail may report a newer version even when the downloaded .nwp manifest
 * omits `version`. Prefer the higher semver so UI reflects the marketplace state.
 */
export function resolveInstalledPluginVersion(current: string, marketplace?: string | null): string {
  const normalizedCurrent = normalizeSemver(current, "0.1.0");
  const candidate = typeof marketplace === "string" ? marketplace.trim() : "";
  if (!isSemver(candidate)) {
    return normalizedCurrent;
  }
  return compareSemver(candidate, normalizedCurrent) > 0 ? candidate : normalizedCurrent;
}
