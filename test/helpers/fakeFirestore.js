const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const REMOVE = Symbol('remove');

module.exports = function createFakeFirestore() {
  const data = new Map();
  let counter = 0;

  const last = path => path.split('/').pop();
  const parent = path => path.split('/').slice(0, -1).join('/');
  const nextId = () => {
    counter += 1;
    return `auto${counter}`;
  };

  const snapshot = path => ({
    id: last(path),
    exists: data.has(path),
    data: () => clone(data.get(path)),
    get: field => clone(data.has(path) ? data.get(path)[field] : undefined),
  });

  const doc = path => ({
    id: last(path),
    path,
    get: async () => snapshot(path),
    set: async (value) => {
      data.set(path, clone(value));
    },
    update: async (fields) => {
      if (!data.has(path)) throw new Error(`No document: ${path}`);
      const next = { ...data.get(path) };
      Object.entries(fields).forEach(([key, value]) => {
        if (value === REMOVE) delete next[key];
        else next[key] = clone(value);
      });
      data.set(path, next);
    },
  });

  const collection = (name) => {
    const query = filters => ({
      where: (field, op, value) => query([...filters, [field, value]]),
      get: async () => {
        const docs = [...data.keys()]
          .filter(path => parent(path) === name
            && filters.every(([field, value]) => data.get(path)[field] === value))
          .map(snapshot);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    });
    return { doc: id => doc(`${name}/${id || nextId()}`), ...query([]) };
  };

  const db = {
    doc,
    collection,
    runTransaction: async (run) => {
      const writes = [];
      const result = await run({
        get: ref => ref.get(),
        set: (ref, value) => writes.push(() => ref.set(value)),
        update: (ref, fields) => writes.push(() => ref.update(fields)),
      });
      await Promise.all(writes.map(write => write()));
      return result;
    },
  };

  let clock = 0;
  const serverTimestamp = () => {
    clock += 1;
    return clock;
  };

  return { db, data, FieldValue: { serverTimestamp, delete: () => REMOVE } };
};
