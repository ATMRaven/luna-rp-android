#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function run(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: options.silent ? 'pipe' : 'inherit', ...options });
  } catch {
    if (!options.ignoreError) {
      console.error(`\x1b[31m[ERROR]\x1b[0m Command failed: ${command}`);
      process.exit(1);
    }
    return null;
  }
}

function runSilent(command) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })?.trim() || '';
  } catch {
    return '';
  }
}

function bumpVersion(current, bumpType) {
  const parts = current.split('.').map(p => parseInt(p, 10));
  if (parts.length < 3 || parts.some(isNaN)) {
    throw new Error(`Current version "${current}" is not valid semver (X.Y.Z)`);
  }
  let [major, minor, patch] = parts;
  if (bumpType === 'major') {
    major += 1; minor = 0; patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1; patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

async function main() {
  console.log('\n=== Luna RP Android Release Pipeline (GitHub Actions CI) ===');

  const gitStatus = runSilent('git status --porcelain');
  if (gitStatus.length > 0) {
    console.error('[ERROR] Working tree has uncommitted changes. Commit or stash first.');
    process.exit(1);
  }

  const pkgPath = resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  const rawBump = process.argv[2]?.toLowerCase() || 'patch';
  const bumpType = ['patch', 'minor', 'major'].includes(rawBump) ? rawBump : 'patch';
  const oldVersion = pkg.version || '1.0.0';
  const newVersion = bumpVersion(oldVersion, bumpType);
  const tagName = `v${newVersion}`;

  console.log(`Bumping version: ${oldVersion} -> ${newVersion} (${bumpType})`);
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  run('npm run build');
  run('git add -A');
  run(`git commit -m "chore(release): ${tagName}"`);
  run(`git tag ${tagName}`);
  run('git push');
  run('git push --tags');

  await new Promise(r => setTimeout(r, 3500));
  const repoSlug = runSilent('gh repo view --json nameWithOwner -q .nameWithOwner');
  const watchResult = spawnSync('gh', ['run', 'watch'], { stdio: 'inherit' });

  if (watchResult.status !== 0) {
    console.error('[ERROR] GitHub Actions build failed.');
    process.exit(1);
  }

  if (repoSlug) {
    console.log(`GitHub Release:  https://github.com/${repoSlug}/releases/tag/${tagName}`);
    console.log(`Latest Manifest: https://github.com/${repoSlug}/releases/latest/download/latest.json`);
    console.log(`Direct APK:      https://github.com/${repoSlug}/releases/latest/download/${pkg.name}-latest.apk`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
