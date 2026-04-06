import type { RiskBand, RiskRuleHit } from '../types/domain.js';

function createRuleHit(input: RiskRuleHit): RiskRuleHit {
  return input;
}

export function scoreRiskHits(hits: RiskRuleHit[]): number {
  return Math.min(
    100,
    hits.reduce((sum, item) => sum + Math.max(0, Number(item.score) || 0), 0)
  );
}

export function riskBandFromScore(score: number): RiskBand {
  if (score >= 50) {
    return 'block';
  }
  if (score >= 25) {
    return 'observe';
  }
  return 'normal';
}

export function buildUserRuleHits(input: {
  uniqueIpCount1h: number;
  uniqueIpCount3h: number;
  uniqueIpCount6h: number;
  uniqueIpCount24h: number;
  observeThreshold: number;
  blockThreshold: number;
}): RiskRuleHit[] {
  const hits: RiskRuleHit[] = [];

  if (input.uniqueIpCount1h >= input.blockThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_ips_1h_block',
        label: '1 小时内命中大量不同 IP',
        level: 'high',
        window: '1h',
        actual: input.uniqueIpCount1h,
        threshold: input.blockThreshold,
        score: 50
      })
    );
  } else if (input.uniqueIpCount1h >= input.observeThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_ips_1h_observe',
        label: '1 小时内不同 IP 超过观察线',
        level: 'warn',
        window: '1h',
        actual: input.uniqueIpCount1h,
        threshold: input.observeThreshold,
        score: 25
      })
    );
  }

  if (input.uniqueIpCount3h >= input.observeThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_ips_3h_sustained',
        label: '3 小时内持续跨多个 IP',
        level: 'info',
        window: '3h',
        actual: input.uniqueIpCount3h,
        threshold: input.observeThreshold,
        score: 10
      })
    );
  }

  if (input.uniqueIpCount6h >= input.observeThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_ips_6h_sustained',
        label: '6 小时内扩散仍未回落',
        level: 'warn',
        window: '6h',
        actual: input.uniqueIpCount6h,
        threshold: input.observeThreshold,
        score: 25
      })
    );
  }

  if (input.uniqueIpCount24h >= input.blockThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_ips_24h_spread',
        label: '24 小时内 IP 分布持续扩张',
        level: 'info',
        window: '24h',
        actual: input.uniqueIpCount24h,
        threshold: input.blockThreshold,
        score: 10
      })
    );
  }

  return hits;
}

export function buildIpRuleHits(input: {
  userCount10m: number;
  userCount1h: number;
  userCount24h: number;
  linkedRiskUserCount: number;
  observeThreshold: number;
  blockThreshold: number;
}): RiskRuleHit[] {
  const hits: RiskRuleHit[] = [];
  const spikeThreshold = Math.max(2, Math.ceil(input.observeThreshold / 2));

  if (input.userCount10m >= spikeThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_users_10m_spike',
        label: '10 分钟内共享用户快速上升',
        level: 'info',
        window: '10m',
        actual: input.userCount10m,
        threshold: spikeThreshold,
        score: 10
      })
    );
  }

  if (input.userCount1h >= input.blockThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_users_1h_block',
        label: '1 小时内共享用户达到封锁线',
        level: 'high',
        window: '1h',
        actual: input.userCount1h,
        threshold: input.blockThreshold,
        score: 50
      })
    );
  } else if (input.userCount1h >= input.observeThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_users_1h_observe',
        label: '1 小时内共享用户达到观察线',
        level: 'warn',
        window: '1h',
        actual: input.userCount1h,
        threshold: input.observeThreshold,
        score: 25
      })
    );
  }

  if (input.userCount24h >= input.blockThreshold) {
    hits.push(
      createRuleHit({
        code: 'distinct_users_24h_persistent',
        label: '24 小时内共享用户长期偏高',
        level: 'warn',
        window: '24h',
        actual: input.userCount24h,
        threshold: input.blockThreshold,
        score: 25
      })
    );
  }

  if (input.linkedRiskUserCount >= 1) {
    hits.push(
      createRuleHit({
        code: 'linked_risk_user_overlap',
        label: '该 IP 已关联未释放风险用户',
        level: 'warn',
        window: '24h',
        actual: input.linkedRiskUserCount,
        threshold: 1,
        score: 25
      })
    );
  }

  return hits;
}
