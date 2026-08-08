import QRCode from 'qrcode';

/** Generates a QR code as a data URL for the given text (e.g. a contributor portal link). Useful for in-person events - print it on a table card. */
export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 320,
    margin: 2,
    color: { dark: '#312e81', light: '#ffffff' },
  });
}
