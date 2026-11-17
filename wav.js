// wav.js by Frank Force - https://github.com/KilledByAPixel/ZzFX

// encode sample channels to a 16-bit PCM wav file, returns a Uint8Array
// pure function with no browser dependencies, safe to use anywhere
export function buildWavData(sampleChannels, sampleRate = 44100)
{
    const channelCount = sampleChannels.length;
    const sampleCount = sampleChannels[0].length;
    console.assert(channelCount && sampleCount, 'No channels or samples found!');

    // standard 44 byte PCM wav header
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = sampleCount * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const text = (offset, s) =>
        s.split('').forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

    text( 0, 'RIFF');
    view.setUint32( 4, 36 + dataSize, true);       // riff size
    text( 8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);                  // format chunk size
    view.setUint16(20, 1, true);                   // format tag: PCM
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // bytes per second
    view.setUint16(32, blockAlign, true);          // bytes per sample frame
    view.setUint16(34, 8 * bytesPerSample, true);  // bits per sample
    text(36, 'data');
    view.setUint32(40, dataSize, true);

    // copy every sample to the buffer, clamped so nothing wraps or drops
    let offset = 44;
    for (let i = 0; i < sampleCount; ++i)
    for (let j = 0; j < channelCount; ++j)
    {
        const s = Math.max(-1, Math.min(1, sampleChannels[j][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += bytesPerSample;
    }

    return new Uint8Array(buffer);
}

// build a browser object url for the wav file
export function buildWavURL(sampleChannels, sampleRate = 44100)
{
    const blob = new Blob([buildWavData(sampleChannels, sampleRate)],
        {type:'audio/wav'});
    return URL.createObjectURL(blob);
}
