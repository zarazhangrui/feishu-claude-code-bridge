import { Command } from 'commander';
import pkg from '../../package.json';
import { runMigrate } from './commands/migrate';
import { runPs, runStopCli } from './commands/ps';
import {
  runSecretsGet,
  runSecretsList,
  runSecretsRemove,
  runSecretsSet,
} from './commands/secrets';
import { runStart } from './commands/start';

const program = new Command();

program
  .name('lark-channel-bridge')
  .description('Bridge Feishu/Lark messenger with local CLI coding agents')
  .version(pkg.version, '-v, --version');

program
  .command('start')
  .description('Start the bot (runs first-run wizard if bot config is missing)')
  .option('-c, --config <path>', 'path to config file')
  .action(async (opts: { config?: string }) => {
    await runStart(opts);
  });

program
  .command('migrate')
  .description(
    'Migrate from pre-0.1.11 setup: move ~/.config/lark-channel-bridge/* and ' +
      '~/.cache/lark-channel-bridge/* into ~/.lark-channel/, and rewrite ' +
      'config.json from { app } to { accounts.app }',
  )
  .option('-c, --config <path>', 'path to config file (after migration)')
  .action(async (opts: { config?: string }) => {
    await runMigrate(opts);
  });

program
  .command('ps')
  .description('List running lark-channel-bridge start processes (this machine)')
  .action(() => {
    runPs();
  });

program
  .command('stop <target>')
  .description('Stop a running start process by short id or list index (SIGTERM, then SIGKILL after 2s)')
  .action(async (target: string) => {
    await runStopCli(target);
  });

const secrets = program
  .command('secrets')
  .description('Manage the bridge\'s encrypted secret keystore (~/.lark-channel/secrets.enc)');

secrets
  .command('get')
  .description('Exec-provider protocol: read JSON request from stdin, write JSON response to stdout. Used by lark-cli config bind --source lark-channel.')
  .action(async () => {
    await runSecretsGet();
  });

secrets
  .command('set')
  .description('Encrypt and store an App Secret. Prompts for the secret without echoing.')
  .requiredOption('--app-id <id>', 'App ID (e.g. cli_xxxxxxxxxxxx)')
  .action(async (opts: { appId: string }) => {
    await runSecretsSet(opts.appId);
  });

secrets
  .command('list')
  .description('List the IDs of secrets in the encrypted keystore (no secrets shown)')
  .action(async () => {
    await runSecretsList();
  });

secrets
  .command('remove')
  .description('Delete an entry from the encrypted keystore')
  .requiredOption('--app-id <id>', 'App ID to remove')
  .action(async (opts: { appId: string }) => {
    await runSecretsRemove(opts.appId);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
