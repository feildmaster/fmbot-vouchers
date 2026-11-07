module.exports = function buildMenu(live, pointers, local = {}) {
  if (!live) return { plans: local, missing: [] };

  const names = Object.keys(pointers);
  if (!names.length) return { plans: { ...live, ...local }, missing: [] };

  const plans = {};
  const missing = [];
  names.forEach((name) => {
    const { plan, label } = pointers[name];
    if (!Object.hasOwn(live, plan)) {
      missing.push(name);
      return;
    }
    plans[name] = { ...live[plan], label: label || live[plan].label };
  });
  return { plans: { ...plans, ...local }, missing };
};
