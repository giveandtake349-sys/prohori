import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

function fail(message: string, details?: unknown) {
  return Object.assign(new Error(message), { status: 400, details });
}

/** Validates req.body against a zod schema; replaces req.body with parsed data. */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(fail('Invalid request body', result.error.flatten()));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** True when the error is a Postgres unique-violation (duplicate key). */
export function isPgUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === '23505'
  );
}

/** Express 5 types path params as string | string[] — collapse to one. */
export function pathParam(req: Request, name: string): string | undefined {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the param as a uuid string, or sends 400 and returns null. */
export function uuidParam(req: Request, res: Response, name: string): string | null {
  const v = pathParam(req, name);
  if (!v || !UUID_RE.test(v)) {
    res.status(400).json({ error: `invalid ${name}` });
    return null;
  }
  return v;
}
