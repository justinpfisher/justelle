import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { buildEnvironment } from './deployment-config.mjs';

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const firebaseCli = join(appDirectory, 'node_modules/firebase-tools/lib/bin/firebase.js');
const qualificationTarget = 'justelle-private-qualification';
const maxCliOutputBytes = 1024 * 1024;

const safeCodes = new Set(['CONFIG_INVALID', 'PROJECT_MISMATCH', 'TARGET_MISMATCH', 'ORIGIN_MISMATCH', 'SITE_LIST_UNAVAILABLE', 'SITE_NOT_FOUND', 'CONFIG_UNAVAILABLE', 'SITE_LIST_FAILED', 'SITE_READY']);

function blocked(code) {
  return { ready: false, code };
}

export function parseHostingSitesList(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > maxCliOutputBytes) return null;
  try {
    const envelope = JSON.parse(stdout);
    if (envelope?.status !== 'success' || !Array.isArray(envelope?.result?.sites)) return null;
    return envelope.result.sites;
  } catch {
    return null;
  }
}

export function validateQualificationHostingTarget({
  deploymentConfig,
  firebaseConfig,
  expectedProjectId,
  sites
}) {
  if (!deploymentConfig || typeof deploymentConfig !== 'object' ||
      !firebaseConfig || typeof firebaseConfig !== 'object') return blocked('CONFIG_INVALID');
  try {
    buildEnvironment(deploymentConfig);
  } catch {
    return blocked('CONFIG_INVALID');
  }
  if (deploymentConfig.mode !== 'hosted-fictional' ||
      typeof expectedProjectId !== 'string' ||
      deploymentConfig.projectId !== expectedProjectId) return blocked('PROJECT_MISMATCH');
  if (firebaseConfig.hosting?.target !== qualificationTarget) return blocked('TARGET_MISMATCH');
  if (deploymentConfig.origin !== 'https://' + deploymentConfig.site + '.web.app') {
    return blocked('ORIGIN_MISMATCH');
  }
  if (!Array.isArray(sites)) return blocked('SITE_LIST_UNAVAILABLE');
  const siteExistsInProjectInventory = sites.some(site => {
    if (!site || typeof site.name !== 'string') return false;
    const resource = /^projects\/([^/]+)\/sites\/([^/]+)$/.exec(site.name);
    if (!resource || resource[2] !== deploymentConfig.site) return false;
    // The CLI request is scoped with --project expectedProjectId. Hosting may
    // canonicalize the resource path with that project's numeric ID instead.
    return resource[1] === expectedProjectId || /^[1-9][0-9]{0,19}$/.test(resource[1]);
  });
  if (!siteExistsInProjectInventory) {
    return blocked('SITE_NOT_FOUND');
  }
  return { ready: true, code: 'SITE_READY' };
}

export async function inspectQualificationHostingTarget({
  configPath,
  expectedProjectId,
  runCommand = execute,
  cliPath = firebaseCli,
  cwd = appDirectory
}) {
  let deploymentConfig;
  let firebaseConfig;
  try {
    deploymentConfig = JSON.parse(await readFile(configPath, 'utf8'));
    firebaseConfig = JSON.parse(await readFile(join(appDirectory, 'hosting/firebase.json'), 'utf8'));
  } catch {
    return blocked('CONFIG_UNAVAILABLE');
  }

  const preliminary = validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId,
    sites: []
  });
  if (preliminary.code !== 'SITE_NOT_FOUND') return preliminary;

  let stdout;
  try {
    ({ stdout } = await runCommand(process.execPath, [
      cliPath,
      'hosting:sites:list',
      '--json',
      '--project',
      expectedProjectId
    ], {
      cwd,
      maxBuffer: maxCliOutputBytes,
      windowsHide: true
    }));
  } catch {
    return blocked('SITE_LIST_FAILED');
  }

  const sites = parseHostingSitesList(stdout);
  if (!sites) return blocked('SITE_LIST_UNAVAILABLE');
  return validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId,
    sites
  });
}

export function safePreflightSummary(result) {
  return JSON.stringify({
    phase: 'qualification-hosting-preflight',
    status: result?.ready === true ? 'ready' : 'blocked',
    code: safeCodes.has(result?.code) ? result.code : 'PREFLIGHT_FAILED'
  });
}

async function main(configPath) {
  const result = await inspectQualificationHostingTarget({
    configPath,
    expectedProjectId: process.env.JUSTELLE_PROJECT_ID
  });
  process.stdout.write(safePreflightSummary(result) + '\n');
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}

