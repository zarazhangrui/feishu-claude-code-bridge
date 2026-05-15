import { Command } from 'commander';
import pkg from '../../package.json';
import { runMigrate } from './commands/migrate';
import { runPs, runStopCli } from './commands/ps';
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
  .option('--claude', 'shortcut: use ~/.lark-channel/ data dir + agent=claude (default)')
  .option('--codex', 'shortcut: use ~/.lark-codex/ data dir + agent=codex')
  .action(
    async (opts: { config?: string; claude?: boolean; codex?: boolean }) => {
      if (opts.claude && opts.codex) {
        console.error('✗ --claude 和 --codex 不能同时指定');
        process.exit(1);
      }
      const agent = opts.codex ? 'codex' : opts.claude ? 'claude' : undefined;
      await runStart({ config: opts.config, agent });
    },
  );

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

program
  .command('status')
  .description('Show runtime status (WS connection, agent availability)')
  .action(async () => {
    console.log('status: not implemented yet');
  });

program
  .command('doctor')
  .description('Check config, claude CLI, and required platform scopes')
  .action(async () => {
    console.log('doctor: not implemented yet');
  });

program
  .command('handover <text>')
  .description('Hand over a terminal Claude Code session to Feishu')
  .action(async (_text: string) => {
    console.log('handover: not implemented yet');
  });

program
  .command('workspace <action>')
  .description('Manage saved workspaces: list | add | remove | default')
  .action(async (_action: string) => {
    console.log('workspace: not implemented yet');
  });

program
  .command('service <action> <type>')
  .description('Install or uninstall autostart service: launchd | systemd')
  .action(async (_action: string, _type: string) => {
    console.log('service: not implemented yet');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
