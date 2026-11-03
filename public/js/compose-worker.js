// Off the main thread: a preloaded piece's picture placed where it sits on the model, on a transparent picture the model's size (so adding many new pieces never freezes the app).
self.onmessage = async (e) => {
  const { id, url, box, size } = e.data;
  try {
    const cutout = await (await fetch(url)).blob();
    let worn = null;
    if (box) {
      const bmp = await createImageBitmap(cutout), c = new OffscreenCanvas(size[0], size[1]);
      c.getContext('2d').drawImage(bmp, box.x, box.y, box.w, box.h); bmp.close();
      worn = await c.convertToBlob({ type: 'image/png' });
    }
    self.postMessage({ id, cutout, worn });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
