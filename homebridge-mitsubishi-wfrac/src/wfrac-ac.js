// src/wfrac-ac.js
import axios from 'axios';
import { parseIndoorTemp } from '../decoder/airconDecode.js';
import { generateAirconStat, rebuildAirconStat } from '../encoder/airconStat.js';

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

      const offset = buffer[18] * 4 + 21;
      const powerOn = (buffer[offset + 2] & 0b00000011) === 3;
      const modeVal = buffer[offset + 2] & 0b00111100;
      const setTemp = (buffer[offset + 4] - 128) * 0.5;

      this.currentTemp = Number.isFinite(temp) ? temp : this.currentTemp;
      this.isOn = powerOn;
      this.mode = modeVal === 0b00110000 ? 'heat' : 'cool';
      if (setTemp >= 16 && setTemp <= 30) this.temp = setTemp;

      this.log(`[${this.name}] Polled — current: ${this.currentTemp}°, set: ${this.temp}°, power: ${this.isOn}, mode: ${this.mode}`);

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

      this.service.getCharacteristic(this.api.hap.Characteristic.HeatingThresholdTemperature).updateValue(this.temp);
      this.service.getCharacteristic(this.api.hap.Characteristic.CoolingThresholdTemperature).updateValue(this.temp);

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

  getCurrentTemp() {
    return this.currentTemp;
  }

  async sendCommand() {
    let airconStat;

    try {
      const getRes = await axios.post(
        `http://${this.config.host}:51443/beaver/command/getAirconStat`,
        {
          apiVer: "1.0",
          command: "getAirconStat",
          deviceId: this.config.deviceId,
          operatorId: this.config.operatorId,
          timestamp: Math.floor(Date.now() / 1000),
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 }
      );
      const buffer = Buffer.from(getRes.data.contents.airconStat, 'base64');
      const offset = buffer[18] * 4 + 21;
      const cmdBytes = buffer.slice(offset, offset + 18);
      airconStat = rebuildAirconStat(cmdBytes, this.isOn, this.temp, this.mode);
    } catch (err) {
      this.log(`[${this.name}] Could not read current state before send, falling back to defaults: ${err.message}`);
      airconStat = generateAirconStat(this.isOn, this.temp, this.mode);
    }

    try {
      await axios.post(
        `http://${this.config.host}:51443/beaver/command/setAirconStat`,
        {
          apiVer: "1.0",
          command: "setAirconStat",
          deviceId: this.config.deviceId,
          operatorId: this.config.operatorId,
          timestamp: Math.floor(Date.now() / 1000),
          contents: { airconId: this.config.airconId, airconStat },
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 }
      );
      this.log(`[${this.name}] Command sent (power=${this.isOn}, mode=${this.mode}, temp=${this.temp})`);
    } catch (err) {
      this.log(`[${this.name}] AC command error: ${err.message}`);
    }
  }

  getServices() {
    return [this.service];
  }
}
