// Local guard only. Does not authenticate to GCP or deploy resources.
import assert from 'node:assert/strict';
const config = { budgetUsd: 50, approved: process.env.CLOUD_APPLY_APPROVED === 'true' };
function canApply(estimatedUsd) {
  return config.approved && estimatedUsd <= config.budgetUsd;
}
assert.equal(canApply(10), false); // Safe default: deny when not approved.
assert.equal(canApply(100), false);
console.log('CLOUD_GUARD_DEFAULT_DENY_OK');
