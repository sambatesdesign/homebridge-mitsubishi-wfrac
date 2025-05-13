// src/wfrac-ac.js
import axios from 'axios';
import { parseIndoorTemp } from '../decoder/airconDecode.js';
import { generateAirconStat } from '../encoder/airconStat.js';

export class MitsubishiWFRACPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];
    this.cachedAccessories = new Map();

    this.api.on('didFinishLaunching', () => {
      this.log('[Platform] Finished launching. Setting up devices...');
      this.setupDevices();
    });
  }

  configureAccessory(accessory) {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  setupDevices() {
    const devices = Array.isArray(this.config.acUnits) ? this.config.acUnits : [];

    for (const deviceConfig of devices) {
      const uuid = this.api.hap.uuid.generate(`wfrac-${deviceConfig.airconId}`);
      const cached = this.cachedAccessories.get(uuid);

      if (cached) {
        this.log(`[${deviceConfig.name}] Restoring cached accessory`);
        cached.context.device = deviceConfig;
        new MitsubishiWFRACAccessory(this.log, deviceConfig, this.api, cached);
        this.api.updatePlatformAccessories([cached]);
      } else {
        const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);
        accessory.context.device = deviceConfig;
        new MitsubishiWFRACAccessory(this.log, deviceConfig, this.api, accessory);
        this.api.registerPlatformAccessories('homebridge-mitsubishi-wfrac', 'MitsubishiWFRACPlatform', [accessory]);
      }
    }
  }
}

class MitsubishiWFRACAccessory {
  constructor(log, config, api, accessory) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessory = accessory;
    this.name = config.name || 'WF-RAC AC';

    const { Service, Characteristic } = this.api.hap;

    let service = this.accessory.getService(Service.HeaterCooler);
    if (!service) {
      service = this.accessory.addService(Service.HeaterCooler, this.name);
    }

    this.service = service;

    this.isOn = false;
    this.temp = 22.0;
    this.mode = 'cool';
    this.currentTemp = 22.0;

    this.service.getCharacteristic(Characteristic.Active)
      .onGet(() => this.isOn ? 1 : 0)
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [
        Characteristic.TargetHeaterCoolerState.HEAT,
        Characteristic.TargetHeaterCoolerState.COOL,
      ]})
      .onGet(() => this.mode === 'heat'
        ? Characteristic.TargetHeaterCoolerState.HEAT
        : Characteristic.TargetHeaterCoolerState.COOL)
      .onSet(this.setTargetState.bind(this));

    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 0.5 })
      .onGet(() => Math.max(this.temp, 16))
      .onSet(this.setTemp.bind(this));

    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 0.5 })
      .onGet(() => Math.max(this.temp, 18))
      .onSet(this.setTemp.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemp.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(() => {
        if (!this.isOn) {
          return Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }
        return this.mode === 'heat'
          ? Characteristic.CurrentHeaterCoolerState.HEATING
          : Characteristic.CurrentHeaterCoolerState.COOLING;
      });

    this.pollStatus();
    setInterval(() => this.pollStatus(), 60000);
  }

  async pollStatus() {
    const payload = {
      apiVer: "1.0",
      command: "getAirconStat",
      deviceId: this.config.deviceId,
      operatorId: this.config.operatorId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    try {
      const res = await axios.post(`http://${this.config.host}:51443/beaver/command/getAirconStat`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      const b64 = res.data.contents.airconStat;
      const buffer = Buffer.from(b64, 'base64');
      const temp = parseIndoorTemp(b64);

      // 🔍 Debug log for the full raw response
      this.log(`[${this.name}] Full base64: ${b64}`);
      this.log(`[${this.name}] Full buffer (hex): ${buffer.toString('hex')}`);
      this.log(`[${this.name}] Full buffer (bytes): ${Array.from(buffer)}`);

      // Original decoding logic
      const offset = buffer[18] * 4 + 21;
      const powerOn = (buffer[offset + 2] & 0b00000011) === 1;
      this.log(`[${this.name}] Power check from offset ${offset + 2} → byte value: ${buffer[offset + 2]} → powerOn: ${powerOn}`);
      const modeVal = (buffer[5] & 0b00001110) >> 1;

      this.currentTemp = Number.isFinite(temp) ? temp : this.currentTemp;
      this.isOn = powerOn;
      this.mode = modeVal === 2 ? 'heat' : 'cool';

      this.log(`[${this.name}] Polled temp: ${this.currentTemp}, power: ${this.isOn}, mode: ${this.mode}`);

      this.service.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature).updateValue(this.currentTemp);
      this.service.getCharacteristic(this.api.hap.Characteristic.CurrentHeaterCoolerState)
        .updateValue(this.isOn
          ? this.mode === 'heat'
            ? this.api.hap.Characteristic.CurrentHeaterCoolerState.HEATING
            : this.api.hap.Characteristic.CurrentHeaterCoolerState.COOLING
          : this.api.hap.Characteristic.CurrentHeaterCoolerState.INACTIVE);

      this.service.getCharacteristic(this.api.hap.Characteristic.Active)
        .updateValue(this.isOn ? 1 : 0);

      this.service.getCharacteristic(this.api.hap.Characteristic.TargetHeaterCoolerState)
        .updateValue(this.mode === 'heat'
          ? this.api.hap.Characteristic.TargetHeaterCoolerState.HEAT
          : this.api.hap.Characteristic.TargetHeaterCoolerState.COOL);

    } catch (err) {
      this.log(`[${this.name}] Polling error: ${err.message}`);
    }
  }

  async setActive(value) {
    this.isOn = value === 1;
    this.log(`[${this.name}] Power set to: ${this.isOn}`);
    await this.sendCommand();
  }

  async setTemp(value) {
    this.temp = value;
    this.log(`[${this.name}] Temperature set to: ${this.temp}`);
    await this.sendCommand();
  }

  async setTargetState(value) {
    const { Characteristic } = this.api.hap;
    this.mode = value === Characteristic.TargetHeaterCoolerState.HEAT ? 'heat' : 'cool';
    this.log(`[${this.name}] Mode changed to: ${this.mode}`);
    await this.sendCommand();
  }

  async getCurrentTemp() {
    try {
      const payload = {
        apiVer: "1.0",
        command: "getAirconStat",
        deviceId: this.config.deviceId,
        operatorId: this.config.operatorId,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const res = await axios.post(`http://${this.config.host}:51443/beaver/command/getAirconStat`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      const b64 = res.data.contents.airconStat;
      const temp = parseIndoorTemp(b64);
      this.log(`[${this.name}] Decoded temp from device: ${temp}`);
      return Number.isFinite(temp) ? temp : this.currentTemp;
    } catch (err) {
      this.log(`[${this.name}] Error fetching current temperature: ${err.message}`);
      return this.currentTemp;
    }
  }

  async sendCommand() {
    const payload = {
      apiVer: "1.0",
      command: "setAirconStat",
      deviceId: this.config.deviceId,
      operatorId: this.config.operatorId,
      timestamp: Math.floor(Date.now() / 1000),
      contents: {
        airconId: this.config.airconId,
        airconStat: generateAirconStat(this.isOn, this.temp, this.mode),
      },
    };

    try {
      const res = await axios.post(`http://${this.config.host}:51443/beaver/command/setAirconStat`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
      this.log(`[${this.name}] AC command sent:`, res.data);
    } catch (err) {
      this.log(`[${this.name}] AC command error: ${err.message}`);
    }
  }

  getServices() {
    return [this.service];
  }
}
