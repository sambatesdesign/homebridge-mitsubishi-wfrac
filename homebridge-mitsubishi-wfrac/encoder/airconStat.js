import { crc16ccitt } from 'crc';

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
  b[2] |= modeBits[mode] || 0b00101000;

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

export function generateAirconStat(power, tempC, mode = 'cool') {
  const cmd = addCRC16(addVariable(buildCommandBytes(power, tempC, mode)));
  const rcv = addCRC16(addVariable(buildReceiveBytes(power, tempC)));
  return Buffer.concat([cmd, rcv]).toString('base64');
}

// Rebuilds the airconStat from the raw device response bytes at the state offset,
// preserving fan speed, swing, and vane settings while updating power/mode/temp.
//
// The device response and command formats use different bit encodings for the same fields.
// Each transform below bridges that gap (verified against homebridge-mhi-wfrac source).
export function rebuildAirconStat(deviceBytes, power, tempC, mode = 'cool') {
  const modeBits = { cool: 0b00101000, heat: 0b00110000, dry: 0b00011000, fan: 0b00010000, auto: 0b00000000 };
  const b = Buffer.alloc(18, 0);

  // b[2]: power (bits 0-1) + mode (bits 2-5) + vertical swing flag (bits 6-7)
  // Device response: bit 6 set = auto swing, bit 7 set = non-auto swing
  // Command format:  bits 6+7 set = auto swing, bit 7 only = non-auto swing
  // Transform: always set bit 7; bit 6 is already correct from device for both cases
  b[2] |= power ? 0b00000011 : 0b00000010;
  b[2] |= modeBits[mode] ?? 0b00101000;
  b[2] |= 0b10000000;
  b[2] |= deviceBytes[2] & 0b01000000;

  // b[3]: upper nibble = vertical swing position, lower nibble = fan speed
  // Device→command: OR 0b10001000 (sets bit 7 for swing, bit 3 for fan)
  // e.g. fan auto: device=7 (0b0111) → command=15 (0b1111) ✓
  //      swing pos1: device upper=0 → command upper=8 ✓
  b[3] = deviceBytes[3] | 0b10001000;

  // b[4]: set temperature — command uses +128 offset, device response does not
  b[4] = Math.floor(tempC / 0.5) + 128;

  // b[8]: required control flag
  b[8] = deviceBytes[8] | 0b00001000;

  // b[11]: horizontal swing position (lower 5 bits), needs bit 4 set in command
  // Device→command: OR 0b00010000
  b[11] = deviceBytes[11] | 0b00010000;

  // b[12]: horizontal swing auto indicator (bits 0-1) + required flag (bit 3)
  // Device auto=0b01 → command auto=0b11; device non-auto=0b00 → command=0b10
  // Transform: OR 0b00001010 handles both cases cleanly
  b[12] = deviceBytes[12] | 0b00001010;

  const cmd = addCRC16(addVariable(b));
  const rcv = addCRC16(addVariable(buildReceiveBytes(power, tempC)));
  return Buffer.concat([cmd, rcv]).toString('base64');
}
