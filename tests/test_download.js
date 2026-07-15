// Real end-to-end regression test: metadata fetch + a real download through
// yt-dlp, driving this repo's standalone dev harness (see
// tests/lib/neu-launch.js, ported from sorai-toolkit-converter's pattern --
// see [[neu-playwright-test-pattern]]). Uses a short, stable, well-known
// public test video ("Me at the zoo", the first YouTube video, ~19s) so a
// real download completes quickly.
// Run with: node tests/test_download.js (from the project root)
// Exits 0 on success, 1 on any failure.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { chromium } = require('playwright');
const { spawnNeu, killNeuTree } = require('./lib/neu-launch');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra !== undefined ? '  -> ' + extra : ''}`);
}

function waitForAuthInfo(sinceMs, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      try {
        const st = fs.statSync(path.join(PROJECT_ROOT, '.tmp', 'auth_info.json'));
        if (st.mtimeMs > sinceMs) return resolve();
      } catch (e) {
        /* not written yet */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('auth_info.json not refreshed within ' + timeoutMs + 'ms'));
      setTimeout(poll, 500);
    })();
  });
}

async function main() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-verify-'));
  console.log('Output dir:', outDir);

  const launchTime = Date.now();
  const neu = spawnNeu(PROJECT_ROOT);
  neu.stdout.on('data', (d) => process.stdout.write('[neu] ' + d));
  neu.stderr.on('data', (d) => process.stderr.write('[neu:err] ' + d));
  let browser = null;

  try {
    await waitForAuthInfo(launchTime);
    const auth = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.tmp', 'auth_info.json'), 'utf8'));
    const url = 'http://localhost:' + auth.nlPort + '/?nlToken=' + auth.nlToken;
    console.log('Connecting to', url);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    await page.addInitScript((t) => { try { sessionStorage.setItem('NL_TOKEN', t); } catch (e) {} }, auth.nlToken);
    await page.goto(url);
    await page.waitForSelector('#url-panel');
    await page.waitForFunction(() => typeof window.Neutralino !== 'undefined' && !!window.EstellaLib?.platform);

    // Mock the native folder dialog -- Playwright can't drive a real OS
    // dialog, and this test's goal is the download pipeline, not the
    // picker UI (sorai-toolkit-converter's browseForOutputFolder covers
    // that same native-dialog call already).
    await page.evaluate((dir) => {
      window.Neutralino.os.showFolderDialog = async () => dir;
    }, outDir);

    console.log('\n--- METADATA FETCH ---');
    await page.fill('#video-url', TEST_URL);
    await page.click('#btn-fetch');
    await page.waitForSelector('#metadata-title', { timeout: 30000 });
    const title = await page.$eval('#metadata-title', (el) => el.textContent);
    check('M1: title fetched', title && title.length > 0, title);
    const hasThumb = (await page.$('#metadata-thumbnail')) !== null;
    check('M2: thumbnail element present', hasThumb);
    const durationText = await page.$eval('#metadata-duration', (el) => el.textContent).catch(() => null);
    check('M3: duration text present', !!durationText, durationText);
    const formatCount = await page.$$eval('#format-select option', (opts) => opts.length);
    check('M4: format options populated', formatCount > 0, formatCount);

    // Force a video-only format so this run actually exercises the
    // --ffmpeg-location merge path (resolveFormatSelector in ytdlp.js),
    // not just a plain single-stream download -- picking whichever format
    // yt-dlp lists last isn't guaranteed to need a merge.
    const videoOnlyId = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('#format-select option'));
      const match = opts.find((o) => /video only/.test(o.textContent));
      return match ? match.value : null;
    });
    check('M5: a video-only (merge-required) format is offered', !!videoOnlyId, videoOnlyId);
    if (videoOnlyId) {
      await page.evaluate((id) => {
        const el = document.getElementById('format-select');
        el.value = id;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, videoOnlyId);
    }

    console.log('\n--- DOWNLOAD ---');
    await page.click('#btn-select-output');
    await page.waitForFunction((dir) => document.getElementById('output-path').value === dir, outDir);
    check('D1: output path set', true);

    await page.click('#btn-download');
    await page.waitForFunction(
      () => /Download complete|Cancelled|Error/.test(document.querySelector('.statusbar-text')?.textContent || ''),
      { timeout: 120000 },
    );
    const statusText = await page.$eval('.statusbar-text', (el) => el.textContent);
    check('D2: download completed', /Download complete/.test(statusText), statusText);

    const files = fs.readdirSync(outDir);
    check('D3: output file exists in chosen folder', files.length > 0, files.join(', '));
    if (files.length > 0) {
      const outFile = path.join(outDir, files[0]);
      const stat = fs.statSync(outFile);
      check('D4: output file non-empty', stat.size > 0, stat.size);

      // Confirm the merge actually happened (video-only stream + separately
      // fetched audio, muxed by the bundled ffmpeg via --ffmpeg-location) --
      // ffmpeg -i reports both a Video and an Audio stream in its stderr.
      const ffmpegBin = path.join(PROJECT_ROOT, 'binaries', 'win_x64', 'ffmpeg.exe');
      const probe = cp.spawnSync(ffmpegBin, ['-i', outFile], { encoding: 'utf8' });
      const probeOut = (probe.stderr || '') + (probe.stdout || '');
      check('D5: merged output has a video stream', /Stream #\d+:\d+.*Video:/.test(probeOut));
      check('D6: merged output has an audio stream', /Stream #\d+:\d+.*Audio:/.test(probeOut));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killNeuTree(neu.pid);
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
