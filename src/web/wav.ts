export function encodeWav(samples: Float32Array, sampleRate: number) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => {
    for (const [index, char] of [...value].entries()) view.setUint8(at + index, char.charCodeAt(0));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (const [index, sample] of samples.entries()) {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

export function wavSamples(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const text = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") {
    throw new Error("The voice sample is not a WAV file");
  }
  let offset = 12;
  let floatMono = false;
  let sampleRate = 0;
  while (offset + 8 <= buffer.byteLength) {
    const size = view.getUint32(offset + 4, true);
    if (text(offset) === "fmt ") {
      floatMono =
        view.getUint16(offset + 8, true) === 3 &&
        view.getUint16(offset + 10, true) === 1 &&
        view.getUint16(offset + 22, true) === 32;
      sampleRate = view.getUint32(offset + 12, true);
    }
    if (text(offset) === "data") {
      if (!floatMono) throw new Error("The voice sample must be a mono 32-bit float WAV");
      const start = offset + 8;
      return { samples: new Float32Array(buffer.slice(start, start + size)), sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("The voice sample is not a WAV file");
}
