const axios = require('axios');
const { parseIndoorTemp } = require('../decoder/airconDecode');
const { generateAirconStat } = require('../encoder/airconStat');

class MitsubishiWFRACAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'WF-RAC AC';
    this.api = api;

    const { Service, Characteristic } = this.api.hap;

    this.service = new Service.HeaterCooler(this.name);

    this.service.getCharacteristic(Characteristic.Active)
      .onGet(() => this.isOn ? 1 : 0)
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          Characteristic.TargetHeaterCoolerState.HEAT,
          Characteristic.TargetHeaterCoolerState.COOL,
        ],
      })
      .onGet(() => this.mode === 'heat'
        ? Characteristic.TargetHeaterCoolerState.HEAT
        : Characteristic.TargetHeaterCoolerState.COOL)
      .onSet(this.setTargetState.bind(this));

    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 0.5 })
      .onGet(() => this.temp || 20)
      .onSet(this.setTemp.bind(this));

    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 0.5 })
      .onGet(() => this.temp || 22)
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

    this.isOn = false;
    this.temp = 22;
    this.mode = 'cool';
    this.currentTemp = 22;

    // Poll every 60s
    setInterval(async () => {
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
        const temp = parseIndoorTemp(b64, this.log);
        const powerOn = (buffer[6] & 0b00000001) === 1;
        const modeVal = (buffer[5] & 0b00001110) >> 1;

        this.currentTemp = Number.isFinite(temp) ? temp : this.currentTemp;
        this.isOn = powerOn;
        this.mode = modeVal === 2 ? 'heat' : 'cool';

        this.log(`[${this.name}] Polled temp: ${this.currentTemp}, power: ${this.isOn}, mode: ${this.mode}`);

        this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.currentTemp);
        this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.isOn
            ? this.mode === 'heat'
              ? Characteristic.CurrentHeaterCoolerState.HEATING
              : Characteristic.CurrentHeaterCoolerState.COOLING
            : Characteristic.CurrentHeaterCoolerState.INACTIVE);

        this.service.getCharacteristic(Characteristic.Active).updateValue(this.isOn ? 1 : 0);
        this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
          .updateValue(this.mode === 'heat'
            ? Characteristic.TargetHeaterCoolerState.HEAT
            : Characteristic.TargetHeaterCoolerState.COOL);
      } catch (err) {
        this.log(`[${this.name}] Polling error: ${err.message}`);
      }
    }, 60000);
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
      const temp = parseIndoorTemp(b64, this.log);
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

module.exports = { MitsubishiWFRACAccessory };
