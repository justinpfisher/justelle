import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  inspectQualificationHostingTarget,
  parseHostingSitesList,
  safePreflightSummary,
  validateQualificationHostingTarget
} from '../hosting/qualification-site-preflight.mjs';

const projectId = 'justelle-qualification';
const siteId = 'justelle-qualification';
const deploymentConfig = {
  mode: 'hosted-fictional',
  projectId,
  otherProjectId: 'justelle-production',
  site: siteId,
  origin: 'https://' + siteId + '.web.app',
  roomId: 'fictional-room',
  apiKey: 'FAKE_API_KEY_DO_NOT_LOG',
  gatewayServiceAccount: 'justelle-gateway@' + projectId + '.iam.gserviceaccount.com',
  backupServiceAccount: 'justelle-backup@' + projectId + '.iam.gserviceaccount.com'
};
const firebaseConfig = { hosting: { target: 'justelle-private-qualification' } };
const siteResource = { name: 'projects/' + projectId + '/sites/' + siteId };
const numberedProjectSiteResource = { name: 'projects/123456789012/sites/' + siteId };
let configPath;
let tempDirectory;

test.before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'justelle-hosting-preflight-'));
  configPath = join(tempDirectory, 'qualification.json');
  await writeFile(configPath, JSON.stringify(deploymentConfig));
});

test.after(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

test('parses only the pinned Firebase CLI JSON success envelope', () => {
  assert.deepEqual(parseHostingSitesList(JSON.stringify({
    status: 'success',
    result: { sites: [siteResource] }
  })), [siteResource]);
  assert.equal(parseHostingSitesList('not-json'), null);
  assert.equal(parseHostingSitesList(JSON.stringify({ status: 'error', error: 'FAKE_SECRET' })), null);
  assert.equal(parseHostingSitesList('x'.repeat(1024 * 1024 + 1)), null);
});

test('reports ready only when the private target resolves to an existing site', () => {
  assert.deepEqual(validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId: projectId,
    sites: [siteResource]
  }), { ready: true, code: 'SITE_READY' });
});

test('accepts a canonical numeric project resource name from the project-scoped site inventory', () => {
  assert.deepEqual(validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId: projectId,
    sites: [numberedProjectSiteResource]
  }), { ready: true, code: 'SITE_READY' });
});

test('blocks wrong-project, wrong-site and malformed resources in the site inventory', () => {
  for (const site of [
    { name: 'projects/another-project/sites/' + siteId },
    { name: 'projects/123456789012/sites/other-site' },
    { name: 'projects/123456789012/other/' + siteId },
    { name: 'projects//sites/' + siteId },
    { name: 'projects/000000000000/sites/' + siteId }
  ]) assert.deepEqual(validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId: projectId,
    sites: [site]
  }), { ready: false, code: 'SITE_NOT_FOUND' });
});

test('blocks project and target mismatches before querying Hosting', () => {
  assert.equal(validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig,
    expectedProjectId: 'other-project',
    sites: [siteResource]
  }).code, 'PROJECT_MISMATCH');
  assert.equal(validateQualificationHostingTarget({
    deploymentConfig,
    firebaseConfig: { hosting: { target: 'unexpected-target' } },
    expectedProjectId: projectId,
    sites: [siteResource]
  }).code, 'TARGET_MISMATCH');
});

test('uses only the read-only Hosting sites list and keeps CLI failures private', async () => {
  let called = false;
  const result = await inspectQualificationHostingTarget({
    configPath,
    expectedProjectId: projectId,
    runCommand: async (_exe, args, options) => {
      called = true;
      assert.deepEqual(args.slice(1, 4), ['hosting:sites:list', '--json', '--project']);
      assert.equal(args[4], projectId);
      assert.equal(basename(options.cwd), 'private-app');
      return { stdout: JSON.stringify({ status: 'success', result: { sites: [numberedProjectSiteResource] } }) };
    }
  });
  assert.equal(called, true);
  assert.deepEqual(result, { ready: true, code: 'SITE_READY' });

  const failed = await inspectQualificationHostingTarget({
    configPath,
    expectedProjectId: projectId,
    runCommand: async () => {
      throw Object.assign(new Error('FAKE_API_KEY_DO_NOT_LOG'), {
        stdout: 'FAKE_RESPONSE_DO_NOT_LOG',
        stderr: 'FAKE_PRIVATE_DETAIL_DO_NOT_LOG'
      });
    }
  });
  const summary = safePreflightSummary(failed);
  assert.deepEqual(failed, { ready: false, code: 'SITE_LIST_FAILED' });
  for (const marker of ['FAKE_API_KEY_DO_NOT_LOG', 'FAKE_RESPONSE_DO_NOT_LOG', 'FAKE_PRIVATE_DETAIL_DO_NOT_LOG']) {
    assert.equal(summary.includes(marker), false);
  }
});

test('safe summary contains only fixed readiness fields', () => {
  const summary = safePreflightSummary({ ready: false, code: 'FAKE_PROJECT_ID_DO_NOT_LOG' });
  assert.deepEqual(JSON.parse(summary), {
    phase: 'qualification-hosting-preflight',
    status: 'blocked',
    code: 'PREFLIGHT_FAILED'
  });
  assert.equal(summary.includes('FAKE_PROJECT_ID_DO_NOT_LOG'), false);
});

