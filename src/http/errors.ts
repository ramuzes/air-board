// src/http/errors.ts
export function httpError(status: number, code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { status, code, details }) as Error & { status: number; code: string; details?: unknown }
}
