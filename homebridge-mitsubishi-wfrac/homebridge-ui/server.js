import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/test', this.testHandler.bind(this));
    this.onRequest('/discover', this.handleDiscovery.bind(this));

    this.ready();
  }

  async testHandler() {
    console.log('[UI-SERVER] ✅ /test endpoint was called!');
    return {
      message: 'Hello from server.mjs!',
      time: new Date().toISOString(),
    };
  }

  async handleDiscovery({ ip }) {
    console.log(`[UI-SERVER] 🔍 Discover request for IP: ${ip}`);
    const PORT = 51443;
    const deviceId = `homebridge-${Math.floor(Math.random() * 100000)}`;
    const operatorId = uuidv4();
    const timestamp = Math.floor(Date.now() / 1000);

    // Step 1: Get Device Info
    const getPayload = {
      apiVer: "1.0",
      command: "getDeviceInfo",
      deviceId,
      operatorId,
      timestamp,
    };

    const getRes = await axios.post(`http://${ip}:${PORT}/beaver/command/getDeviceInfo`, getPayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });

    const airconId = getRes?.data?.contents?.airconId;
    if (!airconId) {
      throw new Error('AC unit responded but airconId is missing.');
    }

    // Step 2: Register Account
    const updatePayload = {
      apiVer: "1.0",
      command: "updateAccountInfo",
      deviceId,
      operatorId,
      timestamp: Math.floor(Date.now() / 1000),
      contents: {
        airconId,
        accountId: operatorId,
        remote: 0,
        timezone: 'Europe/London'
      }
    };

    await axios.post(`http://${ip}:${PORT}/beaver/command/updateAccountInfo`, updatePayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });

    console.log(`[UI-SERVER] ✅ Discovery complete: ${deviceId}, ${operatorId}, ${airconId}`);

    return {
      deviceId,
      operatorId,
      airconId,
    };
  }
}

(() => new UiServer())();
