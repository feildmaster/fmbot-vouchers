const plain = doc => ({ ...doc.data(), id: doc.id });

module.exports = function createStore({ db, FieldValue }) {
  const purchases = db.collection('voucher-purchases');

  const query = async (field, value) => {
    const snapshot = await purchases.where(field, '==', value).get();
    return snapshot.docs.map(plain);
  };

  return {
    async createPurchase({
      discordId, name, plan, label, type, data, amount, memo, note,
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
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      };
      await ref.set(purchase);
      return { ...purchase, id: ref.id };
    },

    setPurchase: (id, fields) => purchases.doc(id).update(fields),

    pendingPurchases: () => query('status', 'pending'),
    purchasesByUser: discordId => query('discordId', discordId),
  };
};
