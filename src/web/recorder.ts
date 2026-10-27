export async function startRecording() {
  const mimeType = ["audio/webm", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser can't record webm or ogg audio");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch (error) {
    release();
    throw error;
  }
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.addEventListener(
          "stop",
          () => {
            release();
            resolve(new Blob(chunks, { type: recorder.mimeType }));
          },
          { once: true },
        );
        recorder.stop();
      }),
  };
}
