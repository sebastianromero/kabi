import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = process.cwd();
const pkgPath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

const productName = pkg.productName || pkg.name || 'App';
const version = pkg.version || '0.0.0';
const makeRoot = path.join(projectRoot, 'out', 'make');
const packagedRoot = path.join(projectRoot, 'out');
const releaseRoot = path.join(projectRoot, 'releases', `v${version}`);
const withChecksums = process.argv.includes('--checksums');
const withAppZip = process.argv.includes('--app-zip');
const keepOut = process.argv.includes('--keep-out');

const ALLOWED_EXTENSIONS = new Set(['.zip', '.dmg', '.pkg', '.exe', '.msi', '.appimage', '.deb', '.rpm']);
const ARCH_PATTERN = /(arm64|x64|ia32|universal)/i;
const OS_PRIORITY_BY_EXTENSION = {
  '.dmg': 'darwin',
  '.pkg': 'darwin',
  '.exe': 'win32',
  '.msi': 'win32',
  '.appimage': 'linux',
  '.deb': 'linux',
  '.rpm': 'linux',
};
const PREFERRED_EXTENSION_ORDER = {
  darwin: ['.dmg', '.pkg', '.zip'],
  win32: ['.exe', '.msi', '.zip'],
  linux: ['.appimage', '.deb', '.rpm', '.zip'],
};

const sha256ForFile = async (filePath) => {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
};

const runCommand = (command, commandArgs) =>
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

const toTitleCaseOs = (os) => {
  if (os === 'darwin') return 'macOS';
  if (os === 'win32') return 'Windows';
  if (os === 'linux') return 'Linux';
  return os;
};

const inferOsFromPath = (filePath, extension) => {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('/darwin/') || lowerPath.includes('darwin-') || lowerPath.includes('/mac/')) {
    return 'darwin';
  }
  if (lowerPath.includes('/win32/') || lowerPath.includes('win32-') || lowerPath.includes('/windows/')) {
    return 'win32';
  }
  if (lowerPath.includes('/linux/') || lowerPath.includes('linux-')) {
    return 'linux';
  }
  return OS_PRIORITY_BY_EXTENSION[extension] ?? 'unknown';
};

const inferArchFromName = (name) => {
  const match = name.match(ARCH_PATTERN);
  return match ? match[1].toLowerCase() : 'unknown';
};

const collectArtifacts = async () => {
  const results = [];

  const walk = async (currentPath) => {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) continue;

      results.push({
        sourcePath: fullPath,
        sourceName: entry.name,
        extension,
        os: inferOsFromPath(fullPath.replace(/\\/g, '/'), extension),
        arch: inferArchFromName(entry.name),
      });
    }
  };

  await walk(makeRoot);
  return results;
};

const collectAppBundles = async () => {
  const entries = await readdir(packagedRoot, { withFileTypes: true });
  const bundles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.toLowerCase().includes('-darwin-')) continue;

    const candidate = path.join(packagedRoot, entry.name, `${productName}.app`);
    try {
      const statEntries = await readdir(candidate);
      if (statEntries.length >= 0) {
        bundles.push({
          sourcePath: candidate,
          sourceName: `${productName}.app`,
        });
      }
    } catch {
      // Ignore folders without app bundles.
    }
  }

  return bundles;
};

const choosePreferredArtifacts = (artifacts) => {
  const grouped = new Map();
  for (const artifact of artifacts) {
    const key = `${artifact.os}:${artifact.arch}`;
    const list = grouped.get(key) ?? [];
    list.push(artifact);
    grouped.set(key, list);
  }

  const selected = [];
  for (const [key, group] of grouped.entries()) {
    const [os] = key.split(':');
    const preference = PREFERRED_EXTENSION_ORDER[os] ?? ['.zip'];
    let picked = null;

    for (const preferredExt of preference) {
      picked = group.find((artifact) => artifact.extension === preferredExt) ?? null;
      if (picked) break;
    }

    if (!picked) {
      picked = group[0];
    }

    selected.push(picked);
  }

  return selected;
};

const buildReleaseFileName = (artifact, totalSelectedArtifacts) => {
  const ext = artifact.extension === '.appimage' ? 'AppImage' : artifact.extension.slice(1);
  if (totalSelectedArtifacts === 1) {
    return `${productName}.${ext}`;
  }

  const osLabel = toTitleCaseOs(artifact.os).replace(/\s+/g, '-');
  return `${productName}-${osLabel}-${artifact.arch}.${ext}`;
};

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

const artifacts = await collectArtifacts();
if (artifacts.length === 0) {
  throw new Error('No distributable artifacts found in out/make. Run `bun make` first.');
}

const selectedArtifacts = choosePreferredArtifacts(artifacts);
const appBundles = await collectAppBundles();
const checksumLines = [];

for (const artifact of selectedArtifacts) {
  const releaseName = buildReleaseFileName(artifact, selectedArtifacts.length);
  const destPath = path.join(releaseRoot, releaseName);
  await copyFile(artifact.sourcePath, destPath);

  if (withChecksums) {
    const sum = await sha256ForFile(destPath);
    checksumLines.push(`${sum}  ${releaseName}`);
  }
}

for (const bundle of appBundles) {
  const destPath = path.join(releaseRoot, bundle.sourceName);
  await rm(destPath, { recursive: true, force: true });
  await runCommand('ditto', [bundle.sourcePath, destPath]);

  if (withAppZip) {
    const zipName = `${bundle.sourceName}.zip`;
    const zipPath = path.join(releaseRoot, zipName);
    await rm(zipPath, { force: true });
    await runCommand('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', destPath, zipPath]);

    if (withChecksums) {
      const zipSum = await sha256ForFile(zipPath);
      checksumLines.push(`${zipSum}  ${zipName}`);
    }
  }
}

if (withChecksums) {
  checksumLines.sort();
  await writeFile(path.join(releaseRoot, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8');
}

if (!keepOut) {
  await rm(packagedRoot, { recursive: true, force: true });
}

const totalOutputs = selectedArtifacts.length + appBundles.length;
console.log(`Prepared ${totalOutputs} release artifact(s) in: ${releaseRoot}`);
if (!keepOut) {
  console.log('Removed temporary build output: out/');
}
