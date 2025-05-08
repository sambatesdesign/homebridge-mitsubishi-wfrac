const { MitsubishiWFRACAccessory } = require('./wfrac-ac');

module.exports = (api) => {
  api.registerAccessory('MitsubishiWFRAC', MitsubishiWFRACAccessory);
};
