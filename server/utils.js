const os = require('os');

/**
 * Get all non-internal IPv4 network addresses on the host.
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4 and not loopback (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address,
        });
      }
    }
  }

  return addresses;
}

/**
 * Get the primary local IPv4 address (usually en0 for Wi-Fi/Ethernet on Mac).
 */
function getPrimaryLocalIp() {
  const addresses = getLocalIpAddresses();
  if (addresses.length === 0) return '127.0.0.1';

  // Prefer Wi-Fi (en0) or Ethernet (en1) on macOS
  const preferred =
    addresses.find((a) => a.interface === 'en0') ||
    addresses.find((a) => a.interface === 'en1') ||
    addresses[0];
  return preferred.address;
}

/**
 * Convert SRT subtitle content to WebVTT format.
 * HTML5 <video> natively requires WebVTT (.vtt).
 */
function srtToVtt(srtContent) {
  let vtt = 'WEBVTT\n\n';
  // Standardize line breaks
  const cleaned = srtContent.replace(/\r\n|\r/g, '\n').trim();

  // Replace comma decimal separators with dots in timestamps: 00:01:20,500 --> 00:01:20.500
  const converted = cleaned.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  vtt += converted;
  return vtt;
}

/**
 * Display a stylish startup banner in the terminal with TV URL and QR code.
 */
function printStartupBanner(port, localIp) {
  const localUrl = `http://localhost:${port}`;
  const networkUrl = `http://${localIp}:${port}`;

  console.log('\n======================================================');
  console.log('              🍊 ORANGE TV MEDIA SERVER 🍊            ');
  console.log('======================================================');
  console.log(`\n  Local Host:      ${localUrl}`);
  console.log(`  Smart TV URL:    ${networkUrl}\n`);
  console.log('------------------------------------------------------');
  console.log('  Open the Smart TV URL on your TV web browser!');
  console.log('  Or scan this QR code with your phone/TV camera:\n');

  try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(networkUrl, { small: true }, (qr) => {
      console.log(qr);
      console.log('------------------------------------------------------\n');
    });
  } catch (err) {
    console.log('  (Install qrcode-terminal for QR code display)\n');
    console.log('------------------------------------------------------\n');
  }
}

module.exports = {
  getPrimaryLocalIp,
  srtToVtt,
  printStartupBanner,
};
