# homebridge-mitsubishi-wfrac

A Homebridge plugin enabling local LAN control of Mitsubishi Heavy Industries WF-RAC air conditioners via Apple's HomeKit. This plugin communicates directly with the air conditioner's local API, ensuring fast and reliable operation without relying on cloud services.

## Features

- Local LAN control (no cloud dependency)
- Supports multiple AC units
- HeaterCooler service with HEAT and COOL modes
- Adjustable heating and cooling threshold temperatures
- Real-time indoor temperature monitoring
- Periodic status polling (default: every 60 seconds)

## Installation

### Via Homebridge Config UI X (Recommended)

1. Open the Homebridge Config UI.
2. Navigate to the **Plugins** tab.
3. Search for `homebridge-mitsubishi-wfrac`.
4. Click **Install**.
5. After installation, configure the plugin as described below.

### Via NPM

```bash
npm install -g homebridge-mitsubishi-wfrac
```

## Configuration

Add the following to the `platforms` section of your Homebridge `config.json`:

```json
{
  "platform": "MitsubishiWFRACPlatform",
  "name": "Mitsubishi WF-RAC",
  "acUnits": [
    {
      "name": "Living Room AC",
      "host": "192.168.1.50",
      "deviceId": "ABC123456",
      "operatorId": "OPERATOR001",
      "airconId": "AIRCON001"
    },
    {
      "name": "Bedroom AC",
      "host": "192.168.1.51",
      "deviceId": "DEF789012",
      "operatorId": "OPERATOR002",
      "airconId": "AIRCON002"
    }
  ]
}
```

### Configuration Parameters

- `platform` (string): Must be `"MitsubishiWFRACPlatform"`.
- `name` (string): Display name for the platform.
- `acUnits` (array): List of AC unit configurations.
  - `name` (string): Name of the AC unit.
  - `host` (string): IP address of the AC unit.
  - `deviceId` (string): Unique device identifier.
  - `operatorId` (string): Operator identifier.
  - `airconId` (string): Air conditioner identifier.

## Usage

Once configured and Homebridge is restarted, your Mitsubishi WF-RAC units will appear in the Home app as HeaterCooler accessories. You can control power, switch between heating and cooling modes, and set target temperatures directly from the Home app or via Siri.

## Troubleshooting

- **Accessories show "No Response" in Home app:**
  - Ensure the AC units are powered on and connected to the network.
  - Verify that the IP addresses in the configuration are correct.
  - Check network connectivity between the Homebridge server and the AC units.

- **Accessories become unresponsive after Homebridge restart:**
  - Ensure that the `deviceId` values are consistent and unique for each AC unit.
  - If issues persist, try clearing the cached accessories:
    ```bash
    rm ~/.homebridge/accessories/cachedAccessories
    ```

## Contributing

Contributions are welcome! If you encounter issues or have suggestions for improvements, please open an issue or submit a pull request on the [GitHub repository](https://github.com/yourusername/homebridge-mitsubishi-wfrac).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
