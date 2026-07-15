// Real end-to-end regression test: metadata fetch + a real download through
// yt-dlp, driving this repo's standalone dev harness (see
// tests/lib/neu-launch.js, ported from sorai-toolkit-converter's pattern --
// see [[neu-playwright-test-pattern]]). TEST_URL has a rich format list
// (mhtml storyboards, webm, mp4, a legacy combined format, and resolutions
// up to 1440p/"2K") which exercises the noise-filtering and quality-label
// bucketing far better than a bare-minimum source would. It's ~11 minutes
// long though, so the download scenarios explicitly force the lowest-height
// video / lowest-bitrate audio option after fetch, rather than trusting the
// UI's best-quality default -- otherwise a default
// download would pull a 1440p file and make this test very slow.
// Run with: node tests/test_download.js (from the project root)
// Exits 0 on success, 1 on any failure.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { chromium } = require('playwright');
const { spawnNeu, killNeuTree } = require('./lib/neu-launch');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_URL = 'https://www.youtube.com/watch?v=Mh-69VNCiuU';

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

function probeStreams(ffmpegBin, file) {
  const probe = cp.spawnSync(ffmpegBin, ['-i', file], { encoding: 'utf8' });
  const out = (probe.stderr || '') + (probe.stdout || '');
  return {
    hasVideo: /Stream #\d+:\d+.*Video:/.test(out),
    hasAudio: /Stream #\d+:\d+.*Audio:/.test(out),
  };
}

// Runs one download via the UI into a fresh output dir and waits for
// completion. Returns the list of output files (absolute paths).
async function runDownload(page, label) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-verify-'));
  await page.evaluate((dir) => {
    window.Neutralino.os.showFolderDialog = async () => dir;
  }, outDir);
  await page.click('#btn-select-output');
  await page.waitForFunction((dir) => document.getElementById('output-path').value === dir, outDir);

  await page.click('#btn-download');
  // waitForFunction's 3-arg form is (pageFunction, arg, options) -- pass
  // `null` for the unused arg so `{ timeout }` lands as options and not as
  // arg (a callback that takes no parameter silently swallows a 2-arg
  // `{ timeout }` as its arg instead, falling back to Playwright's default
  // 30s timeout regardless of what's requested here).
  await page.waitForFunction(
    () => /Download complete|Cancelled|Error/.test(document.querySelector('.statusbar-text')?.textContent || ''),
    null,
    { timeout: 120000 },
  );
  const statusText = await page.$eval('.statusbar-text', (el) => el.textContent);
  check(`${label}: download completed`, /Download complete/.test(statusText), statusText);

  return { outDir, files: fs.readdirSync(outDir).map((f) => path.join(outDir, f)) };
}

async function main() {
  const launchTime = Date.now();
  const neu = spawnNeu(PROJECT_ROOT);
  neu.stdout.on('data', (d) => process.stdout.write('[neu] ' + d));
  neu.stderr.on('data', (d) => process.stderr.write('[neu:err] ' + d));
  let browser = null;
  const outDirs = [];

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

    const ffmpegBin = path.join(PROJECT_ROOT, 'binaries', 'win_x64', 'ffmpeg.exe');

    console.log('\n--- METADATA FETCH ---');
    await page.fill('#video-url', TEST_URL);
    await page.click('#btn-fetch');
    // yt-dlp's YouTube extraction time varies a fair bit run-to-run
    // (signature/format resolution retries), so give this more headroom
    // than a typical UI wait.
    await page.waitForSelector('#metadata-title', { timeout: 60000 });
    const title = await page.$eval('#metadata-title', (el) => el.textContent);
    check('M1: title fetched', title && title.length > 0, title);
    const hasThumb = (await page.$('#metadata-thumbnail')) !== null;
    check('M2: thumbnail element present', hasThumb);
    const durationText = await page.$eval('#metadata-duration', (el) => el.textContent).catch(() => null);
    check('M3: duration text present', !!durationText, durationText);

    const videoOptionCount = await page.$$eval('#video-format-select option', (opts) => opts.length);
    check('M4: video format options populated', videoOptionCount > 0, videoOptionCount);
    const audioOptionCount = await page.$$eval('#audio-format-select option', (opts) => opts.length);
    check('M5: audio format options populated', audioOptionCount > 0, audioOptionCount);

    // Regression check for the noise-format filter in parseMetadataJson:
    // labels always end "ext · size", so a leaked webm entry would show up
    // as a " · webm" substring in either option list.
    const leakedWebm = await page.evaluate(() => {
      const texts = [
        ...Array.from(document.querySelectorAll('#video-format-select option')),
        ...Array.from(document.querySelectorAll('#audio-format-select option')),
      ].map((o) => o.textContent);
      return texts.some((t) => / · webm$/.test(t));
    });
    check('M6: no webm formats leaked into either dropdown', !leakedWebm);

    const defaultCheckboxState = await page.evaluate(() => ({
      video: document.getElementById('include-video-checkbox').checked,
      audio: document.getElementById('include-audio-checkbox').checked,
      merge: document.getElementById('auto-merge-checkbox').checked,
    }));
    check(
      'M7: both streams included and auto-merge on by default',
      defaultCheckboxState.video && defaultCheckboxState.audio && defaultCheckboxState.merge,
      JSON.stringify(defaultCheckboxState),
    );

    // This source goes up to 1440p, so the videoQualityLabel bucketing
    // (height >= 1440 -> "2K") should be exercised for real here.
    const has2kOption = await page.$$eval('#video-format-select option', (opts) =>
      opts.some((o) => /^2K/.test(o.textContent)),
    );
    check('M8: a 1440p option is labeled "2K"', has2kOption);

    // This source is ~11 minutes -- downloading its default (highest
    // quality, up to 1440p) would make this test very slow. Force the
    // lowest-height video option and lowest-bitrate audio option before any
    // download scenario runs; production's best-quality default behavior is
    // already covered at the unit level (bestVideoFormatId/bestAudioFormatId
    // against captured real yt-dlp JSON), not by this E2E run.
    await page.evaluate(() => {
      const pickLowest = (selectId) => {
        const select = document.getElementById(selectId);
        // yt-dlp lists formats worst-to-best for this source, and
        // parseMetadataJson preserves that order, so the first option is
        // consistently the lowest tier available.
        select.value = select.options[0].value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      pickLowest('video-format-select');
      pickLowest('audio-format-select');
    });

    console.log('\n--- SCENARIO A: merge path (default state) ---');
    const scenarioA = await runDownload(page, 'A1');
    outDirs.push(scenarioA.outDir);
    check('A2: exactly one merged output file', scenarioA.files.length === 1, scenarioA.files.join(', '));
    if (scenarioA.files.length === 1) {
      const outFile = scenarioA.files[0];
      check('A3: output file non-empty', fs.statSync(outFile).size > 0);
      check('A4: merged output uses mp4 container', outFile.toLowerCase().endsWith('.mp4'), outFile);
      const streams = probeStreams(ffmpegBin, outFile);
      check('A5: merged output has a video stream', streams.hasVideo);
      check('A6: merged output has an audio stream', streams.hasAudio);
    }

    console.log('\n--- SCENARIO B: no-merge path (auto-merge off) ---');
    await page.click('#auto-merge-checkbox');
    const scenarioB = await runDownload(page, 'B1');
    outDirs.push(scenarioB.outDir);
    check('B2: two separate output files', scenarioB.files.length === 2, scenarioB.files.join(', '));
    if (scenarioB.files.length === 2) {
      const streamSets = scenarioB.files.map((f) => probeStreams(ffmpegBin, f));
      const oneVideoOnly = streamSets.some((s) => s.hasVideo && !s.hasAudio);
      const oneAudioOnly = streamSets.some((s) => s.hasAudio && !s.hasVideo);
      check('B3: one file is video-only and the other audio-only', oneVideoOnly && oneAudioOnly, JSON.stringify(streamSets));
    }

    console.log('\n--- SCENARIO C: single-stream path (audio only) + both-unchecked guard ---');
    await page.click('#include-video-checkbox');
    await page.waitForFunction(() => document.getElementById('video-format-select').disabled === true);
    const lockState = await page.evaluate(() => ({
      videoSelectDisabled: document.getElementById('video-format-select').disabled,
      mergeDisabled: document.getElementById('auto-merge-checkbox').disabled,
      audioCheckboxDisabled: document.getElementById('include-audio-checkbox').disabled,
      audioCheckboxChecked: document.getElementById('include-audio-checkbox').checked,
    }));
    check('C1: video quality select disabled once video is excluded', lockState.videoSelectDisabled);
    check('C2: auto-merge checkbox disabled with only one stream included', lockState.mergeDisabled);
    check(
      'C3: last remaining checkbox (audio) is disabled, guarding against both unchecked',
      lockState.audioCheckboxDisabled && lockState.audioCheckboxChecked,
      JSON.stringify(lockState),
    );

    // Guard should hold even against a direct click attempt on the disabled box.
    await page.click('#include-audio-checkbox', { force: true }).catch(() => {});
    const stillChecked = await page.$eval('#include-audio-checkbox', (el) => el.checked);
    check('C4: clicking the disabled last-remaining checkbox does not uncheck it', stillChecked);

    const scenarioC = await runDownload(page, 'C5');
    outDirs.push(scenarioC.outDir);
    check('C6: exactly one audio-only output file', scenarioC.files.length === 1, scenarioC.files.join(', '));
    if (scenarioC.files.length === 1) {
      const streams = probeStreams(ffmpegBin, scenarioC.files[0]);
      check('C7: output has an audio stream and no video stream', streams.hasAudio && !streams.hasVideo, JSON.stringify(streams));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killNeuTree(neu.pid);
    for (const dir of outDirs) fs.rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
