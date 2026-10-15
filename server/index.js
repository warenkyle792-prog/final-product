const { createApplication } = require('./app');

async function start() {
  let system;
  try {
    system = await createApplication();
    await new Promise((resolve, reject) => {
      system.server.once('error', reject);
      system.server.listen(system.config.port, '0.0.0.0', resolve);
    });
  } catch (error) {
    console.error(error?.message || 'Server failed to start.');
    process.exitCode = 1;
    return;
  }
  console.log(`EventTracker listening on 0.0.0.0:${system.config.port} (${system.config.mode})`);
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: stopping EventTracker and flushing the database`);
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    try { await system.close(); process.exitCode = 0; }
    catch (error) { console.error('Graceful shutdown failed.'); process.exitCode = 1; }
    finally { clearTimeout(timeout); }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
if (require.main === module) start();
module.exports = { start };
