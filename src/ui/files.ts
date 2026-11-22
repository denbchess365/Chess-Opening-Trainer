/**
 * Shares a file through the iOS share sheet (Save to Files, AirDrop, Mail…) when
 * available, otherwise downloads it. Returns false if the user cancelled.
 */
export async function shareOrDownload(filename: string, text: string, mime: string): Promise<boolean> {
  const file = new File([text], filename, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      // Fall through to a download if sharing failed for another reason.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Opens the system file picker and resolves with the chosen file's text (or null). */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? await f.text() : null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repertoire';
}
