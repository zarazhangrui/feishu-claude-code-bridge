import { homedir } from 'node:os';
import { join } from 'node:path';

// All paths derive from a single mutable `appDir`. Callers reach paths via
// the `paths` object's getters, so the derived values reflect whatever the
// current `appDir` is at access time.
//
// Default: `~/.lark-channel`. To run multiple bridge processes side-by-side
// (e.g. one bot per coding agent), each `start` invocation calls
// `configurePaths(<per-config-dir>)` early in boot, before any store / log
// / registry call. After that, all paths.* lookups in the process resolve
// under that directory — sessions, workspaces, logs, media cache, and the
// process-registry file are then per-app, with no cross-talk.

let appDir = join(homedir(), '.lark-channel');

export const paths = {
  get appDir(): string {
    return appDir;
  },
  get cacheDir(): string {
    return appDir;
  },
  get configFile(): string {
    return join(appDir, 'config.json');
  },
  get sessionsFile(): string {
    return join(appDir, 'sessions.json');
  },
  get workspacesFile(): string {
    return join(appDir, 'workspaces.json');
  },
  get processesFile(): string {
    return join(appDir, 'processes.json');
  },
  get mediaDir(): string {
    return join(appDir, 'media');
  },
};

/**
 * Override the runtime appDir. Call this exactly once during boot, before
 * any store / logger / registry access. Subsequent `paths.*` reads return
 * paths under `dir`.
 */
export function configurePaths(dir: string): void {
  appDir = dir;
}

/**
 * Pre-0.1.11 paths (XDG-style). Kept here only so the `migrate` command
 * can detect and move data out of the old location. Don't reference these
 * anywhere in the runtime.
 */
export const legacyPaths = {
  appDir: join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'lark-channel-bridge',
  ),
  cacheDir: join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'lark-channel-bridge',
  ),
};
