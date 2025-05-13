// src/main.js
import { MitsubishiWFRACPlatform } from './wfrac-ac.js';

export default (api) => {
  api.registerPlatform('MitsubishiWFRACPlatform', MitsubishiWFRACPlatform);
};
