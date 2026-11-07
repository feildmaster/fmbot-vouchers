const plain = doc => ({ ...doc.data(), id: doc.id });

module.exports = function createStore({ db, FieldValue }) {
  const purchases = db.collection('voucher-purchases');

  const query = async (field, value) => {
    const snapshot = await purchases.where(field, '==', value).get();
    return snapshot.docs.map(plain);
  };

  return {
    async createPurchase({
      discordId, name, plan, label, type, data, amount, memo, note, status = 'pending', expiresAt,
    }) {
      const ref = purchases.doc();
      const purchase = {
        discordId,
        name,
        plan,
        label,
        type,
        data,
        amount,
        memo,
        note,
        status,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        createdAt: FieldValue.serverTimestamp(),
      };
      await ref.set(purchase);
      return { ...purchase, id: ref.id };
    },

    async getPurchase(id) {
      const snapshot = await purchases.doc(id).get();
      return snapshot.exists ? plain(snapshot) : null;
    },

    claimPurchase(id, from, to, extra = {}) {
      const ref = purchases.doc(id);
      return db.runTransaction(async (t) => {
        const snapshot = await t.get(ref);
        if (!snapshot.exists || snapshot.get('status') !== from) return null;
        t.update(ref, { status: to, ...extra });
        return { ...plain(snapshot), status: to, ...extra };
      });
    },

    setPurchase: (id, fields) => purchases.doc(id).update(fields),
    deletePurchase: id => purchases.doc(id).delete(),

    awaitingPurchases: () => query('status', 'awaiting'),
    pendingPurchases: () => query('status', 'pending'),
    purchasesByUser: discordId => query('discordId', discordId),
  };
};
