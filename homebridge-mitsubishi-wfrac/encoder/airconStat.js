const { crc16ccitt } = require('crc');

function addCRC16(buffer) {
  const crc = crc16ccitt(buffer);
  const crcBuf = Buffer.alloc(2);
  crcBuf[0] = crc & 0xff;
  crcBuf[1] = (crc >> 8) & 0xff;
  return Buffer.concat([buffer, crcBuf]);
}

function addVariable(buffer) {
  return Buffer.concat([buffer, Buffer.from([1, 0xff, 0xff, 0xff, 0xff])]);
}

function buildCommandBytes(power, tempC, mode = 'cool') {
  const b = Buffer.alloc(18, 0);

  // Power on/off
  b[2] |= power ? 0b00000011 : 0b00000010;

  // Mode bits
  const modeBits = {
    cool: 0b00101000,
    heat: 0b00110000,
    dry:  0b00011000,
    fan:  0b00010000,
    auto: 0b00000000
  };
  b[2] |= modeBits[mode] || 0b00101000; // fallback to COOL

  // Temperature
  b[4] = Math.floor(tempC / 0.5) + 128;

  // Additional control flags
  b[2] |= 0b11000000;
  b[3] |= 0b10000000;
  b[3] |= 0b00001111;
  b[12] |= 0b00000011;
  b[11] |= 0b00010000;
  b[12] |= 0b00001000;
  b[8]  |= 0b00001000;

  return b;
}

function buildReceiveBytes(power, tempC) {
  const b = Buffer.alloc(18, 0);

  if (power) {
    b[2] |= 0b00000001;
    b[2] |= 0b00001000;
    b[3] |= 0b00000111;
  }

  b[4] = Math.floor(tempC / 0.5);
  b[2] |= 0b01000000;
  b[12] |= 0b00000001;
  b[8] |= 0b00001000;

  return b;
}

function generateAirconStat(power, tempC, mode = 'cool') {
  const cmd = addCRC16(addVariable(buildCommandBytes(power, tempC, mode)));
  const rcv = addCRC16(addVariable(buildReceiveBytes(power, tempC)));
  return Buffer.concat([cmd, rcv]).toString('base64');
}

module.exports = { generateAirconStat };
