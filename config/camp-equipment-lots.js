/** Shared limits and machine states for camp equipment lots. */
module.exports = {
  LOT_NAME_MAX: 150,
  LOT_ROLES: ['prepare', 'transport', 'return'],
  LOT_STATES: ['to_prepare', 'loaded', 'returned'],
  LOT_TRANSITIONS: { to_prepare: ['loaded'], loaded: ['to_prepare', 'returned'], returned: ['loaded'] },
};
