import { MitsubishiWFRACAccessory } from './wfrac-ac.js';

export default (api) => {
  api.registerAccessory('MitsubishiWFRAC', MitsubishiWFRACAccessory);
};
