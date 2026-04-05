import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const isDraft = args.includes('--draft');
const isDryRun = args.includes('--dry-run');

const projectRoot = process.cwd();
const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));

const version = pkg.version;
const productName = pkg.productName || pkg.name || 'App';
const tag = `v${version}`;
const releaseDir = path.join(projectRoot, 'releases', tag);

const ensureGhCli = () => {
  const result = spawnSync('gh', ['--version'], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('GitHub CLI (`gh`) is required. Install it from https://cli.github.com/.');
  }
};

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      }
    });
  });

await access(releaseDir);
const fileNames = (await readdir(releaseDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => entry.name);
if (fileNames.length === 0) {
  throw new Error(`No assets found in ${releaseDir}. Run \`bun run release:prepare\` first.`);
}

ensureGhCli();

const assetPaths = fileNames.map((name) => path.join(releaseDir, name));
const releaseTitle = `${productName} ${tag}`;
const releaseArgs = [
  'release',
  'create',
  tag,
  ...assetPaths,
  '--title',
  releaseTitle,
  '--generate-notes',
];

if (isDraft) {
  releaseArgs.push('--draft');
}

if (isDryRun) {
  console.log('Dry run command:');
  console.log(['gh', ...releaseArgs].join(' '));
  process.exit(0);
}

await run('gh', releaseArgs);
console.log(`Release ${tag} published with ${assetPaths.length} asset(s).`);
