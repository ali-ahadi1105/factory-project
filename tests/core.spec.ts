import { CanonicalUri, WorkStatus, ActorType, RelationType, ReferenceScheme } from '../src/core';

describe('Core Primitives & CanonicalUri', () => {
  it('should parse canonical URIs correctly', () => {
    const parsed = CanonicalUri.parse('github://issue/ali-ahadi1105/factory-project/42?tag=urgent');
    expect(parsed.scheme).toBe('github');
    expect(parsed.path).toBe('issue/ali-ahadi1105/factory-project/42');
    expect(parsed.params.tag).toBe('urgent');
  });

  it('should generate canonical URIs per concept v31', () => {
    expect(CanonicalUri.githubIssue('owner/repo', 12)).toBe('github://issue/owner/repo/12');
    expect(CanonicalUri.githubPr('owner/repo', 88)).toBe('github://pr/owner/repo/88');
    expect(CanonicalUri.gitCommit('abc1234')).toBe('git://commit/abc1234');
    expect(CanonicalUri.agentRun('agy', 'exec-1')).toBe('agent://agy/run/exec-1');
    expect(CanonicalUri.factoryWork('w-100')).toBe('factory://work/w-100');
    expect(CanonicalUri.telegramMessage('123456', '999')).toBe('telegram://chat/123456/message/999');
  });

  it('should have correct enum values', () => {
    expect(WorkStatus.COMPLETED).toBe('completed');
    expect(ActorType.INTERNAL_AGENT).toBe('internal_agent');
    expect(RelationType.TRIGGERED_BY).toBe('triggered-by');
    expect(RelationType.VERIFIES).toBe('verifies');
    expect(ReferenceScheme.GITHUB).toBe('github');
  });
});
