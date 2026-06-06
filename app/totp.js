const JsSHA = require('jssha/dist/sha1');

const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(base32) {
  let bits = base32.split('')
    .map(char => {
      let val = base32chars.indexOf(char.toUpperCase());
      if (val < 0) throw new Error("Illegal Base32 character: " + char);
      return val;
    })
    .map(val => val.toString(2).padStart(5, '0'))
    .join('');

  return bits.match(/.{4}/g)
    .map(chunk => parseInt(chunk, 2).toString(16))
    .join('');
}

function generateStandardCode(hmac) {
  const offset = parseInt(hmac.slice(-1), 16);
  const part = hmac.substr(offset * 2, 8);
  const code = parseInt(part, 16) & 0x7fffffff;
  return String(code).slice(-6).padStart(6, '0');
}

function generateSteamCode(hmac) {
  const offset = parseInt(hmac.slice(-1), 16);
  const part = hmac.substr(offset * 2, 8);
  const code = parseInt(part, 16) & 0x7fffffff;

  const chars = '23456789BCDFGHJKMNPQRTVWXY';
  let temp = code;
  let result = '';
  for (let i = 0; i < 5; i++) {
    result = chars[temp % chars.length] + result;
    temp = Math.floor(temp / chars.length);
  }
  return result;
}

module.exports = function (secretBase32, type, period) {
  this.secretBase32 = secretBase32;
  this.type = type === 'steam' ? 'steam' : 'totp';
  this.stepSeconds = Number.isInteger(Number(period)) && Number(period) > 0 ? Number(period) : 30;
  this.tokenLength = this.type === 'steam' ? 5 : 6;

  this.getToken = () => {
    let secretHex = base32ToHex(this.secretBase32);
    if (secretHex.length % 2 !== 0) secretHex += '0';

    const counter = Math.floor(Date.now() / 1000 / this.stepSeconds);
    const counterHex = counter.toString(16);

    const shaObj = new JsSHA("SHA-1", "HEX", {
      hmacKey: { value: secretHex, format: "HEX" }
    });
    shaObj.update(counterHex.padStart(16, "0"));
    const hmac = shaObj.getHMAC("HEX");

    if (this.type === 'steam') return generateSteamCode(hmac);
    return generateStandardCode(hmac);
  };

  this.getRemainingSeconds = () => this.stepSeconds - (Date.now() / 1000) % this.stepSeconds;
  this.getStepSeconds = () => this.stepSeconds;
};
