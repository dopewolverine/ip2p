// Express 4 does not catch rejected promises from async
// route handlers - a thrown error (e.g. a malformed UUID reaching
// Postgres) left the request hanging until the client timed out and
// surfaced only as an unhandledRejection. This patches the router layer
// once, at startup, so every async handler's rejection is passed to
// next(err) and reaches the JSON error handler in server.ts. Same
// technique as the widely used express-async-errors package, kept local
// to avoid a new dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer');

const original = Layer.prototype.handle_request;
if (!original.__ip2pPatched) {
  const patched = function handle(this: any, req: unknown, res: unknown, next: (err?: unknown) => void) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // error-handling middleware: same as Express's own behaviour
    try {
      const ret = fn(req, res, next);
      if (ret && typeof ret.then === 'function') ret.then(undefined, next);
    } catch (err) {
      next(err);
    }
  };
  (patched as any).__ip2pPatched = true;
  Layer.prototype.handle_request = patched;
}

export {};
