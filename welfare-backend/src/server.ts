import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrations.js';
import { welfareRepository } from './services/checkin-service.js';
import { sessionMaintenanceService } from './services/session-maintenance-service.js';

async function main() {
  await runMigrations(pool);
  await welfareRepository.bootstrapAdminWhitelist(config.BOOTSTRAP_ADMIN_SUBJECTS);
  sessionMaintenanceService.startCleanupLoop(
    config.WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL_MS
  );

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`[welfare-backend] listening on :${config.PORT}`);
  });
}

main().catch((error) => {
  console.error('[welfare-backend] 启动失败', error);
  process.exit(1);
});
