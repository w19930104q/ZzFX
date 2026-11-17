// verify-render-contract.mjs
// Renders three zzfx parameter sets twice each through the deterministic
// render contract and checks: identical per-sample hashes, exact sample
// counts, no NaN, intact WAV tails, and explicit loop boundaries.
// Run: node test/verify-render-contract.mjs

import { ZZFX, ZZFXSound } from '../ZzFX.js';
import { buildWavData } from '../wav.js';
import { createHash } from 'node:crypto';

// parameter order: volume, randomness, frequency, attack, sustain, release,
// shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
// noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter
const SETS =
[
    ['laser (randomness+slide+noise+filter)',
        [.8, .5, 400, .01, .15, .25, 3, 1, 8, 2, 0, 0, 0, .4, 0, 0, 0, 1, 0, 0, 1200]],
    ['echo coin (pitchJump+repeat+delay tail)',
        [.9, .2, 900, .02, .1, .3, 0, 1, 0, 0, 2, .1, .08, 0, 0, 0, .25, 1, 0, 0, 0]],
    ['explosion (noise shape+tremolo+decay)',
        [1, .3, 120, .01, .2, .5, 4, 2, -2, -1, 0, 0, 0, .8, 0, .1, .2, .7, .1, .4, 600]],
];

const SEED = 12345;
let failures = 0;

const hashSamples = samples => createHash('sha256')
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest('hex');

function check(label, ok, detail = '')
{
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!ok) ++failures;
}

// expected render length, mirroring the generator's contract
function expectedSampleCount(p, sampleRate)
{
    const attack = p[3] * sampleRate || 9; // minAttack prevents pops
    return (attack + p[18] * sampleRate + p[4] * sampleRate +
        p[5] * sampleRate + p[16] * sampleRate) | 0;
}

for (const [name, params] of SETS)
{
    console.log(`\n${name}`);
    const r1 = ZZFX.renderSamples(params, { seed: SEED });
    const r2 = ZZFX.renderSamples(params, { seed: SEED });

    // per-sample hash must be identical across renders
    const h1 = hashSamples(r1.samples), h2 = hashSamples(r2.samples);
    check('same seed => identical sha256', h1 === h2, h1.slice(0, 16) + '…');

    // per-sample exact equality, report first mismatch if any
    const mismatch = r1.samples.findIndex((v, i) => v !== r2.samples[i]);
    check('every sample bit-identical', mismatch === -1,
        mismatch === -1 ? `${r1.sampleCount} samples` : `first diff at ${mismatch}`);

    // sample count matches the explicit length contract
    const expected = expectedSampleCount(params, ZZFX.sampleRate);
    check('sampleCount matches contract', r1.sampleCount === expected,
        `${r1.sampleCount} == ${expected}`);
    check('buffer length == sampleCount', r1.samples.length === r1.sampleCount);

    // no NaN anywhere
    check('no NaN samples', !r1.samples.some(Number.isNaN));

    // seed actually drives the randomness parameter
    const r3 = ZZFX.renderSamples(params, { seed: SEED + 1 });
    check('different seed => different samples',
        hashSamples(r3.samples) !== h1);

    // loop boundaries are explicit and span the buffer by default
    check('default loop = whole buffer',
        r1.loopStart === 0 && r1.loopEnd === r1.sampleCount,
        `[${r1.loopStart}, ${r1.loopEnd})`);

    // wav: same render => same file, twice
    const w1 = buildWavData([r1.samples], r1.sampleRate);
    const w2 = buildWavData([r2.samples], r2.sampleRate);
    const wh1 = createHash('sha256').update(w1).digest('hex');
    check('wav bytes repeatable', wh1 === createHash('sha256').update(w2).digest('hex'),
        wh1.slice(0, 16) + '…');

    // wav: header is self-consistent so no player truncates the tail
    const v = new DataView(w1.buffer, w1.byteOffset, w1.byteLength);
    const tag = o => String.fromCharCode(w1[o], w1[o+1], w1[o+2], w1[o+3]);
    check('wav header RIFF/WAVE', tag(0) === 'RIFF' && tag(8) === 'WAVE');
    check('wav block align = 2 (mono 16-bit)', v.getUint16(32, true) === 2);
    check('wav byte rate consistent',
        v.getUint32(28, true) === r1.sampleRate * 2);
    check('wav data size = all samples',
        v.getUint32(40, true) === r1.sampleCount * 2,
        `${v.getUint32(40, true)} == ${r1.sampleCount * 2}`);
    check('wav file holds every sample (tail intact)',
        w1.length === 44 + r1.sampleCount * 2);

    // wav: last sample decodes to the rendered tail value
    const tail = r1.samples[r1.sampleCount - 1];
    const clamped = Math.max(-1, Math.min(1, tail));
    const expectedTail = (clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF) | 0;
    check('wav tail sample matches render',
        v.getInt16(w1.length - 2, true) === expectedTail,
        `${v.getInt16(w1.length - 2, true)} == ${expectedTail}`);
}

// loop boundary contract: overrides respected, clamped, invalid rejected
console.log('\nloop boundary contract');
{
    const params = SETS[0][1];
    const r = ZZFX.renderSamples(params, { seed: SEED, loopStart: 100, loopEnd: 1000 });
    check('explicit loop boundaries respected',
        r.loopStart === 100 && r.loopEnd === 1000);
    const c = ZZFX.renderSamples(params, { seed: SEED, loopEnd: 1e9 });
    check('loopEnd clamped to buffer', c.loopEnd === c.sampleCount);
    let threw = false;
    try { ZZFX.renderSamples(params, { seed: SEED, loopStart: 500, loopEnd: 500 }); }
    catch { threw = true; }
    check('empty loop rejected', threw);
}

// live playback path still works and stays sample-compatible
console.log('\nlegacy interfaces');
{
    const a = ZZFX.buildSamples(...SETS[0][1]);
    check('buildSamples returns samples', a.length > 0 && !a.some(Number.isNaN));
    const s = new ZZFXSound([,,440,.1,.1,.1]);
    check('ZZFXSound precaches samples', s.samples.length > 0);
    check('zzfx play interface intact', typeof ZZFX.play === 'function');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
