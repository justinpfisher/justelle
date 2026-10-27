import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseScope,requireHostedEvidence} from './release-scope.mjs';

test('documentation does not run private infrastructure qualification',()=>{
  assert.deepEqual(releaseScope(['AGENTS.md','private-app/README.md','private-app/hosting/OPERATIONS.md']),
    {code:false,windows:false,hosted:false});
});
test('known compatible interface changes keep source/browser checks without paid requalification',()=>{
  assert.deepEqual(releaseScope(['private-app/web/styles.css','private-app/web/planner-ui.mjs']),
    {code:true,windows:false,hosted:false});
});
test('access, data, recovery, dependencies, deployment and unknown runtime changes require hosted checks',()=>{
  for(const p of ['web/runtime-config.mjs','web/planner-backend.mjs','web/itinerary-core.mjs',
    'web/protected-media.mjs','web/main.mjs','web/new-feature.mjs','firebase/firestore.rules',
    'hosting/deploy.mjs','hosting/accept-hosted.mjs','memory/encrypted-backup.mjs',
    'ai/vision-provider.mjs','package-lock.json'])assert.equal(releaseScope(['private-app/'+p]).hosted,true,p);
  assert.equal(releaseScope(['.github/workflows/justelle-private-app.yml']).hosted,true);
  assert.equal(releaseScope(['scripts/release-scope.mjs']).hosted,true);
  assert.equal(releaseScope(['scripts/hosted-qualification-policy.mjs']).hosted,true);
  assert.equal(releaseScope(['scripts/hosted-qualification-policy.test.mjs']).hosted,true);
});
test('Windows runner checks are limited to runner/dependency/configuration changes',()=>{
  assert.equal(releaseScope(['private-app/tools/preview.mjs']).windows,true);
  assert.equal(releaseScope(['private-app/package-lock.json']).windows,true);
  assert.equal(releaseScope(['private-app/web/styles.css']).windows,false);
  assert.equal(releaseScope(['private-app/firebase/firestore.rules']).windows,false);
});
test('missing comparison and manual full checks fail safe; test-only changes keep source checks',()=>{
  assert.deepEqual(releaseScope(null),{code:true,windows:true,hosted:true});
  assert.deepEqual(releaseScope(['private-app/tests/hosting.test.mjs']),{code:true,windows:false,hosted:false});
});
test('an interface follow-up cannot bypass an earlier undeployed sensitive change',()=>{
  // Deployment compares against the last verified service, not just the previous commit.
  const cumulative=['private-app/web/styles.css','private-app/firebase/firestore.rules'];
  assert.throws(()=>requireHostedEvidence(cumulative,false),/last verified release/);
  assert.doesNotThrow(()=>requireHostedEvidence(cumulative,true));
  assert.throws(()=>requireHostedEvidence(null,false),/Hosted qualification/);
  assert.doesNotThrow(()=>requireHostedEvidence(['private-app/web/styles.css'],false));
});
