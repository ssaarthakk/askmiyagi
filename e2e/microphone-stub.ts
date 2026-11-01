import { expect, type Page } from "@playwright/test";

export const stubMicrophone = `
  window.micRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    window.micRequests += 1;
    if (window.micDenied) throw new DOMException("denied", "NotAllowedError");
    if (window.holdMic) await new Promise((resolve) => { window.openMic = resolve; });
    return { getTracks: () => [{ stop() {} }] };
  };
  window.MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    mimeType = "audio/webm";
    listeners = {};
    addEventListener(name, listener) {
      (this.listeners[name] ??= []).push(listener);
    }
    start() {}
    stop() {
      for (const listener of this.listeners.dataavailable ?? []) {
        listener({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }) });
      }
      for (const listener of this.listeners.stop ?? []) listener({});
    }
  };
`;

export async function pressMicrophone(page: Page) {
  const box = await page.getByRole("button", { name: "Hold to talk" }).boundingBox();
  if (!box) throw new Error("the microphone button is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

export async function holdMicrophone(page: Page) {
  await pressMicrophone(page);
  await expect(page.getByRole("button", { name: "Hold to talk" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.up();
}
