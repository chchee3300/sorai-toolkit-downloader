// Cross-platform binary fetcher for this repo's standalone dev harness (see
// FileConverterApp's setup.mjs for the pattern this is ported from). yt-dlp
// needs ffmpeg to merge separate video/audio streams (--ffmpeg-location),
// so both are bundled here -- same binaries/<platform>/ layout the hub
// repo uses, so resources/js/lib/platform.js's ffmpegPath()/ytdlpPath()
// resolve identically in standalone dev and in the real composed app.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, chmodSync } from 'node:fs';
import { platform, arch } from 'node:os';
import path from 'node:path';

const BIN_DIR = path.resolve('binaries');

function findFileRecursive(dir, filename) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import('node:fs');
  fs.writeFileSync(destPath, buf);
}

function tarBinary() {
  // See FileConverterApp/setup.mjs -- Windows' real bsdtar lives at
  // System32\tar.exe; Git Bash's /usr/bin/tar (GNU tar, no zip support)
  // shadows it on PATH if referenced bare.
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(sys32) ? sys32 : 'tar';
}

async function unzip(zipPath, destDir) {
  if (platform() === 'win32') {
    execFileSync(
      tarBinary(),
      ['-xf', path.basename(zipPath), '-C', path.relative(path.dirname(zipPath), destDir) || '.'],
      { cwd: path.dirname(zipPath), stdio: 'inherit' },
    );
    return;
  }
  // Linux's default GNU tar has no zip support either -- unzip is the
  // reliable cross-platform choice here (see FileConverterApp/setup.mjs).
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
}

async function latestYtDlpAssetUrl(assetName) {
  const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
  if (!res.ok) throw new Error(`yt-dlp releases lookup failed (${res.status})`);
  const info = await res.json();
  const asset = info.assets.find((a) => a.name === assetName);
  if (!asset) throw new Error(`yt-dlp release asset not found: ${assetName}`);
  return asset.browser_download_url;
}

async function setupYtDlp(dirName, assetName, destName) {
  const dir = path.join(BIN_DIR, dirName);
  mkdirSync(dir, { recursive: true });
  const destPath = path.join(dir, destName);
  if (existsSync(destPath)) {
    console.log(`yt-dlp already present at binaries/${dirName}/${destName}, skipping download.`);
    return;
  }
  console.log(`Downloading yt-dlp (${dirName})...`);
  const url = await latestYtDlpAssetUrl(assetName);
  await downloadTo(url, destPath);
  if (destName !== 'yt-dlp.exe') chmodSync(destPath, 0o755);
  console.log(`yt-dlp installed to binaries/${dirName}/${destName}`);
}

async function setupFfmpegWindows(dir) {
  console.log('Downloading ffmpeg (win64)...');
  const ffmpegZip = path.join(dir, 'ffmpeg.zip');
  await downloadTo(
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    ffmpegZip,
  );
  const ffmpegTemp = path.join(dir, 'ffmpeg_temp');
  mkdirSync(ffmpegTemp, { recursive: true });
  await unzip(ffmpegZip, ffmpegTemp);
  const ffmpegExe = findFileRecursive(ffmpegTemp, 'ffmpeg.exe');
  if (ffmpegExe) copyFileSync(ffmpegExe, path.join(dir, 'ffmpeg.exe'));
  rmSync(ffmpegZip, { force: true });
  rmSync(ffmpegTemp, { recursive: true, force: true });
}

async function macFfmpegZipUrl() {
  const res = await fetch('https://evermeet.cx/ffmpeg/info/ffmpeg/release');
  if (!res.ok) throw new Error(`evermeet.cx info lookup failed (${res.status})`);
  const info = await res.json();
  return info.download.zip.url;
}

async function linuxFfmpegZipUrl(cpu) {
  const res = await fetch('https://ffbinaries.com/api/v1/version/latest');
  if (!res.ok) throw new Error(`ffbinaries.com info lookup failed (${res.status})`);
  const info = await res.json();
  const key = cpu === 'arm64' ? 'linux-arm64' : 'linux-64';
  const entry = info.bin[key];
  if (!entry) throw new Error(`No ffbinaries build listed for ${key}`);
  return entry.ffmpeg;
}

async function setupFfmpegUnix(dirName, os, cpu) {
  const dir = path.join(BIN_DIR, dirName);
  const destPath = path.join(dir, 'ffmpeg');
  if (existsSync(destPath)) {
    console.log(`ffmpeg already present at binaries/${dirName}/ffmpeg, skipping download.`);
    return;
  }
  console.log(`Downloading ffmpeg (${dirName})...`);
  const url = os === 'darwin' ? await macFfmpegZipUrl() : await linuxFfmpegZipUrl(cpu);
  const zipPath = path.join(dir, 'ffmpeg.zip');
  await downloadTo(url, zipPath);
  await unzip(zipPath, dir);
  rmSync(zipPath, { force: true });
  chmodSync(destPath, 0o755);
  console.log(`ffmpeg installed to binaries/${dirName}/ffmpeg`);
}

async function main() {
  mkdirSync(BIN_DIR, { recursive: true });
  const os = platform();

  if (os === 'win32') {
    const dir = path.join(BIN_DIR, 'win_x64');
    mkdirSync(dir, { recursive: true });
    await setupFfmpegWindows(dir);
    await setupYtDlp('win_x64', 'yt-dlp.exe', 'yt-dlp.exe');
  } else if (os === 'darwin') {
    const dirName = arch() === 'arm64' ? 'mac_arm64' : 'mac_x64';
    mkdirSync(path.join(BIN_DIR, dirName), { recursive: true });
    await setupFfmpegUnix(dirName, os, arch());
    await setupYtDlp(dirName, 'yt-dlp_macos', 'yt-dlp');
  } else if (os === 'linux') {
    mkdirSync(path.join(BIN_DIR, 'linux_x64'), { recursive: true });
    await setupFfmpegUnix('linux_x64', os, arch());
    await setupYtDlp('linux_x64', 'yt-dlp_linux', 'yt-dlp');
  } else {
    console.error(`Unsupported platform: ${os}`);
    process.exit(1);
  }

  console.log('All binaries downloaded successfully!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
