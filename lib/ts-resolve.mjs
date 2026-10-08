// Test-only: lets node --experimental-strip-types load server.ts, whose relative imports
// are written as ".js" for the bundler (./contracts.js -> contracts.ts).
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      try {
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      } catch {
        // fall through to the plain specifier
      }
    }
    return nextResolve(specifier, context);
  },
});
