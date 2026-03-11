import { validate as validateUUID, version as uuidVersion, v4 as uuidV4 } from "uuid";

export const uuid = uuidV4;

export function isUUID(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  if (!validateUUID(value)) {
    return false;
  }
  return uuidVersion(value) === 4;
}
