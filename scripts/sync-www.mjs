import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const srcDir = resolve(process.cwd(), '..', 'webapp', 'public');
const destDir = resolve(process.cwd(), 'www');

// Ensure www directory is always synced cleanly if ../webapp/public exists (local dev),
// while preserving committed www/ inside CI where ../webapp doesn't exist.
import { existsSync } from 'node:fs';
if (existsSync(srcDir)) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
  console.log('[sync-www] Synced ../webapp/public -> ./www');
} else if (existsSync(destDir)) {
  console.log('[sync-www] Using committed ./www bundle (CI environment)');
} else {
  throw new Error('Neither ../webapp/public nor ./www exists!');
}
