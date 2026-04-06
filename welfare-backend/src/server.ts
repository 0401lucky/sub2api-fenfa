import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrations.js';
import {
  distributionDetectionService,
  DISTRIBUTION_SCAN_INTERVAL_MS
} from './services/distribution-detection-service.js';
import { monitoringService } from './services/monitoring-service.js';
import { sub2apiClient } from './services/sub2api-client.js';
import { usageSyncService } from './services/usage-sync-service.js';
import { welfareRepository } from './services/checkin-service.js';
import { sessionMaintenanceService } from './services/session-maintenance-service.js';
import { extractLinuxDoSubjectFromEmail, toSyntheticEmail } from './utils/oauth.js';

async function backfillLegacyAdminWhitelist(): Promise<void> {
  const whitelist = await welfareRepository.listAdminWhitelist();
  for (const item of whitelist) {
    if (item.sub2apiUserId || !item.linuxdoSubject) {
      continue;
    }

    try {
      const user = await sub2apiClient.findUserByEmail(toSyntheticEmail(item.linuxdoSubject));
      if (!user) {
        continue;
      }

      await welfareRepository.updateAdminWhitelistIdentity(item.id, {
        sub2apiUserId: user.id,
        email: user.email,
        username: user.username || user.email,
        linuxdoSubject: extractLinuxDoSubjectFromEmail(user.email)
      });
    } catch (error) {
      console.warn(
        `[welfare-backend] 管理员白名单回填失败: ${item.linuxdoSubject}`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

async function hydrateBootstrapAdminWhitelist(): Promise<void> {
  if (config.BOOTSTRAP_ADMIN_SUBJECTS.length > 0) {
    await welfareRepository.bootstrapLegacyAdminWhitelist(config.BOOTSTRAP_ADMIN_SUBJECTS);
  }

  if (config.BOOTSTRAP_ADMIN_USER_IDS.length > 0) {
    await welfareRepository.bootstrapAdminWhitelist(config.BOOTSTRAP_ADMIN_USER_IDS);
    for (const userId of config.BOOTSTRAP_ADMIN_USER_IDS) {
      try {
        const user = await sub2apiClient.getAdminUserById(userId);
        if (!user) {
          continue;
        }
        const whitelist = await welfareRepository.listAdminWhitelist();
        const target = whitelist.find((item) => item.sub2apiUserId === userId);
        if (!target) {
          continue;
        }
        await welfareRepository.updateAdminWhitelistIdentity(target.id, {
          sub2apiUserId: user.id,
          email: user.email,
          username: user.username || user.email,
          linuxdoSubject: extractLinuxDoSubjectFromEmail(user.email)
        });
      } catch (error) {
        console.warn(
          `[welfare-backend] 启动管理员白名单用户预热失败: ${userId}`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  if (config.BOOTSTRAP_ADMIN_EMAILS.length > 0) {
    for (const email of config.BOOTSTRAP_ADMIN_EMAILS) {
      try {
        const user = await sub2apiClient.findUserByEmail(email);
        if (!user) {
          console.warn(`[welfare-backend] 启动管理员邮箱未命中 sub2api 用户: ${email}`);
          continue;
        }

        await welfareRepository.addAdminWhitelist({
          sub2apiUserId: user.id,
          email: user.email,
          username: user.username || user.email,
          linuxdoSubject: extractLinuxDoSubjectFromEmail(user.email),
          notes: 'bootstrap-email'
        });
      } catch (error) {
        console.warn(
          `[welfare-backend] 启动管理员邮箱预热失败: ${email}`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  await backfillLegacyAdminWhitelist();
}

async function main() {
  await runMigrations(pool);
  await hydrateBootstrapAdminWhitelist();
  sessionMaintenanceService.startCleanupLoop(
    config.WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL_MS
  );
  usageSyncService.startLoop(config.WELFARE_USAGE_SYNC_INTERVAL_MS);
  distributionDetectionService.startScanLoop(DISTRIBUTION_SCAN_INTERVAL_MS);
  monitoringService.startSnapshotLoop(config.WELFARE_MONITOR_SNAPSHOT_INTERVAL_MS);

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`[welfare-backend] listening on :${config.PORT}`);
  });
}

main().catch((error) => {
  console.error('[welfare-backend] 启动失败', error);
  process.exit(1);
});
